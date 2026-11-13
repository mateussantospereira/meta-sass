/**
 * Seed da demonstração MetaSass.
 *
 * Executa `db/003_seed.sql`, que cria três contas com os três papéis do
 * negócio, duas contas sociais e dois posts de exemplo. É idempotente: usa
 * `ON DUPLICATE KEY`/`INSERT IGNORE`, então rodar de novo não duplica dados.
 *
 *   bun run db:seed
 *
 * Credenciais (documentadas no README):
 *   admin@metasass.app      / Admin@123
 *   social@metasass.app     / Social@123
 *   cliente@metasass.app    / Cliente@123
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";

const ARQUIVO = join(import.meta.dir, "..", "..", "db", "003_seed.sql");

function separarComandos(texto: string): string[] {
  return texto
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((comando) => comando.trim())
    .filter(Boolean);
}

const conexao = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const comandos = separarComandos(await readFile(ARQUIVO, "utf8"));
  console.log(`[seed] ${comandos.length} comando(s) em db/003_seed.sql`);

  for (const comando of comandos) {
    await conexao.query(comando);
    console.log(`  [ok] ${comando.split("\n")[0].slice(0, 80)}`);
  }

  const [usuarios] = await conexao.query<mysql.RowDataPacket[]>(
    `SELECT nome, email, role, premium FROM usuarios
      WHERE email IN ('admin@metasass.app','social@metasass.app','cliente@metasass.app')
      ORDER BY id`
  );
  console.log("\n[seed] contas de demonstração:");
  for (const u of usuarios) {
    console.log(`  - ${u.email} (${u.role}${u.premium ? ", pro" : ", grátis"})`);
  }
  console.log("\n[seed] pronto. Senhas: Admin@123, Social@123, Cliente@123.");
} catch (erro) {
  console.error("[seed] falhou:", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
