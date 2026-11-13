/**
 * Integração real com Facebook Pages (Graph API).
 *
 * Fluxo semelhante ao Instagram: OAuth -> token de usuário -> páginas
 * administradas -> guardar token da Página cifrado. Publicação envia uma foto
 * para `/{page-id}/photos` usando a URL pública assinada da mídia.
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

export const META_SCOPES_FACEBOOK = (
  process.env.META_SCOPES_FACEBOOK ?? "pages_show_list,pages_read_engagement,pages_manage_posts"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .join(",");

export const metaConfigurado = Boolean(META_APP_ID && META_APP_SECRET);

export function urlAutorizacaoFacebook(state: string): string {
  const url = new URL(OAUTH_DIALOG);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES_FACEBOOK);
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

export async function estenderToken(tokenCurto: string): Promise<string> {
  const dados = await graphGet<{ access_token?: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: tokenCurto,
  });
  return dados.access_token ?? tokenCurto;
}

export type PaginaFacebookDescoberta = {
  pageId: string;
  nome: string;
  tokenPagina: string;
};

type PaginaMeta = { id: string; name?: string; access_token?: string };

/** Lista as Páginas do Facebook que o usuário administra. */
export async function listarPaginasFacebook(tokenUsuario: string): Promise<PaginaFacebookDescoberta[]> {
  const resposta = await graphGet<{ data?: PaginaMeta[] }>("me/accounts", {
    access_token: tokenUsuario,
    limit: "100",
    fields: "id,name,access_token",
  });
  const paginas: PaginaFacebookDescoberta[] = [];
  for (const pagina of resposta.data ?? []) {
    if (!pagina.id || !pagina.access_token) continue;
    paginas.push({
      pageId: pagina.id,
      nome: pagina.name || "Página do Facebook",
      tokenPagina: pagina.access_token,
    });
  }
  return paginas;
}

export function urlPublicaMidia(midiaId: number, validadeSegundos = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + validadeSegundos;
  const sig = assinarUrlMidia(midiaId, exp);
  return `${APP_PUBLIC_URL}/api/midia-publica/${midiaId}?exp=${exp}&sig=${sig}`;
}

/** Publica uma foto na Página do Facebook. */
export async function publicarNaPaginaFacebook(opcoes: {
  pageId: string;
  tokenPagina: string;
  imagemUrl: string;
  legenda: string;
}): Promise<{ postId: string; permalink: string | null }> {
  const publicado = await graphPost<{ id?: string; post_id?: string }>(`${opcoes.pageId}/photos`, {
    url: opcoes.imagemUrl,
    caption: opcoes.legenda.slice(0, 5000),
    published: "true",
    access_token: opcoes.tokenPagina,
  });
  const postId = publicado.post_id || publicado.id;
  if (!postId) throw new Error("A Meta não devolveu o id da publicação.");

  let permalink: string | null = null;
  try {
    const info = await graphGet<{ permalink_url?: string }>(postId, {
      fields: "permalink_url",
      access_token: opcoes.tokenPagina,
    });
    permalink = info.permalink_url ?? null;
  } catch {
    // id da foto != id do post em alguns casos; tenta via photo id
    if (publicado.id && publicado.id !== postId) {
      try {
        const info = await graphGet<{ permalink_url?: string }>(publicado.id, {
          fields: "permalink_url",
          access_token: opcoes.tokenPagina,
        });
        permalink = info.permalink_url ?? null;
      } catch {}
    }
  }

  return { postId, permalink };
}
