/**
 * Criptografia de segredos de integração (tokens da Meta).
 *
 * O token de acesso da Página nunca é guardado em texto puro nem devolvido por
 * API. Ele é cifrado com AES-256-GCM usando `APP_ENCRYPTION_KEY`; o banco
 * guarda apenas o envelope `iv.tag.ciphertext` em base64.
 *
 * O mesmo segredo assina o `state` do OAuth (HMAC) e as URLs públicas de mídia
 * que a Meta precisa baixar para publicar. Nada disso depende do JWT do
 * auth-service: o app não conhece o segredo de sessão.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SEGREDO = process.env.APP_ENCRYPTION_KEY?.trim() || "metasass-dev-key-troque-em-producao";
const CHAVE = createHash("sha256").update(SEGREDO).digest();

/** Cifra um texto arbitrário (token OAuth) em um envelope base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", CHAVE, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, cifrado].map((parte) => parte.toString("base64url")).join(".");
}

/** Devolve null quando o envelope está corrompido ou foi cifrado com outra chave. */
export function decifrar(envelope: string): string | null {
  try {
    const [ivB64, tagB64, dadosB64] = envelope.split(".");
    if (!ivB64 || !tagB64 || !dadosB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", CHAVE, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const aberto = Buffer.concat([decipher.update(Buffer.from(dadosB64, "base64url")), decipher.final()]);
    return aberto.toString("utf8");
  } catch {
    return null;
  }
}

function hmac(texto: string): string {
  return createHmac("sha256", CHAVE).update(texto).digest("base64url");
}

function iguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function assinar(texto: string): string {
  return hmac(texto);
}

export function assinaturaValida(texto: string, assinatura: string): boolean {
  return iguais(hmac(texto), assinatura);
}

/** `state` do OAuth: payload JSON + HMAC, sem necessidade de sessão no servidor. */
export function criarState(dados: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(dados), "utf8").toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function lerState(state: string): Record<string, unknown> | null {
  const [payload, assinatura] = state.split(".");
  if (!payload || !assinatura || !iguais(hmac(payload), assinatura)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** URL pública e assinada que a Meta pode baixar (não exige Bearer). */
export function assinarUrlMidia(midiaId: number, expiraEm: number): string {
  return hmac(`${midiaId}.${expiraEm}`);
}

export function urlMidiaValida(midiaId: number, expiraEm: number, assinatura: string): boolean {
  if (!Number.isFinite(expiraEm) || expiraEm < Math.floor(Date.now() / 1000)) return false;
  return iguais(hmac(`${midiaId}.${expiraEm}`), assinatura);
}
