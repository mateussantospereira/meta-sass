/**
 * O MAPA DE PERMISSÕES — a única fonte de verdade sobre "quem pode o quê".
 *
 * O auth-service é o dono da identidade e, por consequência, da política de
 * acesso. O app MetaSass (container `app`) NÃO tem este mapa: ele recebe a
 * lista pronta no `GET /me` e apenas consulta. Trocar o que um papel pode fazer
 * é uma mudança neste arquivo — não em cada rota.
 *
 * Papéis do negócio:
 *
 *   social_media -> planeja, cria, edita e publica o conteúdo dos próprios posts
 *   cliente      -> lê e aprova/recusa apenas os posts atribuídos a ele
 *   admin        -> administra o SaaS inteiro (contas, usuários, logs e posts)
 *
 * Um papel desconhecido no banco NUNCA vira admin: cai para o menor privilégio
 * (`cliente`), porque conceder por acidente é pior do que negar por engano.
 */

/** Papel de um usuário. */
export type Papel = "admin" | "social_media" | "cliente";

/**
 * Uma permissão é "uma ação sobre um recurso", escrita como `acao:recurso`.
 * Estes nomes são o contrato entre o auth-service e o app.
 */
export type Permissao =
  /** Ler posts que a regra de visibilidade permite. */
  | "ler:post"
  /** Criar um post. */
  | "criar:post"
  /** Editar um post do qual é dono (admin: qualquer post). */
  | "editar:post"
  /** Apagar um post do qual é dono (admin: qualquer post). */
  | "apagar:post"
  /** Marcar um post como publicado. */
  | "publicar:post"
  /** Aprovar ou pedir ajustes em um post atribuído ao cliente. */
  | "aprovar:post"
  /** Conectar/editar/remover contas sociais. */
  | "gerenciar:contas"
  /** Enviar e remover mídia de um post. */
  | "enviar:midia"
  /** Listar todos os usuários do sistema. Exclusivo de admin. */
  | "listar:usuarios"
  /** Promover/rebaixar o papel de outro usuário. Exclusivo de admin. */
  | "alterar:papel"
  /** Consultar o stream de auditoria. Exclusivo de admin. */
  | "consultar:logs";

/**
 * O que cada papel pode fazer.
 *
 * `admin` CONTÉM as permissões operacionais: promover alguém não faz a pessoa
 * deixar de conseguir trabalhar. O que é exclusivo do admin são as permissões
 * administrativas (`listar:usuarios`, `alterar:papel`, `consultar:logs`).
 */
const POR_PAPEL: Record<Papel, readonly Permissao[]> = {
  social_media: [
    "ler:post",
    "criar:post",
    "editar:post",
    "apagar:post",
    "publicar:post",
    "gerenciar:contas",
    "enviar:midia",
  ],
  cliente: ["ler:post", "aprovar:post"],
  admin: [
    "ler:post",
    "criar:post",
    "editar:post",
    "apagar:post",
    "publicar:post",
    "aprovar:post",
    "gerenciar:contas",
    "enviar:midia",
    "listar:usuarios",
    "alterar:papel",
    "consultar:logs",
  ],
} as const;

/** Papel de fallback: menor privilégio. Nunca concede por omissão. */
const PAPEL_PADRAO: Papel = "cliente";

/** Normaliza um papel vindo do banco (ou de um corpo HTTP). */
export function papelValido(role: unknown): Papel | null {
  const papel = String(role ?? "") as Papel;
  return papel in POR_PAPEL ? papel : null;
}

/**
 * Converte um papel guardado no banco na lista de permissões dele.
 *
 * FALHA PARA O MENOR PRIVILÉGIO: papel desconhecido ou corrompido vira
 * `cliente` (só leitura limitada e aprovação), nunca `admin`.
 */
export function permissoesDe(role: unknown): Permissao[] {
  const papel = papelValido(role) ?? PAPEL_PADRAO;
  return [...POR_PAPEL[papel]];
}

/** Pergunta rápida: esse papel tem essa permissão? */
export function temPermissao(role: unknown, permissao: Permissao): boolean {
  const papel = papelValido(role) ?? PAPEL_PADRAO;
  return POR_PAPEL[papel].includes(permissao);
}
