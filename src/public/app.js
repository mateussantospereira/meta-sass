/* ==========================================================================
   MetaSass — painel (vanilla JS, servido pelo próprio app Bun/Hono).
   Nenhuma regra de autorização vive aqui: a tela apenas reflete as permissões
   que o auth-service devolveu no GET /api/me. Toda ação é conferida de novo
   no servidor — esconder botão não é segurança.
   ========================================================================== */

const token = localStorage.getItem("token");
if (!token) window.location.href = "/login";

let eu = { usuarioId: null, nome: "", email: "", role: "", premium: false, permissoes: [] };
let postsCache = [];
let contasCache = [];
let usuariosCache = [];
let instagramConfig = null;
let facebookConfig = null;
let postEditandoId = null;
let currentTab = "posts";

const $ = (id) => document.getElementById(id);
const temPermissao = (p) => (eu.permissoes ?? []).includes(p);

/* --------------------------------------------------------------- helpers -- */
function criar(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== undefined && texto !== null) node.textContent = String(texto);
  return node;
}

function fmtData(valor, comHora = true) {
  if (!valor) return "—";
  const d = new Date(typeof valor === "string" ? valor.replace(" ", "T") : valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return comHora
    ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR");
}

function paraInputData(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function badgeStatus(status) {
  return criar("span", "badge-status " + (status || "rascunho"), status || "rascunho");
}

function toast(mensagem, tipo = "ok") {
  const area = $("toasts");
  const item = criar("div", "toast " + tipo, mensagem);
  area.appendChild(item);
  setTimeout(() => item.remove(), 5200);
}

function limparFilhos(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function abrirModal(id) {
  const modal = $(id);
  if (modal) modal.hidden = false;
}
function fecharModal(id) {
  const modal = $(id);
  if (modal) modal.hidden = true;
}

async function api(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers ?? {}) };
  const ehFormData = opcoes.body instanceof FormData;
  if (opcoes.body !== undefined && !ehFormData) headers["Content-Type"] = "application/json";
  headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(caminho, { ...opcoes, headers });
  } catch {
    toast("Erro de conexão com o servidor.", "error");
    return { ok: false, status: 0, data: null };
  }

  if (res.status === 401) {
    localStorage.clear();
    window.location.href = "/login";
    return { ok: false, status: 401, data: null };
  }

  const data = await res.json().catch(() => null);
  if (res.status === 503) {
    toast(data?.error || "Serviço indisponível no momento.", "error");
    return { ok: false, status: 503, data };
  }
  return { ok: res.ok, status: res.status, data };
}

/* --------------------------------------------------------------- sessão --- */
async function carregarSessao() {
  const { ok, data } = await api("/api/me");
  if (!ok || !data) return;
  eu = data;

  $("user-name").textContent = eu.nome || "Usuário";
  $("user-email").textContent = eu.email || "";
  const badge = $("user-role");
  badge.textContent = eu.role;
  badge.className = "role-badge " + (eu.role || "");

  const plano = $("plano-badge");
  plano.hidden = false;
  plano.textContent = eu.premium ? "Pro" : "Gratuito";
  plano.className = "role-badge" + (eu.premium ? " pro" : "");

  // A navegação esconde o que o papel não pode — mas quem decide é o servidor.
  $("nav-contas").hidden = !temPermissao("gerenciar:contas");
  $("nav-usuarios").hidden = !temPermissao("listar:usuarios");
  $("nav-logs").hidden = !temPermissao("consultar:logs");
  $("btn-novo-post").hidden = !temPermissao("criar:post");
  $("painel-form-conta").hidden = !temPermissao("gerenciar:contas");

  const titulos = {
    admin: ["Administração", "Você enxerga todos os posts, usuários e a auditoria do MetaSass."],
    social_media: ["Sua operação", "Crie, edite e publique os posts da sua marca."],
    cliente: ["Área do cliente", "Você vê e aprova apenas os posts atribuídos a você."],
  };
  const [titulo, texto] = titulos[eu.role] ?? ["Painel", "Bem-vindo ao MetaSass."];
  $("side-title").textContent = titulo;
  $("side-text").textContent = texto;

  if (eu.role === "cliente") {
    $("posts-title").textContent = "Posts para aprovação";
    $("posts-sub").textContent = "Estes são os conteúdos atribuídos a você. Aprove ou peça ajustes.";
  }
}

/* ---------------------------------------------------------------- abas ---- */
function abrirTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["posts", "contas", "usuarios", "logs", "plano"].forEach((t) => {
    const secao = $("tab-" + t);
    if (secao) secao.hidden = t !== tab;
  });

  if (tab === "posts") carregarPosts();
  if (tab === "contas") carregarContas();
  if (tab === "usuarios") carregarUsuarios();
  if (tab === "logs") carregarLogs();
  if (tab === "plano") carregarPlano();
}

/* ---------------------------------------------------------------- posts --- */
async function carregarPosts() {
  $("posts-loading").hidden = false;
  $("posts-grid").hidden = true;
  $("posts-empty").hidden = true;

  const { ok, data } = await api("/api/posts");
  $("posts-loading").hidden = true;
  if (!ok) return;

  postsCache = data?.posts ?? [];
  atualizarStats();
  renderPosts();
}

function atualizarStats() {
  $("stat-total").textContent = postsCache.length;
  $("stat-agendados").textContent = postsCache.filter((p) => p.status === "agendado").length;
  $("stat-aguardando").textContent = postsCache.filter((p) => p.status === "rascunho" || p.status === "ajustes").length;
  $("stat-publicados").textContent = postsCache.filter((p) => p.status === "publicado").length;
}

function renderPosts() {
  const grid = $("posts-grid");
  limparFilhos(grid);

  if (postsCache.length === 0) {
    $("posts-empty").hidden = false;
    grid.hidden = true;
    return;
  }
  $("posts-empty").hidden = true;
  grid.hidden = false;

  postsCache.forEach((post) => {
    const card = criar("article", "post-card");
    card.onclick = () => abrirDetalhe(post.id);

    const top = criar("div", "top");
    top.appendChild(criar("span", "rede", (post.contaRede || "rede") + " · " + (post.contaNome || "")));
    top.appendChild(badgeStatus(post.status));
    card.appendChild(top);

    card.appendChild(criar("h3", null, post.titulo));

    const legenda = criar("p", "legenda", post.legenda || "Sem legenda.");
    card.appendChild(legenda);

    const meta = criar("div", "meta");
    meta.appendChild(criar("span", null, fmtData(post.dataAgendada)));
    if (post.publicadoEm) meta.appendChild(criar("span", null, "publicado " + fmtData(post.publicadoEm, false)));
    card.appendChild(meta);

    grid.appendChild(card);
  });
}

async function carregarContasParaSelect(selecionado) {
  const { ok, data } = await api("/api/contas-sociais");
  const select = $("post-conta");
  limparFilhos(select);
  if (!ok) {
    select.appendChild(new Option("Nenhuma conta disponível", ""));
    return;
  }
  contasCache = data?.contas ?? [];
  if (contasCache.length === 0) {
    select.appendChild(new Option("Conecte uma conta social primeiro", ""));
    return;
  }
  contasCache.forEach((conta) => {
    const opt = new Option(`${conta.rede === "instagram" ? "Instagram" : "Facebook"} · ${conta.nome}`, String(conta.id));
    if (selecionado && Number(selecionado) === conta.id) opt.selected = true;
    select.appendChild(opt);
  });
}

async function abrirNovoPost() {
  postEditandoId = null;
  $("modal-post-titulo").textContent = "Novo post";
  $("btn-salvar-post").textContent = "Criar post";
  $("form-post").reset();
  $("post-form-msg").textContent = "";
  $("post-status").value = "agendado";
  $("post-data").value = paraInputData(new Date(Date.now() + 24 * 3600 * 1000));
  $("campo-cliente").hidden = !temPermissao("listar:usuarios");

  await carregarContasParaSelect();
  if (contasCache.length === 0) {
    toast("Conecte uma conta social antes de criar um post.", "warn");
    fecharModal("modal-post");
    abrirTab("contas");
    return;
  }
  if (temPermissao("listar:usuarios")) await carregarClientesParaSelect();
  abrirModal("modal-post");
}

async function carregarClientesParaSelect(selecionado) {
  const { ok, data } = await api("/api/usuarios");
  const select = $("post-cliente");
  limparFilhos(select);
  select.appendChild(new Option("— sem cliente —", ""));
  if (!ok) return;
  usuariosCache = data?.usuarios ?? [];
  usuariosCache
    .filter((u) => u.role === "cliente")
    .forEach((u) => {
      const opt = new Option(`${u.nome} (${u.email})`, String(u.id));
      if (selecionado && Number(selecionado) === u.id) opt.selected = true;
      select.appendChild(opt);
    });
}

function montarPayloadPost() {
  const payload = {
    titulo: $("post-titulo").value.trim(),
    legenda: $("post-legenda").value.trim() || null,
    conta_social_id: Number($("post-conta").value),
    data_agendada: $("post-data").value,
    status: $("post-status").value,
  };
  if (temPermissao("listar:usuarios") && !$("campo-cliente").hidden) {
    const cliente = $("post-cliente").value;
    payload.cliente_id = cliente ? Number(cliente) : null;
  }
  return payload;
}

async function salvarPost(evento) {
  evento.preventDefault();
  const msg = $("post-form-msg");
  msg.textContent = "";
  msg.className = "form-msg error";

  const payload = montarPayloadPost();
  if (!payload.titulo) { msg.textContent = "O título é obrigatório."; return; }
  if (!payload.conta_social_id) { msg.textContent = "Escolha uma conta social."; return; }
  if (!payload.data_agendada) { msg.textContent = "Informe a data e a hora."; return; }

  const botao = $("btn-salvar-post");
  botao.disabled = true;
  const editando = postEditandoId !== null;
  const { ok, status, data } = await api(editando ? `/api/posts/${postEditandoId}` : "/api/posts", {
    method: editando ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
  botao.disabled = false;

  if (!ok) {
    const texto = data?.error || `Não foi possível salvar (HTTP ${status}).`;
    msg.textContent = texto;
    if (status === 403) toast(texto, "warn");
    return;
  }

  fecharModal("modal-post");
  toast(editando ? "Post atualizado." : "Post criado.", "ok");
  postEditandoId = null;
  await carregarPosts();
}

function editarPost(post) {
  postEditandoId = post.id;
  fecharModal("modal-detalhe");
  $("modal-post-titulo").textContent = "Editar post #" + post.id;
  $("btn-salvar-post").textContent = "Salvar alterações";
  $("post-form-msg").textContent = "";
  $("post-titulo").value = post.titulo || "";
  $("post-legenda").value = post.legenda || "";
  $("post-data").value = paraInputData(post.dataAgendada);
  $("post-status").value = post.status || "agendado";
  $("campo-cliente").hidden = !temPermissao("listar:usuarios");

  (async () => {
    await carregarContasParaSelect(post.contaSocialId);
    if (temPermissao("listar:usuarios")) await carregarClientesParaSelect(post.clienteId);
    abrirModal("modal-post");
  })();
}

/* ---------------------------------------------------------- detalhe post -- */
async function abrirDetalhe(id) {
  $("detalhe-corpo").innerHTML = "";
  $("detalhe-acoes").innerHTML = "";
  $("detalhe-titulo").textContent = "Carregando post…";
  abrirModal("modal-detalhe");

  const { ok, status, data } = await api(`/api/posts/${id}`);
  if (!ok) {
    renderAcessoNegado(status, data);
    return;
  }
  renderDetalhePost(data);
}

/**
 * Tela de acesso negado/erro. É a prova visual do isolamento por usuário: a
 * URL/API foi chamada direto e o servidor respondeu 403.
 */
function renderAcessoNegado(status, data) {
  $("detalhe-titulo").textContent = status === 403 ? "Acesso negado (403)" : "Não foi possível abrir o post";
  const corpo = $("detalhe-corpo");
  limparFilhos(corpo);

  const box = criar("div", "denied");
  box.appendChild(criar("h2", null, status === 403 ? "Este post pertence a outra pessoa" : "Post indisponível"));
  box.appendChild(
    criar(
      "p",
      null,
      status === 403
        ? "O servidor conferiu o dono do registro e recusou a leitura. O botão escondido não é a proteção — a API é."
        : "O recurso não existe ou foi removido."
    )
  );
  const detalhe = criar("p");
  detalhe.appendChild(criar("span", null, "HTTP "));
  detalhe.appendChild(criar("code", null, String(status)));
  if (data?.error) detalhe.appendChild(document.createTextNode(" · " + data.error));
  box.appendChild(detalhe);
  if (data?.sua_conta !== undefined) box.appendChild(criar("p", null, "Sua conta: " + data.sua_conta + " · papel: " + (data.papel || eu.role)));
  corpo.appendChild(box);

  const acoes = $("detalhe-acoes");
  const fechar = criar("button", "btn ghost", "Fechar");
  fechar.onclick = () => fecharModal("modal-detalhe");
  acoes.appendChild(fechar);
}

function renderDetalhePost(data) {
  const post = data.post;
  const perms = data.permissoes ?? {};
  $("detalhe-titulo").textContent = post.titulo;

  const corpo = $("detalhe-corpo");
  limparFilhos(corpo);

  const grid = criar("div", "detail-grid");

  // Coluna esquerda: dados + mídias.
  const esquerda = criar("div");
  const dados = criar("div", "detail-list");
  const linhas = [
    ["Status", post.status],
    ["Conta", `${post.conta?.rede || "—"} · ${post.conta?.nome || "—"}`],
    ["Agendado para", fmtData(post.dataAgendada)],
    ["Publicado em", post.publicadoEm ? fmtData(post.publicadoEm) : "—"],
    ["Criado em", post.criadoEm ? fmtData(post.criadoEm) : "—"],
  ];
  linhas.forEach(([rotulo, valor]) => {
    const row = criar("div", "row");
    row.appendChild(criar("span", null, rotulo));
    const alvo = criar("span");
    if (rotulo === "Status") alvo.appendChild(badgeStatus(post.status));
    else alvo.textContent = valor;
    row.appendChild(alvo);
    dados.appendChild(row);
  });
  if (post.publicadoUrl) {
    const row = criar("div", "row");
    row.appendChild(criar("span", null, "Publicação"));
    const alvo = criar("span");
    const link = criar("a", null, "Abrir no Instagram");
    link.href = post.publicadoUrl;
    link.target = "_blank";
    link.rel = "noopener";
    alvo.appendChild(link);
    row.appendChild(alvo);
    dados.appendChild(row);
  }
  esquerda.appendChild(dados);

  esquerda.appendChild(criar("div", "subhead", "Mídias do post"));
  const galeria = criar("div", "media-gallery");
  if (!post.midias || post.midias.length === 0) {
    galeria.appendChild(criar("p", "empty", "Nenhuma mídia enviada. Use o botão abaixo para anexar uma imagem."));
  } else {
    post.midias.forEach((midia) => {
      const item = criar("div", "media-item");
      const img = criar("img");
      img.alt = midia.nomeArquivo || "Mídia do post";
      item.appendChild(img);
      carregarImagemComToken(midia.url, img);

      if (perms.enviarMidia) {
        const remover = criar("button", null, "×");
        remover.title = "Remover mídia";
        remover.onclick = () => removerMidia(post.id, midia.id);
        item.appendChild(remover);
      }
      galeria.appendChild(item);
    });
  }
  esquerda.appendChild(galeria);

  if (perms.enviarMidia) {
    const upload = criar("div", "upload-row");
    const label = criar("label", "upload-label");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.onchange = () => enviarMidia(input, post.id);
    label.appendChild(input);
    label.appendChild(criar("span", null, "Anexar imagem"));
    upload.appendChild(label);
    upload.appendChild(criar("span", "mono", "PNG, JPEG, GIF ou WebP · até 5 MB"));
    esquerda.appendChild(upload);
  }

  // Coluna direita: legenda + histórico.
  const direita = criar("div");
  direita.appendChild(criar("div", "subhead", "Legenda"));
  const legenda = criar("p", null, post.legenda || "Sem legenda.");
  legenda.style.whiteSpace = "pre-wrap";
  legenda.style.color = "var(--muted)";
  direita.appendChild(legenda);

  direita.appendChild(criar("div", "subhead", "Histórico de aprovação"));
  const timeline = criar("div", "timeline");
  if (!post.aprovacoes || post.aprovacoes.length === 0) {
    timeline.appendChild(criar("div", "timeline-item", "Nenhuma decisão de aprovação registrada ainda."));
  } else {
    post.aprovacoes.forEach((a) => {
      const item = criar("div", "timeline-item " + a.decisao);
      item.appendChild(criar("strong", null, a.decisao === "aprovado" ? "Aprovado" : "Ajustes solicitados"));
      item.appendChild(document.createTextNode(" · " + fmtData(a.criadoEm)));
      if (a.comentario) item.appendChild(criar("div", null, a.comentario));
      timeline.appendChild(item);
    });
  }
  direita.appendChild(timeline);

  grid.appendChild(esquerda);
  grid.appendChild(direita);
  corpo.appendChild(grid);

  // Ações conforme as permissões devolvidas pelo servidor + papel do chamador.
  const acoes = $("detalhe-acoes");
  limparFilhos(acoes);

  const fechar = criar("button", "btn ghost", "Fechar");
  fechar.onclick = () => fecharModal("modal-detalhe");
  acoes.appendChild(fechar);

  if (perms.editar) {
    const editar = criar("button", "btn soft", "Editar");
    editar.onclick = () => editarPost(post);
    acoes.appendChild(editar);
  }

  if (perms.aprovar && post.status !== "aprovado") {
    const ajustes = criar("button", "btn danger", "Pedir ajustes");
    ajustes.onclick = () => aprovarPost(post.id, "ajustes");
    acoes.appendChild(ajustes);

    const aprovar = criar("button", "btn success", "Aprovar");
    aprovar.onclick = () => aprovarPost(post.id, "aprovado");
    acoes.appendChild(aprovar);
  }

  if (perms.publicar && post.status !== "publicado" && temPermissao("publicar:post")) {
    const publicar = criar("button", "btn", "Publicar");
    publicar.onclick = () => publicarPost(post.id);
    acoes.appendChild(publicar);
  }

  if (perms.apagar) {
    const excluir = criar("button", "btn danger", "Excluir");
    excluir.onclick = () => excluirPost(post.id);
    acoes.appendChild(excluir);
  }
}

async function carregarImagemComToken(url, img) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("imagem " + res.status);
    const blob = await res.blob();
    img.src = URL.createObjectURL(blob);
  } catch {
    img.alt = "Mídia indisponível";
    img.style.background = "var(--bg-soft)";
  }
}

async function publicarPost(id) {
  const { ok, status, data } = await api(`/api/posts/${id}/publicar`, { method: "POST" });
  if (!ok) { toast(data?.error || `Falha ao publicar (HTTP ${status}).`, "error"); return; }
  if (data?.modo === "simulado") toast("Publicação simulada: a conta é manual e não tem token da Meta.", "warn");
  else toast(data?.message || (data?.publicadoUrl ? "Publicado com sucesso." : "Publicado."), "ok");
  await abrirDetalhe(id);
  await carregarPosts();
}

async function aprovarPost(id, decisao) {
  let comentario = "";
  if (decisao === "ajustes") {
    const resposta = window.prompt("Descreva o ajuste solicitado (opcional):", "");
    if (resposta === null) return;
    comentario = resposta;
  }
  const { ok, status, data } = await api(`/api/posts/${id}/aprovar`, {
    method: "POST",
    body: JSON.stringify({ decisao, comentario }),
  });
  if (!ok) { toast(data?.error || `Falha ao registrar a decisão (HTTP ${status}).`, "error"); return; }
  toast(decisao === "aprovado" ? "Post aprovado." : "Ajustes solicitados.", "ok");
  await abrirDetalhe(id);
  await carregarPosts();
}

async function excluirPost(id) {
  if (!window.confirm("Excluir este post e todas as mídias dele? Esta ação não pode ser desfeita.")) return;
  const { ok, status, data } = await api(`/api/posts/${id}`, { method: "DELETE" });
  if (!ok) { toast(data?.error || `Falha ao excluir (HTTP ${status}).`, "error"); return; }
  fecharModal("modal-detalhe");
  toast("Post excluído.", "ok");
  await carregarPosts();
}

async function enviarMidia(input, postId) {
  const arquivo = input.files?.[0];
  if (!arquivo) return;
  if (!arquivo.type.startsWith("image/")) { toast("Envie apenas imagens.", "warn"); return; }
  if (arquivo.size > 5 * 1024 * 1024) { toast("A imagem deve ter no máximo 5 MB.", "warn"); return; }

  const form = new FormData();
  form.append("arquivo", arquivo);
  const { ok, status, data } = await api(`/api/posts/${postId}/midia`, { method: "POST", body: form });
  if (!ok) { toast(data?.error || `Falha no upload (HTTP ${status}).`, "error"); return; }
  toast("Mídia enviada.", "ok");
  await abrirDetalhe(postId);
}

async function removerMidia(postId, midiaId) {
  if (!window.confirm("Remover esta mídia do post?")) return;
  const { ok, status, data } = await api(`/api/posts/${postId}/midia/${midiaId}`, { method: "DELETE" });
  if (!ok) { toast(data?.error || `Falha ao remover (HTTP ${status}).`, "error"); return; }
  toast("Mídia removida.", "ok");
  await abrirDetalhe(postId);
}

/* --------------------------------------------------------------- contas --- */
async function carregarIntegracaoInstagram() {
  const estado = $("ig-estado");
  const botao = $("btn-ig-conectar");
  const aviso = $("ig-config-aviso");
  const callout = $("ig-callout");
  if (!estado) return;
  limparFilhos(callout);

  const { ok, data } = await api("/api/instagram/status");
  instagramConfig = ok ? data : null;

  if (!ok || !data) {
    estado.textContent = "indisponível";
    $("ig-status-valor").textContent = "falha na consulta";
    aviso.textContent = "Não foi possível consultar a integração.";
    botao.disabled = true;
    return;
  }

  $("ig-contas-total").textContent = data.contasConectadas ?? 0;
  $("ig-versao").textContent = data.versaoApi || "—";
  $("ig-redirect").textContent = data.redirectUri || "—";
  $("ig-redirect").title = data.redirectUri || "";

  if (data.configurado) {
    estado.textContent = "configurada";
    $("ig-status-valor").textContent = "pronta para conectar";
    aviso.textContent = data.appId ? `App ID ${data.appId}` : "Credenciais presentes";
    botao.disabled = false;
    callout.appendChild(criar("div", "callout ok", "Integração ativa. Requer permissões de conteúdo do Instagram no app da Meta."));
  } else {
    estado.textContent = "não configurada";
    $("ig-status-valor").textContent = "faltam credenciais";
    aviso.textContent = "Defina META_APP_ID e META_APP_SECRET no ambiente.";
    botao.disabled = true;
  }
}

async function conectarInstagram() {
  const { ok, status, data } = await api("/api/instagram/conectar");
  if (!ok || !data?.url) {
    toast(data?.error || `Falha ao iniciar o OAuth (HTTP ${status}).`, "error");
    return;
  }
  window.location.href = data.url;
}

async function carregarIntegracaoFacebook() {
  const estado = $("fb-estado");
  const botao = $("btn-fb-conectar");
  const aviso = $("fb-config-aviso");
  const callout = $("fb-callout");
  if (!estado) return;
  limparFilhos(callout);

  const { ok, data } = await api("/api/facebook/status");
  facebookConfig = ok ? data : null;

  if (!ok || !data) {
    estado.textContent = "indisponível";
    $("fb-status-valor").textContent = "falha na consulta";
    aviso.textContent = "Não foi possível consultar a integração.";
    botao.disabled = true;
    return;
  }

  $("fb-contas-total").textContent = data.contasConectadas ?? 0;
  $("fb-versao").textContent = data.versaoApi || "—";
  $("fb-escopos").textContent = (data.escopos || []).join(", ") || "—";
  $("fb-escopos").title = (data.escopos || []).join(", ");

  if (data.configurado) {
    estado.textContent = "configurada";
    $("fb-status-valor").textContent = "pronta para conectar";
    aviso.textContent = data.appId ? `App ID ${data.appId}` : "Credenciais presentes";
    botao.disabled = false;
    callout.appendChild(criar("div", "callout ok", "Integração ativa. O botão abre a autorização oficial da Meta e conecta suas Páginas do Facebook."));
  } else {
    estado.textContent = "não configurada";
    $("fb-status-valor").textContent = "faltam credenciais";
    aviso.textContent = "Defina META_APP_ID e META_APP_SECRET no ambiente.";
    botao.disabled = true;
  }
}

async function conectarFacebook() {
  const { ok, status, data } = await api("/api/facebook/conectar");
  if (!ok || !data?.url) {
    toast(data?.error || `Falha ao iniciar o OAuth (HTTP ${status}).`, "error");
    return;
  }
  window.location.href = data.url;
}

async function carregarContas() {
  const tbody = $("contas-linhas");
  limparFilhos(tbody);
  $("contas-vazio").hidden = true;

  await carregarIntegracaoFacebook();
  await carregarIntegracaoInstagram();

  const { ok, data } = await api("/api/contas-sociais");
  if (!ok) return;
  contasCache = data?.contas ?? [];
  $("contas-total").textContent = contasCache.length;

  if (contasCache.length === 0) {
    $("contas-vazio").hidden = false;
    return;
  }

  contasCache.forEach((conta) => {
    const tr = document.createElement("tr");
    tr.appendChild(criar("td", null, conta.rede));

    const contaTd = criar("td");
    contaTd.appendChild(criar("strong", null, conta.nome));
    if (conta.username) contaTd.appendChild(criar("div", "mono", "@" + conta.username));
    tr.appendChild(contaTd);

    tr.appendChild(criar("td", "mono", conta.instagramUserId || conta.facebookPageId || conta.identificador || "—"));

    const origem = criar("td");
    origem.appendChild(criar("span", "tag" + (conta.conectadoVia === "api" ? " pro" : ""), conta.conectadoVia === "api" ? "API oficial" : "manual"));
    tr.appendChild(origem);

    tr.appendChild(criar("td", "mono", conta.tokenExpiraEm ? fmtData(conta.tokenExpiraEm, false) : "—"));

    const statusTd = criar("td");
    statusTd.appendChild(criar("span", "tag", conta.ativa ? "ativa" : "inativa"));
    tr.appendChild(statusTd);

    const acoesTd = criar("td");
    if (temPermissao("gerenciar:contas")) {
      if (conta.conectadoVia === "api") {
        const desconectar = criar("button", "btn ghost small", "Desconectar");
        desconectar.onclick = () => desconectarConta(conta.id, conta.rede);
        acoesTd.appendChild(desconectar);
      } else {
        const remover = criar("button", "btn danger small", "Remover");
        remover.onclick = () => removerConta(conta.id);
        acoesTd.appendChild(remover);
      }
    }
    tr.appendChild(acoesTd);
    tbody.appendChild(tr);
  });
}

async function criarConta(evento) {
  evento.preventDefault();
  const { ok, status, data } = await api("/api/contas-sociais", {
    method: "POST",
    body: JSON.stringify({
      rede: $("conta-rede").value,
      nome: $("conta-nome").value.trim(),
      identificador: $("conta-identificador").value.trim() || null,
    }),
  });
  if (!ok) { toast(data?.error || `Falha ao conectar (HTTP ${status}).`, "error"); return; }
  $("conta-nome").value = "";
  $("conta-identificador").value = "";
  toast("Conta manual cadastrada.", "ok");
  await carregarContas();
}

async function desconectarConta(id, rede) {
  const rotulo = rede === "facebook" ? "Facebook" : "Instagram";
  if (!window.confirm(`Desconectar esta conta do ${rotulo}? O token será apagado e a publicação real deixa de funcionar.`)) return;
  const base = rede === "facebook" ? "/api/facebook" : "/api/instagram";
  const { ok, status, data } = await api(`${base}/${id}/desconectar`, { method: "POST" });
  if (!ok) { toast(data?.error || `Falha ao desconectar (HTTP ${status}).`, "error"); return; }
  toast("Conta desconectada. O token foi removido.", "ok");
  await carregarContas();
}

async function removerConta(id) {
  if (!window.confirm("Remover esta conta social?")) return;
  const { ok, status, data } = await api(`/api/contas-sociais/${id}`, { method: "DELETE" });
  if (!ok) { toast(data?.error || `Falha ao remover (HTTP ${status}).`, "error"); return; }
  toast("Conta removida.", "ok");
  await carregarContas();
}

/* -------------------------------------------------------------- usuários -- */
async function carregarUsuarios() {
  const tbody = $("usuarios-linhas");
  limparFilhos(tbody);
  $("usuarios-vazio").hidden = true;

  const { ok, data } = await api("/api/usuarios");
  if (!ok) return;
  usuariosCache = data?.usuarios ?? [];
  if (usuariosCache.length === 0) { $("usuarios-vazio").hidden = false; return; }

  usuariosCache.forEach((u) => {
    const tr = document.createElement("tr");
    tr.appendChild(criar("td", null, u.nome));
    tr.appendChild(criar("td", "mono", u.email));

    const plano = criar("td");
    plano.appendChild(criar("span", "tag" + (u.premium ? " pro" : ""), u.premium ? "Pro" : "Gratuito"));
    tr.appendChild(plano);

    const papelTd = criar("td");
    if (temPermissao("alterar:papel")) {
      const select = document.createElement("select");
      select.className = "input";
      ["social_media", "cliente", "admin"].forEach((papel) => {
        const opt = new Option(papel, papel);
        if (u.role === papel) opt.selected = true;
        select.appendChild(opt);
      });
      select.disabled = u.id === eu.usuarioId;
      select.title = u.id === eu.usuarioId ? "Você não pode alterar o próprio papel." : "Trocar papel";
      select.onchange = () => alterarPapel(u.id, select.value, select);
      papelTd.appendChild(select);
    } else {
      papelTd.appendChild(criar("span", "role-badge " + u.role, u.role));
    }
    tr.appendChild(papelTd);
    tbody.appendChild(tr);
  });
}

async function alterarPapel(id, role, select) {
  const { ok, status, data } = await api(`/api/usuarios/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  if (!ok) {
    toast(data?.error || `Falha ao alterar o papel (HTTP ${status}).`, "error");
    await carregarUsuarios();
    return;
  }
  toast("Papel atualizado.", "ok");
  await carregarUsuarios();
}

/* ----------------------------------------------------------------- logs --- */
const NOMES_ACAO = {
  post_criado: "post criado",
  post_editado: "post editado",
  post_removido: "post removido",
  post_publicado: "post publicado",
  post_aprovado: "post aprovado",
  post_ajustes_solicitados: "ajustes solicitados",
  midia_enviada: "mídia enviada",
  midia_removida: "mídia removida",
  conta_social_conectada: "conta social conectada",
  conta_social_editada: "conta social editada",
  conta_social_removida: "conta social removida",
  acao_negada: "ação negada (403)",
  login: "login",
  login_falhou: "login falhou",
  logout: "logout",
  alterar_papel: "papel alterado",
  consultar_logs: "consulta de logs",
  assinatura_pro_ativada: "assinatura Pro ativada",
  assinatura_pro_cancelada: "assinatura Pro cancelada",
  checkout_pro_iniciado: "checkout Pro iniciado",
  instagram_conectado: "Instagram conectado",
  instagram_desconectado: "Instagram desconectado",
  facebook_conectado: "Facebook conectado",
  facebook_desconectado: "Facebook desconectado",
};

async function carregarLogs() {
  const lista = $("logs-lista");
  limparFilhos(lista);
  $("logs-vazio").hidden = true;

  const { ok, data } = await api("/api/logs?limite=100");
  if (!ok) return;
  const eventos = data?.eventos ?? [];
  $("logs-total").textContent = eventos.length;

  if (eventos.length === 0) { $("logs-vazio").hidden = false; return; }

  // Mais recentes primeiro para a leitura na tela.
  [...eventos].reverse().forEach((ev) => {
    const item = criar("div", "log-item");
    const top = criar("div", "log-top");
    const negado = ev.acao === "acao_negada" || ev.acao === "login_falhou";
    top.appendChild(criar("span", "acao" + (negado ? " negado" : ""), NOMES_ACAO[ev.acao] || ev.acao));
    top.appendChild(criar("span", "tag", ev.origem || "app"));
    top.appendChild(criar("span", "hora", fmtData(ev.timestamp)));
    item.appendChild(top);

    const detalhe = criar("div", "detalhe");
    detalhe.appendChild(criar("strong", null, ev.usuario ? `${ev.usuario} (${ev.papel || "—"})` : "Sistema/anônimo"));
    detalhe.appendChild(document.createTextNode(ev.recurso ? ` · ${ev.recurso}` : ""));
    detalhe.appendChild(document.createTextNode(ev.detalhe ? ` · ${ev.detalhe}` : ""));
    if (ev.ip) detalhe.appendChild(document.createTextNode(` · IP ${ev.ip}`));
    item.appendChild(detalhe);

    lista.appendChild(item);
  });
}

/* ----------------------------------------------------------------- plano -- */
async function carregarPlano() {
  const alvo = $("plano-conteudo");
  limparFilhos(alvo);
  alvo.appendChild(criar("div", "empty", "Carregando plano…"));

  const { ok, data } = await api("/api/plano/status");
  if (!ok) { limparFilhos(alvo); alvo.appendChild(criar("div", "empty", "Não foi possível carregar o plano.")); return; }

  limparFilhos(alvo);
  const card = criar("div", "plan-card" + (data.premium ? " pro" : ""));

  const titulo = criar("h2", null, data.premium ? "Plano Pro ativo" : "Plano Gratuito");
  titulo.style.fontSize = "1.2rem";
  titulo.style.marginBottom = "6px";
  card.appendChild(titulo);

  if (data.premium) {
    card.appendChild(criar("p", null, "Posts ilimitados. A assinatura foi confirmada pelo Stripe e vale para esta conta."));
  } else {
    card.appendChild(
      criar("p", null, `${data.posts} de ${data.limitePosts} posts usados no plano gratuito. Assine o Pro para criar sem limite.`)
    );
    const meter = criar("div", "plan-meter");
    const preenchido = criar("span");
    const pct = data.limitePosts ? Math.min(100, Math.round((data.posts / data.limitePosts) * 100)) : 0;
    preenchido.style.width = pct + "%";
    meter.appendChild(preenchido);
    card.appendChild(meter);

    const botao = criar("button", "btn", `Assinar Pro — ${data.preco}`);
    botao.onclick = assinarPro;
    card.appendChild(botao);

    if (!data.stripeConfigurado) {
      const aviso = criar("p", "mono", "Stripe não configurado neste ambiente: o checkout responderá 503. O restante do sistema continua funcionando.");
      aviso.style.marginTop = "12px";
      card.appendChild(aviso);
    }
  }

  alvo.appendChild(card);
}

async function assinarPro() {
  const { ok, status, data } = await api("/api/plano/checkout", { method: "POST" });
  if (!ok || !data?.url) {
    toast(data?.error || `Não foi possível abrir o checkout (HTTP ${status}).`, "error");
    return;
  }
  window.location.href = data.url;
}

async function tratarRetornoCheckout() {
  const params = new URLSearchParams(window.location.search);
  const estado = params.get("checkout");
  if (!estado) return;
  history.replaceState({}, "", "/painel");

  if (estado === "cancelado") {
    toast("Checkout cancelado — nenhuma cobrança foi feita.", "warn");
    return;
  }
  if (estado !== "sucesso") return;

  abrirTab("plano");
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    const { ok, data } = await api("/api/plano/status");
    if (ok && data?.premium) {
      await carregarSessao();
      await carregarPlano();
      toast("Plano Pro ativado!", "ok");
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  toast("O Stripe confirmou o pagamento, mas o webhook ainda não chegou. Recarregue em instantes.", "warn");
}

/* ---------------------------------------------------------------- logout -- */
async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {}
  localStorage.clear();
  window.location.href = "/login";
}

/* ----------------------------------------------------------------- boot --- */
(async function iniciar() {
  await carregarSessao();

  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");

  await carregarPosts();

  if (postId) {
    await abrirDetalhe(Number(postId));
  }

  const ig = params.get("instagram");
  const fb = params.get("facebook");
  if (ig || fb) {
    history.replaceState({}, "", "/painel");
    abrirTab("contas");
  }
  if (ig) {
    if (ig === "conectado") toast(`${params.get("contas") || "1"} conta(s) conectada(s) ao Instagram.`, "ok");
    else if (ig === "erro") toast(params.get("motivo") || "Falha na conexão com o Instagram.", "error");
  }
  if (fb) {
    if (fb === "conectado") toast(`${params.get("contas") || "1"} página(s) conectada(s) ao Facebook.`, "ok");
    else if (fb === "erro") toast(params.get("motivo") || "Falha na conexão com o Facebook.", "error");
  }

  tratarRetornoCheckout();

  // Fecha modais com clique no fundo ou Esc.
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
  });
})();
