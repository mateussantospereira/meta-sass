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
  META_SCOPES,
  appIdPublico,
  estenderToken,
  instagramConfigurado,
  listarContasInstagram,
  trocarCodigoPorToken,
  urlAutorizacao,
} from "../services/instagram";
import type { Env } from "../types";

/**
 * OAuth oficial da Meta para conectar uma conta profissional do Instagram.
 *
 * O callback é público de propósito: a Meta chega nele sem Bearer. A prova de
 * identidade é o `state` assinado com HMAC, que carrega o usuário e expira em
 * 10 minutos. O token resultante é cifrado antes de tocar o banco.
 */
const ig = new Hono<Env>();

function redirecionarErro(c: Context<Env>, motivo: string) {
  const texto = encodeURIComponent(motivo.slice(0, 300));
  return c.redirect(`${APP_PUBLIC_URL}/painel?instagram=erro&motivo=${texto}`);
}

/** GET /api/instagram/callback — retorno da Meta. Público, validado pelo state. */
ig.get("/callback", async (c) => {
  const erroMeta = c.req.query("error_description") ?? c.req.query("error");
  if (erroMeta) return redirecionarErro(c, erroMeta);

  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code) return redirecionarErro(c, "Callback sem código de autorização.");

  const dados = lerState(state);
  const uid = Number(dados?.uid);
  const exp = Number(dados?.exp);
  if (!dados || !Number.isInteger(uid) || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return redirecionarErro(c, "State inválido ou expirado. Inicie a conexão novamente.");
  }

  try {
    if (!instagramConfigurado) throw new Error("Integração da Meta não configurada neste ambiente.");

    const tokenCurto = await trocarCodigoPorToken(code);
    const tokenLongo = await estenderToken(tokenCurto);
    const contas = await listarContasInstagram(tokenLongo);

    if (contas.length === 0) {
      throw new Error(
        "Nenhuma conta profissional do Instagram vinculada a uma Página do Facebook foi encontrada."
      );
    }

    const expiraEm = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    let conectadas = 0;

    for (const conta of contas) {
      const [existente] = await db
        .select()
        .from(contasSociais)
        .where(eq(contasSociais.instagramUserId, conta.instagramUserId))
        .limit(1);

      // Uma conta do Instagram pertence a um único usuário do SaaS.
      if (existente && existente.usuarioId !== uid) continue;

      const valores = {
        usuarioId: uid,
        rede: "instagram",
        nome: conta.nome,
        identificador: conta.instagramUserId,
        instagramUserId: conta.instagramUserId,
        facebookPageId: conta.facebookPageId,
        username: conta.username,
        accessTokenCifrado: cifrar(conta.tokenPagina),
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
      throw new Error("As contas encontradas já estão vinculadas a outro usuário do MetaSass.");
    }

    await registrar({
      acao: "instagram_conectado",
      usuario_id: uid,
      usuario: String(dados.nome ?? "conta"),
      papel: String(dados.papel ?? "social_media"),
      recurso: `usuario:${uid}`,
      detalhe: `${conectadas} conta(s) conectada(s) via OAuth · ${contas.map((x) => x.username ?? x.instagramUserId).join(", ")}`,
      ip: ipDe(c),
    });

    return c.redirect(`${APP_PUBLIC_URL}/painel?instagram=conectado&contas=${conectadas}`);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(`[instagram] falha no callback: ${motivo}`);
    return redirecionarErro(c, motivo);
  }
});

/* Daqui para baixo, tudo exige sessão válida do auth-service. */
ig.use("/*", authMiddleware);

/** GET /api/instagram/status — configuração do ambiente + contas via API. */
ig.get("/status", async (c) => {
  const filtro = and(
    eq(contasSociais.usuarioId, c.get("usuarioId")),
    eq(contasSociais.conectadoVia, "api")
  );
  const [linha] = await db.select({ total: count() }).from(contasSociais).where(filtro);

  return c.json({
    configurado: instagramConfigurado,
    appId: appIdPublico(),
    redirectUri: META_REDIRECT_URI,
    versaoApi: META_GRAPH_VERSION,
    contasConectadas: Number(linha?.total ?? 0),
    escopos: META_SCOPES.split(",").filter(Boolean),
  });
});

/** GET /api/instagram/conectar — devolve a URL do diálogo da Meta. */
ig.get("/conectar", exigePermissao("gerenciar:contas"), async (c) => {
  if (!instagramConfigurado) {
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
    uid: c.get("usuarioId"),
    nome: c.get("nome"),
    papel: c.get("role"),
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  return c.json({ url: urlAutorizacao(state), expiraEmSegundos: 600 });
});

/** POST /api/instagram/:id/desconectar — apaga o token e desativa a conta. */
ig.post("/:id/desconectar", exigePermissao("gerenciar:contas"), async (c) => {
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
    acao: "instagram_desconectado",
    usuario_id: c.get("usuarioId"),
    usuario: c.get("nome"),
    papel: c.get("role"),
    recurso: `conta_social:${id}`,
    detalhe: `token removido · ${conta.username ?? conta.nome}`,
    ip: ipDe(c),
  });

  return c.json({ message: "Conta desconectada e token removido" });
});

export default ig;
