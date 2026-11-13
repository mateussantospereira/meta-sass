import { useState } from "react";
import { Container, h2, p, Button, Input, Select, Label, Option } from "./ui";

export default function PostModal() {
  const [abberto, setAbberto] = useState(false);
  const [userId, setUserId] = useState(1);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledFor, setScheduledFor] = useState<Date>(new Date(Date.now() + 24 * 60 * 60 * 1000)); // amanhã
  const [postToInstagram, setPostToInstagram] = useState(true);
  const [postToFacebook, setPostToFacebook] = useState(false);
  const [plan, setPlan] = useState<"free" | "pro">("free");

  // Verifica se pode postar no Facebook
  const podePostarFacebook = postToInstagram || plan === "pro";

  return (
    <Container maxWidth="lg" className="mx-auto py-8">
      <h2 className="text-3xl font-bold mb-6">Novo Post</h2>

      <Button onClick={() => setAbberto(true)} className="mb-4">
        Criar Post
      </Button>

      {/* Modal simples */}
      {abberto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-semibold mb-4">Novo Post Agendado</h3>

            <p className="text-sm text-muted-foreground mb-4">
              Plano atual: <strong>{plan === "free" ? "Gratuito" : "Pro (R$ 29/mês)"}</strong>
            </p>

            <Input
              placeholder="URL da imagem (ou deixe vazio para teste)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="mb-4"
            />
            <Input
              placeholder="Legenda"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="mb-4"
            />

            <p className="text-sm text-muted-foreground mb-4">
              Horário de publicação:{" "}
              <span className="font-medium">{new Date(scheduledFor).toLocaleString()}</span>
            </p>
            <input
              type="datetime-local"
              value={scheduledFor.toISOString().slice(0, 16)}
              onChange={(e) =>
                setScheduledFor(new Date(e.target.value as string))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            />

            <p className="text-sm text-muted-foreground mb-4">
              {plan === "free"
                ? "Facebook bloqueado no plano Grátis. <a href='#' className='underline text-indigo-600' onClick={(e) => { e.preventDefault(); setPlan('pro'); }}>Upgrade para Pro</a>"
                : "Pode publicar em ambos"}
            </p>

            <div className="mt-6">
              <Label className="block mb-2">
                <Input
                  type="checkbox"
                  checked={postToInstagram}
                  onChange={(e) => setPostToInstagram(e.target.checked)}
                  className="rounded border"
                />
                {postToInstagram ? "Remover Instagram" : "Publicar no Instagram"}
              </Label>

              {plan === "pro" && (
                <Label className="block mb-2">
                  <Input
                    type="checkbox"
                    checked={postToFacebook}
                    onChange={(e) => setPostToFacebook(e.target.checked)}
                    className="rounded border"
                  />
                  {postToFacebook ? "Remover Facebook" : "Publicar no Facebook"}
                </Label>
              )}
            </div>

            <Button
              onClick={() => setAbberto(false)}
              className="w-full mt-4"
            >
              Cancelar
            </Button>

            <Button
              onClick={() => setAbberto(false)}
              className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Agendar Post
            </Button>
          </div>
        </div>
      )}
    </Container>
  );
}