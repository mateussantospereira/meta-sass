import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import { db } from "../db";
import { contasSociais, posts } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { exigePermissao } from "../middleware/permissao";
import { registrar, ipDe } from "../services/log-service";
import type { Env } from "../types";

/**
 * Contas sociais conectadas (Instagram / Facebook).
 *
 * Cada conta pertence ao usuário que a cadastrou. O admin enxerga todas para
 * administrar o SaaS; os demais só enxergam as próprias. É uma tabela de apoio
 * do recurso principal `posts`, mas também tem CRUD próprio e aparece na tela.
 */
const contas = new Hono<Env>();
contas.use("/*", authMiddleware);

const REDES = ["instagram", "facebook"] as const;

function ehAdmin(role: string): boolean {
  return role === "admin";
}

/** GET /api/contas-sociais */
contas.get("/", async (c) => {
  const filtro = ehAdmin(c.get("role")) ? undefined : eq(contasSociais.usuarioId, c.get("usuarioId"));
  const linhas = await db
    .select()
    .from(contasSociais)
    .where(filtro)
    .orderBy(contasSociais.id);

  return c.json({ contas: linhas, total: linhas.length });
});

/** POST /api/contas-sociais — conecta uma conta ao usuário do token. */
contas.post("/", exigePermissao("gerenciar:contas"), async (c) => {
  const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const rede = String(corpo.rede ?? "").trim().toLowerCase();
  const nome = String(corpo.nome ?? "").trim();
  const identificador = corpo.identificador ? String(corpo.identificador).trim() : null;

  if (!REDES.includes(rede as (typeof REDES)[number])) {
    return c.json({ error: 'Campo "rede" deve ser "instagram" ou "facebook"' }, 400);
  }
  if (!nome) return c.json({ error: 'Campo "nome" é obrigatório' }, 400);

  try {
    const [nova] = await db
      .insert(contasSociais)
      .values({
        usuarioId: c.get("usuarioId"),
        rede,
        nome,
        identificador,
      })
      .$returningId();

    await registrar({
      acao: "conta_social_conectada",
      usuario_id: c.get("usuarioId"),
      usuario: c.get("nome"),
      papel: c.get("role"),
      recurso: `conta_social:${nova.id}`,
      detalhe: `${rede} · ${nome}`,
      ip: ipDe(c),
    });

    return c.json({ message: "Conta social conectada", conta: { id: nova.id, rede, nome, identificador } }, 201);
  } catch (erro: any) {
    if (erro?.cause?.code === "ER_DUP_ENTRY" || erro?.code === "ER_DUP_ENTRY") {
      return c.json({ error: "Esta conta social já está conectada." }, 409);
    }
    throw erro;
  }
});

/** PATCH /api/contas-sociais/:id — edita nome/identificador/ativa. */
contas.patch("/:id", exigePermissao("gerenciar:contas"), async (c) => {
  const id = Number(c.req.param("id"));
  const [conta] = await db.select().from(contasSociais).where(eq(contasSociais.id, id)).limit(1);
  if (!conta) return c.json({ error: "Conta social não encontrada" }, 404);
  if (!ehAdmin(c.get("role")) && conta.usuarioId !== c.get("usuarioId")) {
    return c.json(
      { error: "Ação negada: esta conta social pertence a outro usuário.", permissao_exigida: "gerenciar:contas", papel: c.get("role") },
      403
    );
  }

  const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: Partial<typeof contasSociais.$inferInsert> = {};
  if (corpo.nome !== undefined) set.nome = String(corpo.nome).trim();
  if (corpo.identificador !== undefined) {
    set.identificador = corpo.identificador === null ? null : String(corpo.identificador).trim();
  }
  if (corpo.ativa !== undefined) set.ativa = Boolean(corpo.ativa);
  if (Object.keys(set).length === 0) return c.json({ error: "Nenhum campo para atualizar" }, 400);

  await db.update(contasSociais).set(set).where(eq(contasSociais.id, id));

  await registrar({
    acao: "conta_social_editada",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `conta_social:${id}`,
    detalhe: `campos: ${Object.keys(set).join(", ")}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Conta social atualizada", campos: Object.keys(set) });
});

/** DELETE /api/contas-sociais/:id — não apaga conta com posts vinculados. */
contas.delete("/:id", exigePermissao("gerenciar:contas"), async (c) => {
  const id = Number(c.req.param("id"));
  const [conta] = await db.select().from(contasSociais).where(eq(contasSociais.id, id)).limit(1);
  if (!conta) return c.json({ error: "Conta social não encontrada" }, 404);
  if (!ehAdmin(c.get("role")) && conta.usuarioId !== c.get("usuarioId")) {
    return c.json(
      { error: "Ação negada: esta conta social pertence a outro usuário.", permissao_exigida: "gerenciar:contas", papel: c.get("role") },
      403
    );
  }

  const [vinculos] = await db.select({ total: count() }).from(posts).where(eq(posts.contaSocialId, id));
  if (Number(vinculos?.total ?? 0) > 0) {
    return c.json({ error: "Esta conta possui posts vinculados. Remova os posts antes." }, 409);
  }

  await db.delete(contasSociais).where(eq(contasSociais.id, id));

  await registrar({
    acao: "conta_social_removida",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `conta_social:${id}`,
    detalhe: `${conta.rede} · ${conta.nome}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Conta social removida" });
});

export default contas;
