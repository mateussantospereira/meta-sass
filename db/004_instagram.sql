-- =============================================================================
-- MetaSass · 004 — conexão real com o Instagram (Meta Graph API)
-- =============================================================================
-- `contas_sociais` passa a guardar a identidade devolvida pelo OAuth da Meta.
-- O token da Página fica CIFRADO (AES-256-GCM) em `access_token_cifrado`;
-- nenhuma rota devolve essa coluna. `posts` guarda o id/link da publicação
-- real para comprovar o que foi ao ar.
--
-- Contas antigas continuam válidas: `conectado_via = 'manual'` e token NULL.
-- =============================================================================

ALTER TABLE `contas_sociais`
  ADD COLUMN IF NOT EXISTS `instagram_user_id` VARCHAR(64) NULL AFTER `identificador`,
  ADD COLUMN IF NOT EXISTS `facebook_page_id` VARCHAR(64) NULL AFTER `instagram_user_id`,
  ADD COLUMN IF NOT EXISTS `username` VARCHAR(120) NULL AFTER `facebook_page_id`,
  ADD COLUMN IF NOT EXISTS `access_token_cifrado` TEXT NULL AFTER `username`,
  ADD COLUMN IF NOT EXISTS `token_expira_em` DATETIME NULL AFTER `access_token_cifrado`,
  ADD COLUMN IF NOT EXISTS `conectado_via` VARCHAR(20) NOT NULL DEFAULT 'manual' AFTER `token_expira_em`,
  ADD COLUMN IF NOT EXISTS `ultima_sincronizacao` DATETIME NULL AFTER `conectado_via`;

ALTER TABLE `contas_sociais`
  ADD UNIQUE KEY `contas_sociais_instagram_user_unique` (`instagram_user_id`);

ALTER TABLE `posts`
  ADD COLUMN IF NOT EXISTS `instagram_media_id` VARCHAR(80) NULL AFTER `publicado_em`,
  ADD COLUMN IF NOT EXISTS `publicado_url` VARCHAR(255) NULL AFTER `instagram_media_id`;
