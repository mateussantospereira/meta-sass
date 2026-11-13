// Serviço de agendamento e publicação de posts
// Modo Mock: simula a integração com a Meta Graph API sem necessidade de aprovação real

// Agenda/verifica publicação de um post
export const agendarPublicacao = async (post: {
  id: number;
  image_url: string;
  caption: string;
  scheduled_for: Date;
  user_id: number;
}) => {
  const agora = new Date();

  // Se ainda não é hora, mantém agendado
  if (post.scheduled_for > agora) {
    return { status: "scheduled", message: "Ainda não é hora de publicar" };
  }

  // Mock: simula sucesso da Meta Graph API
  // Em produção real, aqui faria:
  // 1. POST https://graph.facebook.com/v20.0/{ig-id}/media
  //    { image_url, caption, access_token }
  // 2. POST https://graph.facebook.com/v20.0/{media-id}/publish
  //    {}

  return {
    status: "published",
    mock: true,
    mockMessage: `✅ Post #${post.id} publicado com sucesso no Instagram/Mock!`,
    postedAt: new Date().toISOString(),
    simulatedMetaResponse: {
      id: `ig_${post.id}`,
      status: "success",
      message: "Media created and published",
    },
  };
};

// Worker: verifica posts pendentes e publica os que passaram do horário
export const checkPublicacoesPendentes = async (posts: any[]) => {
  return posts
    .filter((p) => p.status === "scheduled" && new Date(p.scheduled_for) <= new Date())
    .map((p) => agendarPublicacao({
      id: p.id,
      image_url: p.image_url,
      caption: p.caption,
      scheduled_for: new Date(p.scheduled_for),
      user_id: p.user_id,
    }));
};

// Simula o resultado da chamada da Meta API para criar mídia
export const mockMetaCreateMedia = async (postData: {
  image_url: string;
  caption: string;
  instagram_account_id: string;
}) => {
  // Retorna um "ID de mídia" simulado
  return {
    media_id: `mock_media_${Date.now()}`,
    status: "success",
    message: "Mídia criada no Instagram (simulação)",
  };
};

// Simula a publicação da mídia
export const mockMetaPublishMedia = async (mediaId: string) => {
  return {
    success: true,
    message: `Postagem ${mediaId} publicada no Instagram (simulação)`,
  };
};