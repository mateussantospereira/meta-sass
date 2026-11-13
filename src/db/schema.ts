import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  boolean,
  unique,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Schema do DOMÍNIO MetaSass.
 *
 * Dono das tabelas de negócio:
 *   contas_sociais -> perfis de Instagram/Facebook conectados
 *   posts          -> conteúdo planejado/aprovado/publicado
 *   midias         -> referências dos arquivos guardados no MinIO
 *   aprovacoes     -> histórico de aprovação do cliente
 *   assinaturas    -> identificadores do Stripe (plano Pro)
 *
 * `usuarios` e `reset_tokens` pertencem ao auth-service. A declaração de
 * `usuarios` aqui serve só para as chaves estrangeiras; nenhuma rota deste
 * serviço lê senha ou decide papel. O papel e as permissões chegam pelo
 * `GET /me` do auth-service.
 */
export const usuarios = mysqlTable("usuarios", {
  id: int("id").primaryKey().autoincrement(),
  nome: varchar("nome", { length: 100 }).notNull(),
  email: varchar("email", { length: 150 }).notNull(),
  senhaHash: varchar("senha_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("social_media"),
  premium: boolean("premium").notNull().default(false),
  criadoEm: timestamp("criado_em").defaultNow(),
});

/** Conta de rede social conectada. Cada conta pertence a um usuário. */
export const contasSociais = mysqlTable(
  "contas_sociais",
  {
    id: int("id").primaryKey().autoincrement(),
    usuarioId: int("usuario_id")
      .references(() => usuarios.id)
      .notNull(),
    rede: varchar("rede", { length: 20 }).notNull(), // instagram | facebook
    nome: varchar("nome", { length: 120 }).notNull(),
    identificador: varchar("identificador", { length: 160 }),
    ativa: boolean("ativa").notNull().default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (t) => [
    unique("contas_sociais_usuario_rede_identificador_unique").on(
      t.usuarioId,
      t.rede,
      t.identificador
    ),
    index("contas_sociais_usuario_idx").on(t.usuarioId),
  ]
);

/**
 * Recurso principal do negócio: o POST planejado.
 *
 * `usuario_id` é o dono (quem criou). Toda consulta de quem não é admin filtra
 * por ele. `cliente_id` é opcional: quando preenchido, aquele cliente pode ler
 * e aprovar o post, mesmo não sendo o dono. É a única exceção de leitura — e
 * ela é explícita no banco, não escondida na tela.
 */
export const posts = mysqlTable(
  "posts",
  {
    id: int("id").primaryKey().autoincrement(),
    usuarioId: int("usuario_id")
      .references(() => usuarios.id)
      .notNull(),
    contaSocialId: int("conta_social_id")
      .references(() => contasSociais.id)
      .notNull(),
    clienteId: int("cliente_id").references(() => usuarios.id),
    titulo: varchar("titulo", { length: 180 }).notNull(),
    legenda: text("legenda"),
    dataAgendada: timestamp("data_agendada").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("rascunho"),
    publicadoEm: timestamp("publicado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow().onUpdateNow(),
  },
  (t) => [
    index("posts_usuario_idx").on(t.usuarioId),
    index("posts_status_idx").on(t.status),
    index("posts_data_idx").on(t.dataAgendada),
  ]
);

/** Arquivo do post no MinIO. O binário nunca entra no MariaDB. */
export const midias = mysqlTable(
  "midias",
  {
    id: int("id").primaryKey().autoincrement(),
    postId: int("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    chaveObjeto: varchar("chave_objeto", { length: 255 }).notNull(),
    nomeArquivo: varchar("nome_arquivo", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 80 }).notNull(),
    tamanho: int("tamanho").notNull(),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (t) => [index("midias_post_idx").on(t.postId)]
);

/** Histórico de aprovação/ajuste solicitado pelo cliente. */
export const aprovacoes = mysqlTable(
  "aprovacoes",
  {
    id: int("id").primaryKey().autoincrement(),
    postId: int("post_id")
      .references(() => posts.id, { onDelete: "cascade" })
      .notNull(),
    usuarioId: int("usuario_id")
      .references(() => usuarios.id)
      .notNull(),
    decisao: varchar("decisao", { length: 20 }).notNull(), // aprovado | ajustes
    comentario: text("comentario"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (t) => [index("aprovacoes_post_idx").on(t.postId)]
);

/**
 * Assinatura do plano Pro. O direito (`usuarios.premium`) mora no
 * auth-service; aqui ficam só os IDs devolvidos pelo Stripe.
 */
export const assinaturas = mysqlTable(
  "assinaturas",
  {
    usuarioId: int("usuario_id")
      .primaryKey()
      .references(() => usuarios.id),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("pendente"),
    plano: varchar("plano", { length: 40 }).notNull().default("pro"),
    atualizadoEm: timestamp("atualizado_em").defaultNow().onUpdateNow(),
  },
  (t) => [unique("assinaturas_stripe_subscription_unique").on(t.stripeSubscriptionId)]
);

export type Usuario = typeof usuarios.$inferSelect;
export type ContaSocial = typeof contasSociais.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Midia = typeof midias.$inferSelect;
export type Aprovacao = typeof aprovacoes.$inferSelect;
