import { Hono } from "hono";
import type { Context } from "hono";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { aprovacoes, contasSociais, midias, posts } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { exigePermissao } from "../middleware/permissao";
import { registrar, ipDe } from "../services/log-service";
import { LIMITE_POSTS_GRATIS } from "../services/plano";
import { detectarFormato, enviarMidia, obterMidia, removerMidia, TAMANHO_MAX_MIDIA } from "../services/minio";
import { publicarNoInstagram, urlPublicaMidia } from "../services/instagram";
import { publicarNaPaginaFacebook } from "../services/facebook";
import { decifrar, urlMidiaValida } from "../services/cripto";
import { perfilPublico, type Papel } from "../services/auth-service";
import type { Env } from "../types";

const recursos = new Hono<Env>();
recursos.use("/*", authMiddleware);

const STATUS_VALIDOS = ["rascunho", "agendado", "aprovado", "publicado", "cancelado", "ajustes"] as const;
type Status = (typeof STATUS_VALIDOS)[number];

function statusValido(valor: unknown): valor is Status {
  return typeof valor === "string" && (STATUS_VALIDOS as readonly string[]).includes(valor);
}

function ehAdmin(role: Papel): boolean {
  return role === "admin";
}

/**
 * Regra de visibilidade — o coração do isolamento por usuário.
 *
 *   admin          -> vê tudo (é o papel administrativo do SaaS)
 *   dono do post   -> vê o que criou
 *   cliente        -> vê o post em que foi atribuído (`cliente_id`)
 *   qualquer outro -> 403, mesmo sabendo o ID
 *
 * A tela não participa dessa decisão. Chamar a API direto com o ID de outra
 * pessoa cai exatamente aqui.
 */
function podeLer(post: typeof posts.$inferSelect, usuarioId: number, role: Papel): boolean {
  return ehAdmin(role) || post.usuarioId === usuarioId || post.clienteId === usuarioId;
}

function podeEditar(post: typeof posts.$inferSelect, usuarioId: number, role: Papel): boolean {
  return ehAdmin(role) || post.usuarioId === usuarioId;
}

function podeAprovar(post: typeof posts.$inferSelect, usuarioId: number, role: Papel): boolean {
  return ehAdmin(role) || post.clienteId === usuarioId;
}

async function carregarPost(id: number): Promise<typeof posts.$inferSelect | null> {
  if (!Number.isInteger(id)) return null;
  const [linha] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return linha ?? null;
}

function recusaAcesso(c: Context<Env>, motivo: string) {
  return c.json(
    {
      error: motivo,
      permissao_exigida: "ler:post",
      papel: c.get("role"),
      sua_conta: c.get("usuarioId"),
    },
    403
  );
}

async function carregarConta(id: number) {
  if (!Number.isInteger(id)) return null;
  const [conta] = await db.select().from(contasSociais).where(eq(contasSociais.id, id)).limit(1);
  return conta ?? null;
}

/** GET /api/posts — lista apenas o que o chamador pode ver. */
recursos.get("/", exigePermissao("ler:post"), async (c) => {
  const usuarioId = c.get("usuarioId");
  const role = c.get("role");

  const filtro = ehAdmin(role)
    ? undefined
    : role === "cliente"
      ? eq(posts.clienteId, usuarioId)
      : eq(posts.usuarioId, usuarioId);

  const linhas = await db
    .select({
      id: posts.id,
      usuarioId: posts.usuarioId,
      contaSocialId: posts.contaSocialId,
      clienteId: posts.clienteId,
      titulo: posts.titulo,
      legenda: posts.legenda,
      dataAgendada: posts.dataAgendada,
      status: posts.status,
      publicadoEm: posts.publicadoEm,
      publicadoUrl: posts.publicadoUrl,
      criadoEm: posts.criadoEm,
      atualizadoEm: posts.atualizadoEm,
      contaNome: contasSociais.nome,
      contaRede: contasSociais.rede,
    })
    .from(posts)
    .innerJoin(contasSociais, eq(posts.contaSocialId, contasSociais.id))
    .where(filtro)
    .orderBy(desc(posts.dataAgendada));

  return c.json({ posts: linhas, total: linhas.length });
});

/** POST /api/posts — cria o recurso principal. O dono vem do token, nunca do corpo. */
recursos.post("/", exigePermissao("criar:post"), async (c) => {
  const usuarioId = c.get("usuarioId");
  const role = c.get("role");
  const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const titulo = String(corpo.titulo ?? "").trim();
  const legenda = corpo.legenda === undefined || corpo.legenda === null ? null : String(corpo.legenda).trim();
  const dataBruta = corpo.data_agendada ?? corpo.dataAgendada;
  const contaId = Number(corpo.conta_social_id ?? corpo.contaSocialId);
  const status = corpo.status ?? "agendado";

  if (!titulo) return c.json({ error: 'Campo "titulo" é obrigatório' }, 400);
  if (titulo.length > 180) return c.json({ error: "O título deve ter no máximo 180 caracteres" }, 400);
  if (!Number.isInteger(contaId)) return c.json({ error: 'Campo "conta_social_id" é obrigatório' }, 400);
  if (!statusValido(status)) {
    return c.json({ error: `Status inválido. Use: ${STATUS_VALIDOS.join(", ")}` }, 400);
  }

  const data = new Date(String(dataBruta ?? ""));
  if (Number.isNaN(data.getTime())) {
    return c.json({ error: 'Campo "data_agendada" precisa ser uma data válida' }, 400);
  }

  const conta = await carregarConta(contaId);
  if (!conta) return c.json({ error: "Conta social não encontrada" }, 404);
  if (!ehAdmin(role) && conta.usuarioId !== usuarioId) {
    return c.json(
      { error: "Ação negada: a conta social informada não pertence a você.", permissao_exigida: "gerenciar:contas", papel: role },
      403
    );
  }

  // Atribuição de cliente é uma ação administrativa.
  let clienteId: number | null = null;
  const clienteBruto = corpo.cliente_id ?? corpo.clienteId;
  if (clienteBruto !== undefined && clienteBruto !== null && clienteBruto !== "") {
    if (!ehAdmin(role)) {
      return c.json(
        { error: "Ação negada: somente um admin pode atribuir um cliente ao post.", permissao_exigida: "alterar:papel", papel: role },
        403
      );
    }
    const alvo = await perfilPublico(c.req.header("Authorization")!.slice(7), Number(clienteBruto));
    if (!alvo.ok) return c.json({ error: alvo.erro }, alvo.status as 400 | 404 | 503);
    if (alvo.dados.role !== "cliente") {
      return c.json({ error: "O usuário atribuído precisa ter o papel cliente." }, 400);
    }
    clienteId = Number(clienteBruto);
  }

  // Benefício do plano: o gratuito tem teto de posts. A checagem é no servidor.
  if (!c.get("premium") && !ehAdmin(role)) {
    const [linha] = await db.select({ total: count() }).from(posts).where(eq(posts.usuarioId, usuarioId));
    if (Number(linha?.total ?? 0) >= LIMITE_POSTS_GRATIS) {
      return c.json(
        {
          error: `O plano gratuito permite ${LIMITE_POSTS_GRATIS} posts. Assine o Pro para criar sem limite.`,
          permissao_exigida: "post:ilimitado",
          limite: LIMITE_POSTS_GRATIS,
          premium: false,
        },
        403
      );
    }
  }

  const [novo] = await db
    .insert(posts)
    .values({
      usuarioId,
      contaSocialId: contaId,
      clienteId,
      titulo,
      legenda,
      dataAgendada: data,
      status,
    })
    .$returningId();

  await registrar({
    acao: "post_criado",
    usuario_id: usuarioId,
    usuario: c.get("nome"),
    papel: role,
    recurso: `post:${novo.id}`,
    detalhe: `${titulo} · ${conta.rede} · status ${status}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Post criado", post: { id: novo.id } }, 201);
});

/** GET /api/posts/:id — detalhe com mídias e histórico de aprovação. */
recursos.get("/:id", exigePermissao("ler:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeLer(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: este post pertence a outra pessoa.");
  }

  const conta = await carregarConta(post.contaSocialId);
  const listaMidias = await db.select().from(midias).where(eq(midias.postId, id)).orderBy(desc(midias.id));
  const historico = await db.select().from(aprovacoes).where(eq(aprovacoes.postId, id)).orderBy(desc(aprovacoes.id));

  return c.json({
    post: {
      ...post,
      conta: conta ? { id: conta.id, nome: conta.nome, rede: conta.rede, identificador: conta.identificador } : null,
      midias: listaMidias.map((m) => ({
        id: m.id,
        nomeArquivo: m.nomeArquivo,
        contentType: m.contentType,
        tamanho: m.tamanho,
        criadoEm: m.criadoEm,
        url: `/api/posts/${id}/midia/${m.id}/arquivo`,
      })),
      aprovacoes: historico,
    },
    permissoes: {
      editar: podeEditar(post, c.get("usuarioId"), c.get("role")),
      publicar: podeEditar(post, c.get("usuarioId"), c.get("role")),
      aprovar: podeAprovar(post, c.get("usuarioId"), c.get("role")),
      apagar: podeEditar(post, c.get("usuarioId"), c.get("role")),
      enviarMidia: podeEditar(post, c.get("usuarioId"), c.get("role")),
    },
  });
});

/** PATCH /api/posts/:id — edita o recurso principal. */
recursos.patch("/:id", exigePermissao("editar:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeEditar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode editar os próprios posts.");
  }

  const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: Partial<typeof posts.$inferInsert> = {};

  if (corpo.titulo !== undefined) {
    const titulo = String(corpo.titulo).trim();
    if (!titulo) return c.json({ error: "O título não pode ficar vazio" }, 400);
    if (titulo.length > 180) return c.json({ error: "O título deve ter no máximo 180 caracteres" }, 400);
    set.titulo = titulo;
  }
  if (corpo.legenda !== undefined) {
    set.legenda = corpo.legenda === null ? null : String(corpo.legenda).trim();
  }
  if (corpo.data_agendada !== undefined || corpo.dataAgendada !== undefined) {
    const data = new Date(String(corpo.data_agendada ?? corpo.dataAgendada));
    if (Number.isNaN(data.getTime())) return c.json({ error: "Data inválida" }, 400);
    set.dataAgendada = data;
  }
  if (corpo.status !== undefined) {
    if (!statusValido(corpo.status)) {
      return c.json({ error: `Status inválido. Use: ${STATUS_VALIDOS.join(", ")}` }, 400);
    }
    set.status = corpo.status;
  }
  if (corpo.conta_social_id !== undefined || corpo.contaSocialId !== undefined) {
    const contaId = Number(corpo.conta_social_id ?? corpo.contaSocialId);
    const conta = await carregarConta(contaId);
    if (!conta) return c.json({ error: "Conta social não encontrada" }, 404);
    if (!ehAdmin(c.get("role")) && conta.usuarioId !== c.get("usuarioId")) {
      return c.json({ error: "Ação negada: a conta social não pertence a você." }, 403);
    }
    set.contaSocialId = contaId;
  }

  if (Object.keys(set).length === 0) {
    return c.json({ error: "Nenhum campo para atualizar" }, 400);
  }

  await db.update(posts).set(set).where(eq(posts.id, id));

  await registrar({
    acao: "post_editado",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `post:${id}`,
    detalhe: `campos: ${Object.keys(set).join(", ")}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Post atualizado", campos: Object.keys(set) });
});

/** DELETE /api/posts/:id — apaga o post, as mídias e os objetos do MinIO. */
recursos.delete("/:id", exigePermissao("apagar:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeEditar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode apagar os próprios posts.");
  }

  const arquivos = await db.select({ chave: midias.chaveObjeto }).from(midias).where(eq(midias.postId, id));
  for (const arquivo of arquivos) await removerMidia(arquivo.chave);

  await db.delete(posts).where(eq(posts.id, id));

  await registrar({
    acao: "post_removido",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `post:${id}`,
    detalhe: `${post.titulo} · ${arquivos.length} mídia(s) removida(s)`,
    ip: ipDe(c),
  });

  return c.json({ message: "Post removido" });
});

/** POST /api/posts/:id/publicar — publica de verdade quando a conta veio do OAuth. */
recursos.post("/:id/publicar", exigePermissao("publicar:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeEditar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode publicar os próprios posts.");
  }
  if (post.status === "publicado") {
    return c.json({ error: "Este post já foi publicado." }, 409);
  }

  const conta = await carregarConta(post.contaSocialId);

  // Caminho real: conta conectada pelo OAuth da Meta.
  if (conta?.conectadoVia === "api") {
    const token = conta.accessTokenCifrado ? decifrar(conta.accessTokenCifrado) : null;
    if (!conta.ativa || !token) {
      return c.json(
        { error: "Esta conta está desconectada ou o token é inválido. Reconecte pelo OAuth para publicar." },
        409
      );
    }

    const [primeiraMidia] = await db
      .select()
      .from(midias)
      .where(eq(midias.postId, id))
      .orderBy(midias.id)
      .limit(1);

    if (!primeiraMidia) {
      return c.json({ error: "A publicação real exige pelo menos uma imagem anexada ao post." }, 400);
    }

    try {
      if (conta.rede === "facebook") {
        const pageId = conta.facebookPageId || conta.identificador;
        if (!pageId) {
          return c.json({ error: "Página do Facebook sem identificador. Reconecte a conta." }, 409);
        }

        const resultado = await publicarNaPaginaFacebook({
          pageId,
          tokenPagina: token,
          imagemUrl: urlPublicaMidia(primeiraMidia.id),
          legenda: post.legenda || post.titulo,
        });

        await db
          .update(posts)
          .set({
            status: "publicado",
            publicadoEm: new Date(),
            instagramMediaId: resultado.postId,
            publicadoUrl: resultado.permalink,
          })
          .where(eq(posts.id, id));

        await registrar({
          acao: "post_publicado",
          usuario_id: c.get("usuarioId"),
          usuario: c.get("nome"),
          papel: c.get("role"),
          recurso: `post:${id}`,
          detalhe: `${post.titulo} · Facebook ${resultado.postId}`,
          ip: ipDe(c),
        });

        return c.json({
          message: "Post publicado no Facebook",
          modo: "api",
          publicadoUrl: resultado.permalink,
          instagramMediaId: resultado.postId,
          post: { id, status: "publicado" },
        });
      }

      // Instagram
      if (!conta.instagramUserId) {
        return c.json(
          { error: "Esta conta do Instagram está desconectada. Reconecte pelo OAuth para publicar." },
          409
        );
      }

      const resultado = await publicarNoInstagram({
        instagramUserId: conta.instagramUserId,
        tokenPagina: token,
        imagemUrl: urlPublicaMidia(primeiraMidia.id),
        legenda: post.legenda || post.titulo,
      });

      await db
        .update(posts)
        .set({
          status: "publicado",
          publicadoEm: new Date(),
          instagramMediaId: resultado.mediaId,
          publicadoUrl: resultado.permalink,
        })
        .where(eq(posts.id, id));

      await registrar({
        acao: "post_publicado",
        usuario_id: c.get("usuarioId"),
        usuario: c.get("nome"),
        papel: c.get("role"),
        recurso: `post:${id}`,
        detalhe: `${post.titulo} · Instagram ${resultado.mediaId}`,
        ip: ipDe(c),
      });

      return c.json({
        message: "Post publicado no Instagram",
        modo: "api",
        publicadoUrl: resultado.permalink,
        instagramMediaId: resultado.mediaId,
        post: { id, status: "publicado" },
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      console.error(`[posts] falha ao publicar ${id} (${conta.rede}): ${motivo}`);
      return c.json({ error: `A Meta recusou a publicação: ${motivo}` }, 502);
    }
  }

  // Conta manual: simulação explícita, registrada como tal na auditoria.
  await db
    .update(posts)
    .set({ status: "publicado", publicadoEm: new Date() })
    .where(eq(posts.id, id));

  await registrar({
    acao: "post_publicado",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `post:${id}`,
    detalhe: `${post.titulo} · simulado (conta manual)`,
    ip: ipDe(c),
  });

  return c.json({
    message: "Publicação simulada (conta manual)",
    modo: "simulado",
    post: { id, status: "publicado" },
  });
});

/** POST /api/posts/:id/aprovar — cliente atribuído aprova ou pede ajustes. */
recursos.post("/:id/aprovar", exigePermissao("aprovar:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeAprovar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode aprovar posts atribuídos a você.");
  }

  const { decisao, comentario } = (await c.req.json().catch(() => ({}))) as {
    decisao?: string;
    comentario?: string;
  };
  if (decisao !== "aprovado" && decisao !== "ajustes") {
    return c.json({ error: 'Campo "decisao" deve ser "aprovado" ou "ajustes"' }, 400);
  }

  await db.insert(aprovacoes).values({
    postId: id,
    usuarioId: c.get("usuarioId"),
    decisao,
    comentario: comentario ? String(comentario).slice(0, 1000) : null,
  });

  await db
    .update(posts)
    .set({ status: decisao === "aprovado" ? "aprovado" : "ajustes" })
    .where(eq(posts.id, id));

  await registrar({
    acao: decisao === "aprovado" ? "post_aprovado" : "post_ajustes_solicitados",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `post:${id}`,
    detalhe: comentario ? String(comentario).slice(0, 120) : post.titulo,
    ip: ipDe(c),
  });

  return c.json({ message: decisao === "aprovado" ? "Post aprovado" : "Ajustes solicitados", decisao });
});

/* -------------------------------------------------------------------------- */
/* MÍDIA — upload do post, guardado no MinIO e ligado ao registro certo        */
/* -------------------------------------------------------------------------- */

/** POST /api/posts/:id/midia — upload multipart no campo `arquivo` (ou `midia`). */
recursos.post("/:id/midia", exigePermissao("enviar:midia"), async (c) => {
  const id = Number(c.req.param("id"));
  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeEditar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode enviar mídia para os próprios posts.");
  }

  const tamanhoAnunciado = Number(c.req.header("Content-Length") ?? 0);
  if (tamanhoAnunciado > TAMANHO_MAX_MIDIA * 4) {
    return c.json({ error: `Arquivo excede o limite de ${TAMANHO_MAX_MIDIA / 1024 / 1024} MB` }, 413);
  }

  const form = await c.req.formData().catch(() => null);
  const arquivo = form?.get("arquivo") ?? form?.get("midia");

  if (!(arquivo instanceof File)) {
    return c.json({ error: 'Campo "arquivo" (multipart/form-data) é obrigatório' }, 400);
  }
  if (!arquivo.type.startsWith("image/")) {
    return c.json({ error: "Só imagens (PNG, JPEG, GIF ou WebP)" }, 415);
  }
  if (arquivo.size > TAMANHO_MAX_MIDIA) {
    return c.json({ error: `A imagem deve ter no máximo ${TAMANHO_MAX_MIDIA / 1024 / 1024} MB` }, 413);
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const formato = detectarFormato(arquivo.type, bytes);
  if (!formato) {
    return c.json({ error: "Conteúdo não é uma imagem válida (PNG, JPEG, GIF ou WebP)" }, 415);
  }

  try {
    const chave = await enviarMidia(c.get("usuarioId"), id, arquivo.name, bytes, formato);

    const [nova] = await db
      .insert(midias)
      .values({
        postId: id,
        chaveObjeto: chave,
        nomeArquivo: arquivo.name || `imagem.${formato}`,
        contentType: arquivo.type,
        tamanho: bytes.length,
      })
      .$returningId();

    await registrar({
      acao: "midia_enviada",
      usuario_id: c.get("usuarioId"),
      usuario: c.get("nome"),
      papel: c.get("role"),
      recurso: `post:${id}`,
      detalhe: `${arquivo.name || formato} · ${bytes.length} bytes`,
      ip: ipDe(c),
    });

    return c.json(
      {
        message: "Mídia enviada",
        midia: {
          id: nova.id,
          nomeArquivo: arquivo.name,
          contentType: arquivo.type,
          tamanho: bytes.length,
          url: `/api/posts/${id}/midia/${nova.id}/arquivo`,
        },
      },
      201
    );
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(`[posts] falha no upload de ${id}: ${motivo}`);
    return c.json({ error: "Armazenamento de objetos indisponível no momento" }, 503);
  }
});

/** GET /api/posts/:id/midia/:midiaId/arquivo — serve os bytes com checagem de dono. */
recursos.get("/:id/midia/:midiaId/arquivo", exigePermissao("ler:post"), async (c) => {
  const id = Number(c.req.param("id"));
  const midiaId = Number(c.req.param("midiaId"));

  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeLer(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: este post pertence a outra pessoa.");
  }

  const [midia] = await db
    .select()
    .from(midias)
    .where(and(eq(midias.id, midiaId), eq(midias.postId, id)))
    .limit(1);

  if (!midia) return c.json({ error: "Mídia não encontrada" }, 404);

  try {
    const arquivo = await obterMidia(midia.chaveObjeto);
    if (!arquivo) return c.json({ error: "Arquivo não encontrado no armazenamento" }, 404);

    return new Response(arquivo.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: {
        "Content-Type": arquivo.contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${midia.nomeArquivo.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      },
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(`[posts] falha ao ler mídia ${midiaId}: ${motivo}`);
    return c.json({ error: "Armazenamento de objetos indisponível no momento" }, 503);
  }
});

/** DELETE /api/posts/:id/midia/:midiaId */
recursos.delete("/:id/midia/:midiaId", exigePermissao("enviar:midia"), async (c) => {
  const id = Number(c.req.param("id"));
  const midiaId = Number(c.req.param("midiaId"));

  const post = await carregarPost(id);
  if (!post) return c.json({ error: "Post não encontrado" }, 404);
  if (!podeEditar(post, c.get("usuarioId"), c.get("role"))) {
    return recusaAcesso(c, "Ação negada: você só pode apagar mídias dos próprios posts.");
  }

  const [midia] = await db
    .select()
    .from(midias)
    .where(and(eq(midias.id, midiaId), eq(midias.postId, id)))
    .limit(1);
  if (!midia) return c.json({ error: "Mídia não encontrada" }, 404);

  await removerMidia(midia.chaveObjeto);
  await db.delete(midias).where(eq(midias.id, midiaId));

  await registrar({
    acao: "midia_removida",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `post:${id}`,
    detalhe: midia.nomeArquivo,
    ip: ipDe(c),
  });

  return c.json({ message: "Mídia removida" });
});

/* -------------------------------------------------------------------------- */
/* MÍDIA PÚBLICA ASSINADA — usada pela Meta para baixar a imagem na publicação */
/* -------------------------------------------------------------------------- */

/**
 * A Graph API baixa a imagem de uma URL pública. Em vez de expor o MinIO,
 * emitimos um link com expiração e HMAC. Sem assinatura válida, 403.
 */
export const midiaPublica = new Hono();

midiaPublica.get("/:midiaId", async (c) => {
  const midiaId = Number(c.req.param("midiaId"));
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";

  if (!Number.isInteger(midiaId) || !urlMidiaValida(midiaId, exp, sig)) {
    return c.json({ error: "Link expirado ou assinatura inválida" }, 403);
  }

  const [midia] = await db.select().from(midias).where(eq(midias.id, midiaId)).limit(1);
  if (!midia) return c.json({ error: "Mídia não encontrada" }, 404);

  try {
    const arquivo = await obterMidia(midia.chaveObjeto);
    if (!arquivo) return c.json({ error: "Arquivo não encontrado no armazenamento" }, 404);

    return new Response(arquivo.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: {
        "Content-Type": arquivo.contentType,
        "Content-Length": String(arquivo.bytes.length),
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(`[midia-publica] falha ao ler ${midiaId}: ${motivo}`);
    return c.json({ error: "Armazenamento de objetos indisponível no momento" }, 503);
  }
});

export default recursos;
