import { Hono } from "hono";
import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import { db } from "../db";
import { contasSociais } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { exigePermissao } from "../middleware/permissao";
import { registrar, ipDe } from "../services/log-service";
import { cifrar, criarState, lerState } from "../services/cripto";
import {
  APP_PUBLIC_URL,
  META_GRAPH_VERSION,
  META_REDIRECT_URI,
  META_SCOPES_FACEBOOK,
  estenderToken,
  listarPaginasFacebook,
  metaConfigurado,
  trocarCodigoPorToken,
  urlAutorizacaoFacebook,
} from "../services/facebook";
import { appIdPublico } from "../services/instagram";
import type { Env } from "../types";

const fb = new Hono<Env>();

function redirecionarErro(c: Context<Env>, motivo: string) {
  const texto = encodeURIComponent(motivo.slice(0, 300));
  return c.redirect(`${APP_PUBLIC_URL}/painel?facebook=erro&motivo=${texto}`);
}

/** Processa o callback OAuth para Páginas do Facebook (reusado por /api/instagram/callback). */
export async function processarCallbackFacebook(c: Context<Env>, code: string, dados: Record<string, unknown>) {
  const uid = Number(dados.uid);
  const exp = Number(dados.exp);
  if (!Number.isInteger(uid) || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return redirecionarErro(c, "State inválido ou expirado. Inicie a conexão novamente.");
  }

  try {
    if (!metaConfigurado) throw new Error("Integração da Meta não configurada neste ambiente.");

    const tokenCurto = await trocarCodigoPorToken(code);
    const tokenLongo = await estenderToken(tokenCurto);
    const paginas = await listarPaginasFacebook(tokenLongo);

    if (paginas.length === 0) {
      throw new Error("Nenhuma Página do Facebook administrada por você foi encontrada.");
    }

    const expiraEm = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    let conectadas = 0;

    for (const pagina of paginas) {
      // Identificamos a conta de Página pelo identificador (page id) + rede facebook.
      const [existente] = await db
        .select()
        .from(contasSociais)
        .where(and(eq(contasSociais.rede, "facebook"), eq(contasSociais.identificador, pagina.pageId)))
        .limit(1);

      if (existente && existente.usuarioId !== uid) continue;

      const valores = {
        usuarioId: uid,
        rede: "facebook",
        nome: pagina.nome,
        identificador: pagina.pageId,
        instagramUserId: null,
        facebookPageId: pagina.pageId,
        username: null,
        accessTokenCifrado: cifrar(pagina.tokenPagina),
        tokenExpiraEm: expiraEm,
        conectadoVia: "api",
        ultimaSincronizacao: new Date(),
        ativa: true,
      };

      if (existente) {
        await db.update(contasSociais).set(valores).where(eq(contasSociais.id, existente.id));
      } else {
        await db.insert(contasSociais).values(valores);
      }
      conectadas++;
    }

    if (conectadas === 0) {
      throw new Error("As páginas encontradas já estão vinculadas a outro usuário do MetaSass.");
    }

    await registrar({
      acao: "facebook_conectado",
      usuario_id: uid,
      usuario: String(dados.nome ?? "conta"),
      papel: String(dados.papel ?? "social_media"),
      recurso: `usuario:${uid}`,
      detalhe: `${conectadas} página(s) conectada(s) via OAuth · ${paginas.map((x) => x.nome).join(", ")}`,
      ip: ipDe(c),
    });

    return c.redirect(`${APP_PUBLIC_URL}/painel?facebook=conectado&contas=${conectadas}`);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(`[facebook] falha no callback: ${motivo}`);
    return redirecionarErro(c, motivo);
  }
}

/** GET /api/facebook/callback — público (alternativo; o principal é /api/instagram/callback). */
fb.get("/callback", async (c) => {
  const erroMeta = c.req.query("error_description") ?? c.req.query("error");
  if (erroMeta) return redirecionarErro(c, erroMeta);
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code) return redirecionarErro(c, "Callback sem código de autorização.");
  const dados = lerState(state);
  if (!dados) return redirecionarErro(c, "State inválido ou expirado. Inicie a conexão novamente.");
  return processarCallbackFacebook(c, code, dados);
});

fb.use("/*", authMiddleware);

/** GET /api/facebook/status */
fb.get("/status", async (c) => {
  const filtro = and(
    eq(contasSociais.usuarioId, c.get("usuarioId")),
    eq(contasSociais.conectadoVia, "api"),
    eq(contasSociais.rede, "facebook")
  );
  const [linha] = await db.select({ total: count() }).from(contasSociais).where(filtro);

  return c.json({
    configurado: metaConfigurado,
    appId: appIdPublico(),
    redirectUri: META_REDIRECT_URI,
    versaoApi: META_GRAPH_VERSION,
    contasConectadas: Number(linha?.total ?? 0),
    escopos: META_SCOPES_FACEBOOK.split(",").filter(Boolean),
  });
});

/** GET /api/facebook/conectar */
fb.get("/conectar", exigePermissao("gerenciar:contas"), async (c) => {
  if (!metaConfigurado) {
    return c.json(
      {
        error: "Integração da Meta não configurada. Defina META_APP_ID e META_APP_SECRET.",
        faltando: ["META_APP_ID", "META_APP_SECRET"],
        redirectUri: META_REDIRECT_URI,
      },
      503
    );
  }

  const state = criarState({
    provider: "facebook",
    uid: c.get("usuarioId"),
    nome: c.get("nome"),
    papel: c.get("role"),
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  return c.json({ url: urlAutorizacaoFacebook(state), expiraEmSegundos: 600 });
});

/** POST /api/facebook/:id/desconectar */
fb.post("/:id/desconectar", exigePermissao("gerenciar:contas"), async (c) => {
  const id = Number(c.req.param("id"));
  const [conta] = await db.select().from(contasSociais).where(eq(contasSociais.id, id)).limit(1);
  if (!conta) return c.json({ error: "Conta social não encontrada" }, 404);
  if (conta.usuarioId !== c.get("usuarioId") && c.get("role") !== "admin") {
    return c.json(
      {
        error: "Ação negada: esta conta social pertence a outro usuário.",
        permissao_exigida: "gerenciar:contas",
        papel: c.get("role"),
      },
      403
    );
  }

  await db
    .update(contasSociais)
    .set({ accessTokenCifrado: null, tokenExpiraEm: null, ativa: false, ultimaSincronizacao: new Date() })
    .where(eq(contasSociais.id, id));

  await registrar({
    acao: "facebook_desconectado",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `conta_social:${id}`,
    detalhe: `token removido · ${conta.nome}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Conta desconectada e token removido" });
});

export default fb;
