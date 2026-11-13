import { defineConfig } from "drizzle-kit";

/**
 * A aplicação MetaSass é dona das tabelas do domínio:
 * contas_sociais, posts, midias, aprovacoes e assinaturas.
 *
 * `usuarios` e `reset_tokens` pertencem ao auth-service. Elas aparecem no
 * schema apenas para as chaves estrangeiras, mas o `tablesFilter` impede que
 * um `db:push` daqui tente criar/alterar/dropar as tabelas do outro serviço.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  tablesFilter: ["contas_sociais", "posts", "midias", "aprovacoes", "assinaturas"],
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
  },
});
