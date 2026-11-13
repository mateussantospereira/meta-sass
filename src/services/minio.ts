/**
 * Object storage (MinIO) — mídia do post.
 *
 * O binário vai para o MinIO; o MariaDB guarda só a chave em `midias`. O
 * navegador nunca fala com o MinIO: a aplicação serve os bytes pela rota
 * autenticada `/api/posts/:id/midia/:midiaId/arquivo`, que confere o dono do
 * post antes de devolver qualquer coisa.
 *
 * Falha do MinIO nunca derruba o app: as rotas devolvem 503 e o restante do
 * sistema continua funcionando.
 */

import { Client } from "minio";

const URL_RAW = (process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000").replace(/\/+$/, "");
const useSSL = URL_RAW.startsWith("https://");
const SEM_PROTOCOLO = URL_RAW.replace(/^https?:\/\//, "");
const [endPoint, portaTexto] = SEM_PROTOCOLO.split(":");

export const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "metasass-midias";
export const TAMANHO_MAX_MIDIA = Number(process.env.TAMANHO_MAX_MIDIA_MB ?? 5) * 1024 * 1024;

const cliente = new Client({
  endPoint,
  port: portaTexto ? Number(portaTexto) : useSSL ? 443 : 80,
  useSSL,
  accessKey: process.env.MINIO_ROOT_USER ?? "",
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
});

export async function garantirBucket(): Promise<void> {
  try {
    if (!(await cliente.bucketExists(MINIO_BUCKET))) {
      await cliente.makeBucket(MINIO_BUCKET, "us-east-1");
      console.log(`[minio] bucket "${MINIO_BUCKET}" criado`);
    }
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new Error(`bucket inacessível (${motivo})`);
  }
}

export type FormatoImagem = "png" | "jpg" | "gif" | "webp";

/** Confirma o formato pelos magic bytes, não só pelo Content-Type do cliente. */
export function detectarFormato(contentType: string, bytes: Uint8Array): FormatoImagem | null {
  const b = bytes;
  if (!contentType.startsWith("image/")) return null;

  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

const CONTENT_TYPE: Record<FormatoImagem, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Remove qualquer coisa que possa virar caminho dentro da chave do objeto. */
function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);
}

export async function enviarMidia(
  usuarioId: number,
  postId: number,
  nomeArquivo: string,
  bytes: Buffer,
  formato: FormatoImagem
): Promise<string> {
  await garantirBucket();
  const chave = `posts/${usuarioId}/${postId}/${Date.now()}-${nomeSeguro(nomeArquivo) || `imagem.${formato}`}`;
  await cliente.putObject(MINIO_BUCKET, chave, bytes, bytes.length, {
    "Content-Type": CONTENT_TYPE[formato],
  });
  return chave;
}

export async function removerMidia(chave: string): Promise<void> {
  try {
    await cliente.removeObject(MINIO_BUCKET, chave);
  } catch {
    // A chave já pode não existir. Não impedir a exclusão do registro por isso.
  }
}

export type MidiaLida = { bytes: Buffer; contentType: string };

export async function obterMidia(chave: string): Promise<MidiaLida | null> {
  try {
    const stat = await cliente.statObject(MINIO_BUCKET, chave);
    const stream = await cliente.getObject(MINIO_BUCKET, chave);
    const partes: Buffer[] = [];
    for await (const parte of stream as AsyncIterable<Buffer>) {
      partes.push(Buffer.from(parte));
    }
    return {
      bytes: Buffer.concat(partes),
      contentType: stat.metaData?.["content-type"] ?? "application/octet-stream",
    };
  } catch (erro: any) {
    if (erro?.code === "NoSuchKey" || erro?.message?.includes("NoSuchKey")) return null;
    throw erro;
  }
}
