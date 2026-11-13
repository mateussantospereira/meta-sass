import { useState } from "react";
import { Container, h2, p, Button } from "./ui";

export default function LandingPage() {
  const [plan, setPlan] = useState<"free" | "pro">("free");

  return (
    <Container maxWidth="lg" className="mx-auto py-12">
      <h2 className="text-4xl font-bold mb-6">MetaSass</h2>

      <p className="text-lg text-muted-foreground mb-8">
        Gerencie e agende posts para Instagram e Facebook de forma simples e rápida.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Plano Gratuito */}
        <div className="bg-gray-50 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-2">Plano Grátis</h3>
          <p className="text-muted-foreground mb-4">
            Até 5 posts agendados. Publicação apenas no Instagram.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>5 posts agendados máximo</li>
            <li>Publicar apenas no Instagram</li>
            <li>Acesso ao calendário semanal</li>
            <li>Preview de posts</li>
          </ul>
          <Button
            onClick={() => setPlan("free")}
            className="mt-4 w-full bg-green-500 hover:bg-green-600 text-white"
          >
            Começar de Graça
          </Button>
        </div>

        {/* Plano Pro */}
        <div className="bg-indigo-50 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-2">Plano Pro</h3>
          <p className="text-muted-foreground mb-4">
            R$ 29,00/mês — Posts ilimitados + publicação simultânea Insta + Face
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            <li>Posts ilimitados</li>
            <li>Publicar no Instagram E Facebook simultaneamente</li>
            <li>Agendamento avançado</li>
            <li>Análise de melhores horários</li>
            <li>Suporte prioritário</li>
          </ul>
          <Button
            onClick={() => setPlan("pro")}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Assinar Pro – R$ 29/mês
          </Button>
        </div>
      </div>
    </Container>
  );
}