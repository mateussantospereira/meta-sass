import { sqliteTable, text, integer, datetime } from "drizzle-orm/sqlite-core";

// Tabela de usuários (plan free/pro, tokens da Meta)
export const users = sqliteTable("users", {
  id: integer("id").primaryKey().autoincrement(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  plan: text("plan").notNull().default("free"), // 'free' | 'pro'
  meta_access_token: text("meta_access_token"), // token OAuth da Meta (nullable)
  ig_account_id: text("ig_account_id"), // ID da conta Instagram (nullable)
  fb_page_id: text("fb_page_id"), // ID da página Facebook (nullable)
  created_at: datetime("created_at").defaultNow(),
});

// Tabela de posts agendados
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey().autoincrement(),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id),
  image_url: text("image_url").notNull(),
  caption: text("caption"),
  scheduled_for: datetime("scheduled_for").notNull(),
  post_to_instagram: boolean("post_to_instagram").notNull().default(true),
  post_to_facebook: boolean("post_to_facebook").notNull().default(false),
  status: text("status").notNull().default("scheduled"), // 'scheduled' | 'published' | 'failed'
  created_at: datetime("created_at").defaultNow(),
});

// Tipos derivados para uso no código
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type InsertPost = typeof posts.$inferInsert;