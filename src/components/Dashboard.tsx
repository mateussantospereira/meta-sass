import { useState, useEffect } from "react";
import { Container, h2, Button } from "./ui";
import PostModal from "./PostModal";

export default function Dashboard() {
  const [posts, setPosts] = useState([]);
  const [userId, setUserId] = useState(1);

  // Carrega posts do backend
  useEffect(() => {
    fetch("/api/posts?userId=1")
      .then((r) => r.json())
      .then(setPosts)
      .catch(console.error);
  }, [userId]);

  const handleNovoPost = () => {
    // Abre modal para criar novo post
    const modal = document.getElementById("post-modal") as HTMLElement;
    if (modal) modal.style.display = "block";
  };

  return (
    <Container maxWidth="lg" className="mx-auto py-8">
      <h2 className="text-3xl font-bold mb-6">Dashboard</h2>

      <div className="flex gap-4 mb-6">
        <Button onClick={handleNovoPost} className="flex-1">
          Novo Post
        </Button>
        <Button
          onClick={() => fetch("/api/meta/callback", { method: "POST" })}
          className="bg-purple-500 hover:bg-purple-600 text-white"
        >
          Conectar Meta
        </Button>
      </div>

      <div className="space-y-4">
        {posts.map((p) => (
          <div
            key={p.id}
            className="p-4 rounded-md border overflow-hidden bg-white shadow-sm"
          >
            <img
              src={p.image_url || "/placeholder.jpg"}
              alt={p.caption || "Post"}
              className="w-full h-40 object-cover"
            />
            <div className="p-3">
              <p className="font-medium truncate">{p.caption || "Sem legenda"}</p>
              <p className="text-sm text-muted-foreground">
                Agendado para: {new Date(p.scheduled_for).toLocaleDateString()}
              </p>
              <div className="mt-2 flex gap-2">
                <span
                  className={`px-2 py-1 text-xs rounded ${p.post_to_instagram ? "bg-indigo-100 text-indigo-800" : "bg-gray-200 text-gray-500"}`}
                >
                  Insta{' '}
                </span>
                <span
                  className={`px-2 py-1 text-xs rounded ${p.post_to_facebook ? "bg-purple-100 text-purple-800" : "bg-gray-200 text-gray-500"}`}
                >
                  Face
                </span>
              </div>
              <div className="mt-2">
                <span
                  className={`px-3 py-1 text-xs rounded ${p.status === "scheduled" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}
                >
                  {p.status}
                </span>
              </div>
              <Button
                className="mt-2 w-full text-sm"
                onClick={() => fetch(`/api/posts/${p.id}/publicar`, { method: "POST" })}
              >
                Publicar Agora
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
}