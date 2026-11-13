import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useState, useEffect } from "react";
import { Container, Button, h2, p } from "./components/ui";
import LandingPage from "./components/LandingPage";
import Dashboard from "./components/Dashboard";
import PostModal from "./components/PostModal";

function App() {
  const [userId, setUserId] = useState<number | null>(null);

  // Tenta obter ou criar usuário na inicialização
  useEffect(() => {
    const checkUser = async () => {
      // Em um app real, isso seria uma API call. Aqui simulamos.
      setUserId(1); // Usuário ID 1 (o único cadastrado no SQLite)
    };
    checkUser();
  }, []);

  return (
    <Router>
      <Container maxWidth="lg" className="mx-auto py-8">
        <h2 className="text-2xl font-bold mb-6">MetaSass</h2>
        <nav className="mb-6">
          <Button
            onClick={() => setUserId(1)}
            className="bg-indigo-6 hover:bg-indigo-7 text-white"
          >
            Entrar como Usuário 1
          </Button>
        </nav>

        <Routes>
          <Route
            path="/"
            element={
              <userId === null ? (
                <p>Por favor, entre para continuar.</p>
              ) : null}
            }
          />
          <Route path="/" element={<Dashboard />} />
          <Route path="/post" element={<PostModal />} />
        </Routes>
      </Container>
    </Router>
  );
}

export default App;