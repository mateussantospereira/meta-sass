import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import authRoutes from "./routes/auth";
import postsRoutes, { midiaPublica } from "./routes/posts";
import contasRoutes from "./routes/contas-sociais";
import instagramRoutes from "./routes/instagram";
import facebookRoutes from "./routes/facebook";
import usuariosRoutes from "./routes/usuarios";
import logsRoutes from "./routes/logs";
import planoRoutes from "./routes/plano";
import { auditoria403Middleware } from "./middleware/auditoria";
import { garantirBucket, MINIO_BUCKET } from "./services/minio";
import { instagramConfigurado } from "./services/instagram";

/**
 * MetaSass — o único container com porta publicada.
 *
 * O app é a borda do sistema: serve as páginas, o JavaScript e a API pública.
 * Autenticação é delegada ao auth-service; auditoria, ao log-service. Nenhuma
 * senha, JWT_SECRET ou regra de papel mora aqui.
 */
const app = new Hono();

// Auditoria central: toda resposta 403 vira um evento `acao_negada` no stream.
app.use("*", auditoria403Middleware);

app.route("/api", authRoutes);
app.route("/api/posts", postsRoutes);
app.route("/api/contas-sociais", contasRoutes);
// OAuth oficial da Meta: conectar Instagram e desconectar conta.
app.route("/api/instagram", instagramRoutes);
// OAuth oficial da Meta: conectar Páginas do Facebook e desconectar.
app.route("/api/facebook", facebookRoutes);
// Link público e assinado que a Meta baixa para publicar a imagem.
app.route("/api/midia-publica", midiaPublica);
// Exclusivo de admin: listar usuários e trocar papel.
app.route("/api/usuarios", usuariosRoutes);
// Exclusivo de admin: consultar o stream de auditoria no Redis.
app.route("/api/logs", logsRoutes);
// Plano Pro: checkout no Stripe + webhook + status.
app.route("/api/plano", planoRoutes);

/** Healthcheck do container. Não toca em serviços externos de propósito. */
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    servico: "app",
    produto: "MetaSass",
    auth_service: process.env.AUTH_SERVICE_URL ?? "http://auth-service:3000",
    log_service: process.env.LOG_SERVICE_URL ?? "http://log-service:3000",
    instagram_oauth: instagramConfigurado,
  })
);

app.get("/api/*", (c) => c.json({ error: "Rota não encontrada" }, 404));

/* -------------------------------------------------------------------------- */
/* Páginas servidas pelo app (o navegador só conhece este domínio)            */
/* -------------------------------------------------------------------------- */

/** Landing page pública: proposta de valor + CTA de cadastro. */
app.get("/", serveStatic({ path: "./src/public/landing.html" }));
app.get("/login", serveStatic({ path: "./src/public/login.html" }));
app.get("/cadastro", serveStatic({ path: "./src/public/login.html" }));
/** Painel autenticado (posts, contas sociais, aprovações, logs). */
app.get("/painel", serveStatic({ path: "./src/public/app.html" }));
/**
 * O link de redefinição de senha aponta para cá: o e-mail chega no navegador e
 * o navegador só conhece o endereço público do app.
 */
app.get("/reset-password", serveStatic({ path: "./src/public/reset.html" }));

app.get("/style.css", serveStatic({ path: "./src/public/style.css" }));
app.get("/app.js", serveStatic({ path: "./src/public/app.js" }));

const port = Number(process.env.PORT) || 8222;

console.log(
  `[app] MetaSass ouvindo na porta ${port} — autenticação em ` +
    `${process.env.AUTH_SERVICE_URL ?? "http://auth-service:3000"}`
);

// Garante o bucket de mídia na subida. Com retry e sem travar o boot: se o
// MinIO estiver fora, o app sobe e os uploads respondem 503 até ele voltar.
(async function prepararMinIO() {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      await garantirBucket();
      console.log(`[app] bucket "${MINIO_BUCKET}" pronto no object storage`);
      return;
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      console.error(`[app] object storage indisponível (tentativa ${tentativa}/5): ${motivo}`);
      await new Promise((resolver) => setTimeout(resolver, 3000));
    }
  }
})();

export default {
  port,
  fetch: app.fetch,
};
