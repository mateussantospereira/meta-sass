import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import BetterSqlite3 from "better-sqlite3";
import { users, posts } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

const app = new Hono();

// Conexão SQLite (local, para desenvolvimento)
const sqlite = new BetterSqlite3("./dev.db", { readonly: false });
const db = drizzle(sqlite);

// **GET /api/users** — Retorna usuário (simples)
app.get("/api/users", (c) => {
  const all = db.select().from(users);
  return c.json(all);
});

// **POST /api/users** — Cadastro simplificado
app.post("/api/users", (c) => {
  const body = await c.req.json();
  const [user] = db
    .insert(users)
    .values({
      name: body.name,
      email: body.email,
      password_hash: body.password_hash,
      plan: "free",
    })
    .returning();
  return c.json(user);
});

// **GET /api/posts** — Lista posts do usuário
app.get("/api/posts", (c) => {
  const userId = c.req.query("userId") as string | null;
  const q = userId
    ? db.select().from(posts).where(eq(posts.user_id, Number(userId)))
    : db.select().from(posts);
  const all = q.orderBy(desc(posts.scheduled_for));
  return c.json(all);
});

// **POST /api/posts** — Cria novo post agendado
app.post("/api/posts", (c) => {
  const body = await c.req.json();
  const [post] = db
    .insert(posts)
    .values({
      user_id: body.userId,
      image_url: body.imageUrl,
      caption: body.caption,
      scheduled_for: body.scheduledFor,
      post_to_instagram: body.postToInstagram ?? true,
      post_to_facebook: body.postToFacebook ?? false,
      status: "scheduled",
    })
    .returning();
  return c.json(post);
});

// **POST /api/posts/:id/publicar** — Força publicação imediata (Mock)
app.post("/api/posts/:id/publicar", (c) => {
  const id = parseInt(c.req.param("id"));
  const [post] = db
    .update(posts)
    .set({ status: "published" })
    .where(eq(posts.id, id))
    .returning();
  return c.json(post);
});

// **POST /api/meta/callback** — OAuth callback da Meta (Mock ativo)
app.post("/api/meta/callback", (c) => {
  const body = await c.req.json();
  // Modo Mock: grava token simulado e associa à conta (user id=1)
  const [user] = db
    .update(users)
    .set({
      meta_access_token: `mock_token_${Date.now()}`,
      ig_account_id: body.instagram_id ?? null,
      fb_page_id: fb_page_id ?? null,
    })
    .where(eq(users.id, 1))
    .returning();
  return c.json({ success: true, user });
});

export default app;