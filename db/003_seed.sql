-- =============================================================================
-- MetaSass · 003 — dados de demonstração
-- =============================================================================
-- Idempotente: pode rodar quantas vezes for preciso. `ON DUPLICATE KEY` cuida
-- das contas de demonstração (inclusive restaurando a senha documentada) e os
-- INSERTs condicionais (`WHERE NOT EXISTS`) não duplicam posts/aprovações.
--
-- Contas:
--   admin@metasass.app    / Admin@123    (admin)
--   social@metasass.app   / Social@123   (social_media)
--   cliente@metasass.app  / Cliente@123  (cliente)
-- =============================================================================

INSERT INTO `usuarios` (`nome`, `email`, `senha_hash`, `role`, `premium`) VALUES
  ('Administrador MetaSass', 'admin@metasass.app',
   '$2a$10$.MP/ONzzZ7VU4l.AzqCwcORcJY/Jol/Zz/iRySrBG/WTt8d6iDkH6', 'admin', TRUE),
  ('Marina Social', 'social@metasass.app',
   '$2a$10$Fl7LQIePIW9.2zazBlx3xeC5n1Juzh3QcYeG2RTKALHZPrU7XoXgO', 'social_media', FALSE),
  ('Cliente Exemplo', 'cliente@metasass.app',
   '$2a$10$zEDUBLZnleoDHDw.vCxPcuLwZ7D8/5IUjk7k3k2I.xOCdYSiDLV/S', 'cliente', FALSE)
ON DUPLICATE KEY UPDATE
  `nome` = VALUES(`nome`),
  `senha_hash` = VALUES(`senha_hash`),
  `role` = VALUES(`role`),
  `premium` = VALUES(`premium`);

SET @admin_id = (SELECT `id` FROM `usuarios` WHERE `email` = 'admin@metasass.app' LIMIT 1);
SET @social_id = (SELECT `id` FROM `usuarios` WHERE `email` = 'social@metasass.app' LIMIT 1);
SET @cliente_id = (SELECT `id` FROM `usuarios` WHERE `email` = 'cliente@metasass.app' LIMIT 1);

-- Contas sociais da pessoa de social media (o recurso que os posts usam).
INSERT INTO `contas_sociais` (`usuario_id`, `rede`, `nome`, `identificador`, `ativa`) VALUES
  (@social_id, 'instagram', 'MetaSass Oficial', '@metasass', TRUE),
  (@social_id, 'facebook', 'MetaSass Página', 'metasass.page', TRUE)
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `ativa` = TRUE;

SET @insta_social = (SELECT `id` FROM `contas_sociais`
  WHERE `usuario_id` = @social_id AND `rede` = 'instagram' LIMIT 1);
SET @face_social = (SELECT `id` FROM `contas_sociais`
  WHERE `usuario_id` = @social_id AND `rede` = 'facebook' LIMIT 1);

-- Conta social do admin: existe para provar o isolamento por dono.
INSERT INTO `contas_sociais` (`usuario_id`, `rede`, `nome`, `identificador`, `ativa`) VALUES
  (@admin_id, 'instagram', 'MetaSass Bastidores', '@metasass.admin', TRUE)
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `ativa` = TRUE;

SET @insta_admin = (SELECT `id` FROM `contas_sociais`
  WHERE `usuario_id` = @admin_id AND `rede` = 'instagram' LIMIT 1);

-- Post 1: em aprovação com o cliente, já aprovado (fluxo de negócio completo).
INSERT INTO `posts`
  (`usuario_id`, `conta_social_id`, `cliente_id`, `titulo`, `legenda`, `data_agendada`, `status`)
SELECT @social_id, @insta_social, @cliente_id,
       'Lançamento do plano Pro',
       'Chegou o MetaSass Pro: posts ilimitados, aprovação com histórico e publicação sem fila.',
       DATE_ADD(NOW(), INTERVAL 2 DAY), 'aprovado'
WHERE NOT EXISTS (
  SELECT 1 FROM `posts` WHERE `usuario_id` = @social_id AND `titulo` = 'Lançamento do plano Pro'
);

-- Post 2: cliente pediu ajustes na legenda.
INSERT INTO `posts`
  (`usuario_id`, `conta_social_id`, `cliente_id`, `titulo`, `legenda`, `data_agendada`, `status`)
SELECT @social_id, @face_social, @cliente_id,
       'Bastidores: como planejamos o feed',
       'Um pouco do processo por trás do calendário editorial da semana.',
       DATE_ADD(NOW(), INTERVAL 4 DAY), 'ajustes'
WHERE NOT EXISTS (
  SELECT 1 FROM `posts` WHERE `usuario_id` = @social_id AND `titulo` = 'Bastidores: como planejamos o feed'
);

-- Post 3: já publicado (aparece no histórico e nos eventos de log).
INSERT INTO `posts`
  (`usuario_id`, `conta_social_id`, `cliente_id`, `titulo`, `legenda`, `data_agendada`, `status`, `publicado_em`)
SELECT @social_id, @insta_social, NULL,
       'Dica rápida: 3 ideias de Reels',
       'Salve para usar no próximo planejamento: tutorial, bastidor e prova social.',
       DATE_SUB(NOW(), INTERVAL 1 DAY), 'publicado', DATE_SUB(NOW(), INTERVAL 1 DAY)
WHERE NOT EXISTS (
  SELECT 1 FROM `posts` WHERE `usuario_id` = @social_id AND `titulo` = 'Dica rápida: 3 ideias de Reels'
);

-- Post 4: do ADMIN. A pessoa de social media NÃO pode abrir este registro,
-- mesmo sabendo o ID — é o caso usado no print de isolamento por usuário.
INSERT INTO `posts`
  (`usuario_id`, `conta_social_id`, `cliente_id`, `titulo`, `legenda`, `data_agendada`, `status`)
SELECT @admin_id, @insta_admin, NULL,
       'Campanha interna do administrador',
       'Conteúdo interno que não pertence à conta de social media.',
       DATE_ADD(NOW(), INTERVAL 7 DAY), 'agendado'
WHERE NOT EXISTS (
  SELECT 1 FROM `posts` WHERE `usuario_id` = @admin_id AND `titulo` = 'Campanha interna do administrador'
);

SET @post_aprovado = (SELECT `id` FROM `posts`
  WHERE `usuario_id` = @social_id AND `titulo` = 'Lançamento do plano Pro' LIMIT 1);
SET @post_ajustes = (SELECT `id` FROM `posts`
  WHERE `usuario_id` = @social_id AND `titulo` = 'Bastidores: como planejamos o feed' LIMIT 1);

-- Histórico de aprovação do post 1.
INSERT INTO `aprovacoes` (`post_id`, `usuario_id`, `decisao`, `comentario`)
SELECT @post_aprovado, @cliente_id, 'aprovado', 'Conteúdo aprovado, pode publicar.'
WHERE NOT EXISTS (
  SELECT 1 FROM `aprovacoes`
   WHERE `post_id` = @post_aprovado AND `decisao` = 'aprovado'
);

-- Histórico do post 2: o cliente pediu ajuste na legenda.
INSERT INTO `aprovacoes` (`post_id`, `usuario_id`, `decisao`, `comentario`)
SELECT @post_ajustes, @cliente_id, 'ajustes', 'Trocar a legenda para destacar o desconto.'
WHERE NOT EXISTS (
  SELECT 1 FROM `aprovacoes`
   WHERE `post_id` = @post_ajustes AND `decisao` = 'ajustes'
);

-- Assinatura Pro de demonstração para o admin (Stripe desligado no seed).
INSERT INTO `assinaturas` (`usuario_id`, `status`, `plano`)
VALUES (@admin_id, 'ativa', 'pro')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `plano` = VALUES(`plano`);
