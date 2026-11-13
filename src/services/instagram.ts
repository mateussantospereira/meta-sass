/**
 * Integração real com o Instagram (Meta Graph API).
 *
 * Fluxo OAuth:
 *   1. `/api/instagram/conectar` monta a URL do diálogo da Meta.
 *   2. O usuário autoriza e volta em `/api/instagram/callback` com `code`.
 *   3. Trocamos o code por um token de usuário, estendemos para 60 dias e
 *      listamos as Páginas do Facebook com `instagram_business_account`.
 *   4. Guardamos o token da Página **cifrado** em `contas_sociais`.
 *
 * Publicação:
 *   1. Criamos um container de mídia com uma URL pública assinada da imagem.
 *   2. Esperamos o container ficar `FINISHED`.
 *   3. Publicamos com `media_publish` e lemos o `permalink`.
 *
 * Sem META_APP_ID/META_APP_SECRET o módulo fica inerte e o app continua no ar;
 * contas manuais seguem funcionando em modo simulado.
 */

import { assinarUrlMidia } from "./cripto";

export const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION ?? "v22.0").trim();
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const OAUTH_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

export const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL ?? "http://localhost:8222").replace(/\/+$/, "");
export const META_APP_ID = (process.env.META_APP_ID ?? "").trim();
const META_APP_SECRET = (process.env.META_APP_SECRET ?? "").trim();
export const META_REDIRECT_URI =
  (process.env.META_REDIRECT_URI ?? "").trim() || `${APP_PUBLIC_URL}/api/instagram/callback`;

/** Permissões necessárias para ler o perfil e publicar conteúdo. */
const ESCOPOS = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

export const instagramConfigurado = Boolean(META_APP_ID && META_APP_SECRET);

/** App ID mascarado para exibir na tela sem vazar credencial. */
export function appIdPublico(): string | null {
  if (!META_APP_ID) return null;
  return META_APP_ID.length <= 6 ? "***" : `${META_APP_ID.slice(0, 4)}…${META_APP_ID.slice(-2)}`;
}

export function urlAutorizacao(state: string): string {
  const url = new URL(OAUTH_DIALOG);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", ESCOPOS);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

type RespostaGraph<T> = T & { error?: { message?: string; type?: string; code?: number } };

async function lerJson<T>(res: Response): Promise<RespostaGraph<T>> {
  const json = (await res.json().catch(() => null)) as RespostaGraph<T> | null;
  if (!res.ok || json?.error) {
    const motivo = json?.error?.message ?? `Graph API respondeu HTTP ${res.status}`;
    throw new Error(motivo);
  }
  return (json ?? ({} as RespostaGraph<T>));
}

async function graphGet<T>(caminho: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${caminho}`);
  for (const [chave, valor] of Object.entries(params)) url.searchParams.set(chave, valor);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return (await lerJson<T>(res)) as T;
}

async function graphPost<T>(caminho: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });
  return (await lerJson<T>(res)) as T;
}

/** Troca o `code` do callback por um token de usuário de curta duração. */
export async function trocarCodigoPorToken(code: string): Promise<string> {
  const dados = await graphGet<{ access_token?: string }>("oauth/access_token", {
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code,
  });
  if (!dados.access_token) throw new Error("A Meta não devolveu um access_token.");
  return dados.access_token;
}

/** Estende o token de usuário para ~60 dias. */
export async function estenderToken(tokenCurto: string): Promise<string> {
  const dados = await graphGet<{ access_token?: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: tokenCurto,
  });
  return dados.access_token ?? tokenCurto;
}

export type ContaInstagramDescoberta = {
  instagramUserId: string;
  username: string | null;
  nome: string;
  facebookPageId: string;
  facebookPageName: string;
  tokenPagina: string;
};

type PaginaMeta = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
  };
};

/** Lista as Páginas do usuário que têm uma conta profissional do Instagram. */
export async function listarContasInstagram(tokenUsuario: string): Promise<ContaInstagramDescoberta[]> {
  const resposta = await graphGet<{ data?: PaginaMeta[] }>("me/accounts", {
    access_token: tokenUsuario,
    limit: "100",
    fields:
      "id,name,access_token,instagram_business_account{id,username,name}",
  });

  const contas: ContaInstagramDescoberta[] = [];
  for (const pagina of resposta.data ?? []) {
    const ig = pagina.instagram_business_account;
    if (!ig?.id || !pagina.access_token) continue;
    contas.push({
      instagramUserId: ig.id,
      username: ig.username ?? null,
      nome: ig.username ? `@${ig.username}` : ig.name || pagina.name || "Instagram",
      facebookPageId: pagina.id,
      facebookPageName: pagina.name ?? "Página do Facebook",
      tokenPagina: pagina.access_token,
    });
  }
  return contas;
}

export function urlPublicaMidia(midiaId: number, validadeSegundos = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + validadeSegundos;
  const sig = assinarUrlMidia(midiaId, exp);
  return `${APP_PUBLIC_URL}/api/midia-publica/${midiaId}?exp=${exp}&sig=${sig}`;
}

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Publica uma imagem no perfil do Instagram.
 * A imagem precisa estar acessível publicamente (URL assinada servida pelo app).
 */
export async function publicarNoInstagram(opcoes: {
  instagramUserId: string;
  tokenPagina: string;
  imagemUrl: string;
  legenda: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const container = await graphPost<{ id?: string }>(`${opcoes.instagramUserId}/media`, {
    image_url: opcoes.imagemUrl,
    caption: opcoes.legenda.slice(0, 2200),
    access_token: opcoes.tokenPagina,
  });
  if (!container.id) throw new Error("A Meta não devolveu o id do container de mídia.");

  // O processamento da imagem é assíncrono; publicar antes de FINISHED falha.
  let pronto = false;
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    await espera(2000);
    const status = await graphGet<{ status_code?: string; status?: string }>(container.id, {
      fields: "status_code,status",
      access_token: opcoes.tokenPagina,
    });
    if (status.status_code === "FINISHED") { pronto = true; break; }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(status.status || `Container de mídia em estado ${status.status_code}.`);
    }
  }
  if (!pronto) throw new Error("A Meta não concluiu o processamento da imagem a tempo.");

  const publicado = await graphPost<{ id?: string }>(`${opcoes.instagramUserId}/media_publish`, {
    creation_id: container.id,
    access_token: opcoes.tokenPagina,
  });
  if (!publicado.id) throw new Error("A Meta não devolveu o id da publicação.");

  let permalink: string | null = null;
  try {
    const info = await graphGet<{ permalink?: string }>(publicado.id, {
      fields: "permalink",
      access_token: opcoes.tokenPagina,
    });
    permalink = info.permalink ?? null;
  } catch {
    // O permalink é um extra; a publicação em si já aconteceu.
  }

  return { mediaId: publicado.id, permalink };
}
