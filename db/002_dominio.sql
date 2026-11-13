-- =============================================================================
-- MetaSass · 002 — domínio do negócio
-- =============================================================================
-- Tabelas do recurso principal e seus relacionamentos:
--
--   usuarios 1---N contas_sociais
--   usuarios 1---N posts
--   contas_sociais 1---N posts
--   posts 1---N midias
--   posts 1---N aprovacoes
--
-- `posts.usuario_id` é o dono do registro. É por ele que TODA consulta de
-- quem não é admin filtra. `posts.cliente_id` é uma exceção explícita de
-- leitura: o cliente atribuído pode ler/aprovar, mas não editar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `contas_sociais` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `rede` VARCHAR(20) NOT NULL,
  `nome` VARCHAR(120) NOT NULL,
  `identificador` VARCHAR(160),
  `ativa` BOOLEAN NOT NULL DEFAULT TRUE,
  `criado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `contas_sociais_usuario_rede_identificador_unique` (`usuario_id`, `rede`, `identificador`),
  KEY `contas_sociais_usuario_idx` (`usuario_id`),
  CONSTRAINT `contas_sociais_usuario_fk`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `posts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `conta_social_id` INT NOT NULL,
  `cliente_id` INT,
  `titulo` VARCHAR(180) NOT NULL,
  `legenda` TEXT,
  `data_agendada` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'rascunho',
  `publicado_em` DATETIME,
  `criado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `posts_usuario_idx` (`usuario_id`),
  KEY `posts_status_idx` (`status`),
  KEY `posts_data_idx` (`data_agendada`),
  CONSTRAINT `posts_usuario_fk`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `posts_conta_social_fk`
    FOREIGN KEY (`conta_social_id`) REFERENCES `contas_sociais` (`id`),
  CONSTRAINT `posts_cliente_fk`
    FOREIGN KEY (`cliente_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `midias` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `chave_objeto` VARCHAR(255) NOT NULL,
  `nome_arquivo` VARCHAR(255) NOT NULL,
  `content_type` VARCHAR(80) NOT NULL,
  `tamanho` INT NOT NULL,
  `criado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `midias_post_idx` (`post_id`),
  CONSTRAINT `midias_post_fk`
    FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `aprovacoes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `usuario_id` INT NOT NULL,
  `decisao` VARCHAR(20) NOT NULL,
  `comentario` TEXT,
  `criado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `aprovacoes_post_idx` (`post_id`),
  CONSTRAINT `aprovacoes_post_fk`
    FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `aprovacoes_usuario_fk`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assinaturas` (
  `usuario_id` INT PRIMARY KEY,
  `stripe_customer_id` VARCHAR(64),
  `stripe_subscription_id` VARCHAR(64),
  `status` VARCHAR(20) NOT NULL DEFAULT 'pendente',
  `plano` VARCHAR(40) NOT NULL DEFAULT 'pro',
  `atualizado_em` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `assinaturas_stripe_subscription_unique` (`stripe_subscription_id`),
  CONSTRAINT `assinaturas_usuario_fk`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
