const $ = (s) => document.querySelector(s),
  app = $("#app");
const A11Y_STORAGE_KEY = "mwe-acessibilidade";
const A11Y_DEFAULTS = {
  tamanho: "1",
  contraste: false,
  foco: false,
  animacoes: false,
  alertas: false,
};
const readA11yPreferences = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY));
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return { ...A11Y_DEFAULTS };
    return {
      tamanho: ["1", "1.25", "1.5"].includes(String(saved.tamanho))
        ? String(saved.tamanho)
        : A11Y_DEFAULTS.tamanho,
      contraste: typeof saved.contraste === "boolean" ? saved.contraste : false,
      foco: typeof saved.foco === "boolean" ? saved.foco : false,
      animacoes: typeof saved.animacoes === "boolean" ? saved.animacoes : false,
      alertas: typeof saved.alertas === "boolean" ? saved.alertas : false,
    };
  } catch {
    return { ...A11Y_DEFAULTS };
  }
};
let a11yPreferences = readA11yPreferences();
function applyA11yPreferences() {
  document.documentElement.style.setProperty(
    "--a11y-scale",
    a11yPreferences.tamanho,
  );
  document.body.classList.toggle("a11y-high-contrast", a11yPreferences.contraste);
  document.body.classList.toggle("a11y-focus-always", a11yPreferences.foco);
  document.body.classList.toggle("a11y-reduce-motion", a11yPreferences.animacoes);
  document.body.classList.toggle("a11y-visual-alerts", a11yPreferences.alertas);
}
applyA11yPreferences();
const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ST = {
  rascunho: "Rascunho",
  pendente: "Proposta",
  preparacao: "Em preparação",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
const TIPOS = [
  "Casamento",
  "Corporativo",
  "Show",
  "Aniversário",
  "Formatura",
  "Outro",
];
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pd = (s) => new Date(s + "T00:00"),
  add = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
const fmt = (s) =>
  s
    ? pd(s).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
function formatConfiguredDate(s, format = "dd/mm/aaaa") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return "";
  const [year, month, day] = s.split("-");
  if (format === "aaaa-mm-dd") return `${year}-${month}-${day}`;
  if (format === "mm/dd/aaaa") return `${month}/${day}/${year}`;
  return `${day}/${month}/${year}`;
}
const mes = (d) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const toast = (m, err) => {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.setAttribute("role", "status");
  t.setAttribute("aria-live", "polite");
  t.setAttribute("aria-atomic", "true");
  t.textContent = a11yPreferences.alertas ? `Aviso: ${m}` : m;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
};
const api = async (m, u, b) => {
  const r = await fetch("/api" + u, {
    method: m,
    headers: { "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw j;
  return j;
};
const errMsg = (x) =>
  x.fields ? Object.values(x.fields).join(" ") : x.error || "Erro inesperado.";
const field = (l, n, v = "", t = "text", x = "") =>
  `<label>${l}<input name="${n}" type="${t}" value="${e(v)}" ${x}></label>`;
const sel = (l, n, o, v, x = "") =>
  `<label>${l}<select name="${n}" ${x}>${o.map(([k, t]) => `<option value="${e(k)}" ${String(k) === String(v ?? "") ? "selected" : ""}>${e(t)}</option>`).join("")}</select></label>`;
const FIN_ST = {
  pendente: "A receber",
  pago: "Recebido",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};
const badge = (s) =>
  `<span class="badge s-${s}">${ST[s] || FIN_ST[s] || s}</span>`;
const statusOpts = [["", "Todos os status"], ...Object.entries(ST)];
const financeStatusOpts = [
  ["", "Todos os status"],
  ...Object.entries(FIN_ST),
];
let me = null;
const V = {
    from: "",
    to: "",
    mode: "month",
    cur: new Date(),
    q: "",
    status: "",
  },
  E = { q: "", status: "", from: "", to: "" },
  C = { q: "", sort: "recent", status: "" },
  F = { q: "", status: "", from: "", to: "" };
const TM = { q: "", role: "" };
const R = { eventId: "", q: "" };
const O = { V, E, C, TM, F, R };

const NAV = [
    ["overview", "Visão Geral"],
    ["agenda", "Agenda"],
    ["events", "Eventos"],
    ["clients", "Clientes"],
    ["finances", "Financeiro"],
    ["reports", "Relatórios"],
    ["team", "Equipe"],
    ["repertoire", "Repertório"],
    ["settings", "Configurações"],
    ["accessibility", "Acessibilidade"],
    ["admin", "Colaboradores"],
  ],
  SOON = [];
const SUBS = {
  overview: "Resumo dos seus eventos e indicadores",
  agenda: "Planeje eventos, ensaios e compromissos da equipe.",
  events: "Acompanhe contratos, propostas e a operação de cada evento.",
  clients: "Gerencie seu portfólio de clientes e casais.",
  finances: "Acompanhe recebimentos, parcelas e vencimentos.",
  reports: "Consulte indicadores e exporte relatórios.",
  team: "Gerencie os integrantes e suas funções",
  repertoire: "Organize músicas, momentos e aprovação por evento.",
  settings: "Gerencie o perfil da empresa e as preferências da conta.",
  accessibility: "Ajuste leitura, contraste, movimento e formas de interação.",
  admin: "Gerencie colaboradores, permissões e auditoria da organização.",
  account: "Gerencie seus dados de acesso",
};
const subOf = (page, title) =>
  /^(Cadastrar|Editar)/.test(title)
    ? "Preencha os dados principais para iniciar o planejamento."
    : /^Detalhes/.test(title)
      ? "Consulte as informações completas do evento."
      : SUBS[page] || "";
const ini2 = (n) => {
  const w = String(n)
    .split(/\s+/)
    .filter((x) => /^[\p{L}\p{N}]/u.test(x));
  return (
    w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)
  ).toUpperCase();
};
const ic = (p) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const CI = {
  cal: ic(
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  ),
  pin: ic(
    '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/>',
  ),
  phone: ic(
    '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>',
  ),
  mail: ic(
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  ),
};
const ciRow = (i, t) => (t ? `<li>${CI[i]}<span>${e(t)}</span></li>` : "");
const longDate = (s) =>
  s
    ? pd(s).toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
const shell = (page, title, body, actions = "") => {
  const visibleNav = NAV.filter(([key]) => key !== "admin" || me.role === "admin");
  const who = me.name || me.email,
    tab = ([k, l]) =>
      `<a href="#/${k}" class="${k == page ? "on" : ""}">${k == "overview" ? "Início" : l}</a>`;
  app.innerHTML = `<aside class="side"><a class="logo" href="#/overview"><img class="brand-logo" src="logo.jpg" width="150" height="120" alt="Logo MWE Harmonize"><span class="leg_mwe">MWE Harmonize</span><small>Gestão de Eventos Musicais</small></a><nav aria-label="Menu principal">${visibleNav.map(([k, l]) => `<a href="#/${k}" class="${k == page ? "on" : ""}"${k == page ? ' aria-current="page"' : ""}><span class="ni">${navIcon(k)}<b>${l}</b></span></a>`).join("")}${SOON.map((l) => `<span class="soon" title="Módulo de outro integrante"><span class="ni">${navIcon(l)}<b>${l}</b></span><small>em breve</small></span>`).join("")}</nav><a class="btn rose newbtn" href="#/event/new">Novo evento</a><div class="me side-user"><a class="avatar" href="#/account" aria-label="Minha conta">${e(ini2(who))}</a><a class="who" href="#/account"><b>${e(who)}</b><small>${e(me.email || "")}</small></a><button type="button" data-act="logout" class="exit" title="Sair" aria-label="Sair">↪</button></div></aside><div class="workspace"><header class="top"><div class="leg_cabecalho"><h1>${title}</h1><p>${e(subOf(page, title))}</p></div><div class="head-actions">${actions}</div><div class="top-user"><span class="avatar">${e(ini2(who))}</span><span><b>${e(who)}</b><small>MWE Harmonize</small></span></div></header><main>${body}</main></div><nav class="tabbar" aria-label="Navegação principal">${visibleNav.map(tab).join("")}<a href="#/account">Conta</a></nav>`;
};
const authCard = (inner, split) => {
  app.innerHTML = split
    ? `<div class="login"><section class="brand"><div><div class="logo">MWE Harmonize</div><p>Gestão de Eventos Musicais</p></div><div><blockquote>“Cada evento merece uma experiência musical inesquecível.”</blockquote><p>Centralize agenda, clientes, repertório, equipe e financeiro em um só lugar.</p><ul><li>Agenda integrada</li><li>Clientes e propostas</li><li>Financeiro e relatórios</li></ul></div><small>MWE Harmonize · Feito para equipes musicais</small></section><section class="pane"><div class="card">${inner}</div></section></div>`
    : `<div class="auth"><div class="card"><div class="logo dark">Harmonize</div>${inner}</div></div>`;
};

// ---------- Roteador ----------
async function route() {
  const [p, qs] = (location.hash.slice(2) || "overview").split("?"),
    q = new URLSearchParams(qs || ""),
    s = p.split("/");
  try {
    me = await api("GET", "/auth/me");
  } catch {
    me = null;
  }
  if (!me && s[0] === "invite") return inviteView(q.get("token") || "");
  if (!me)
    return s[0] == "reset"
      ? resetView(q.get("token"))
      : loginView(s[0] == "forgot");
  if (["login", "forgot", "reset"].includes(s[0]))
    return (location.hash = "#/overview");
  const f =
    {
      overview: overviewView,
      team: teamView,
      account: accountView,
      agenda: agendaView,
      events: eventsView,
      clients: clientsView,
      finances: financesView,
      reports: reportsView,
      repertoire: repertoireView,
      settings: settingsView,
      accessibility: accessibilityView,
      admin: adminView,
      event: () => eventRoute(s, q),
    }[s[0]] || overviewView;
  try {
    await f();
  } catch (x) {
    toast(errMsg(x), 1);
  }
}
addEventListener("hashchange", route);
route();

// ---------- Autenticação ----------
function loginView(forgot) {
  if (forgot)
    return authCard(
      `<h2>Recuperar acesso</h2><p>Informe seu e-mail para receber o link de redefinição.</p><form data-form="forgot">${field("E-mail", "email", "", "email", "required")}<button class="btn">Enviar link</button></form><p id="msg" class="note" role="status"></p><a href="#/login">Voltar ao login</a>`,
    );
  authCard(
    `<small class="eyebrow">ACESSO SEGURO</small><h2>Bem-vindo de volta</h2><p class="note">Entre com seus dados para acessar a MWE Harmonize.</p><form data-form="login">${field("E-mail", "email", "", "email", 'required autocomplete="username" placeholder="nome@empresa.com"')}<label>Senha<span class="pw"><input name="password" type="password" required autocomplete="current-password" placeholder="••••••••"><button type="button" class="eye" data-act="showpw" aria-label="Mostrar senha">◉</button></span></label><div class="between"><label class="chk"><input type="checkbox" name="remember"> Manter conectado</label><a href="#/forgot"><b>Esqueci minha senha</b></a></div><div id="msg" class="errtxt" role="alert"></div><button class="btn wide">Entrar</button></form><p><b>Primeiro acesso?</b><br><span class="note">Solicite suas credenciais ao administrador responsável pela equipe.</span></p>`,
    true,
  );
}
const resetView = (t) =>
  authCard(
    `<h2>Nova senha</h2><form data-form="reset"><input type="hidden" name="token" value="${e(t)}">${field("Nova senha (mín. 12 caracteres)", "password", "", "password", "required minlength=12 maxlength=1024")}<div id="msg" class="errtxt"></div><button class="btn">Redefinir</button></form>`,
  );

// ---------- Visão geral e conta ----------
// ---------- Equipe (páginas do Wesley adaptadas ao app, com dados reais) ----------
const TEAM_ROLES = ["Músico", "Técnico", "Mídia", "Administrativo"];
const ICONS = {
  overview: "visao_geral",
  agenda: "agenda",
  events: "evento",
  clients: "cliente",
  team: "equipe",
  admin: "equipe",
  finances: "financeiro",
  reports: "relatorio",
  repertoire: "repertorio",
  accessibility: "",
  Repertório: "repertorio",
  Financeiro: "financeiro",
  Relatórios: "relatorio",
};
const navIcon = (k) => k === "accessibility"
  ? `<svg class="mi" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="m5 8 7 1.5L19 8M12 10v4.5M9 21l3-6.5 3 6.5"/></svg>`
  : ICONS[k]
    ? `<img class="mi" src="icons/${ICONS[k]}.png" alt="" width="20" height="20">`
    : "";
async function teamView() {
  const all = await api("GET", "/team"),
    term = TM.q.trim().toLowerCase(),
    ym = new Date().toISOString().slice(0, 7);
  const rows = all.filter(
    (x) =>
      (!TM.role || x.role == TM.role) &&
      (!term ||
        [x.name, x.role, x.phone, x.status]
          .join(" ")
          .toLowerCase()
          .includes(term)),
  );
  const stat = (l, v, i) =>
    `<article class="card tstat"><div><small>${l}</small><strong>${v}</strong></div><i aria-hidden="true">${i}</i></article>`;
  shell(
    "team",
    "Equipe",
    `<div class="cards stats4">${stat("Total cadastrado", all.length, "▦")}${stat("Ativos", all.filter((x) => x.status == "ativo").length, "✓")}${stat("Este mês", all.filter((x) => (x.created_at || "").startsWith(ym)).length, "◷")}${stat("Inativos", all.filter((x) => x.status == "inativo").length, "!")}</div><div class="card" style="margin-top:16px"><div class="bar"><input type="search" data-o="TM" data-k="q" placeholder="Buscar cadastro" aria-label="Buscar cadastro" value="${e(TM.q)}">${sel("", "r", [["", "Todos"], ...TEAM_ROLES.map((r) => [r, r])], TM.role, 'data-o="TM" data-k="role" aria-label="Filtrar por função"')}</div><div class="scroll"><table class="tbl"><thead><tr><th>Integrante</th><th>Função</th><th>Telefone</th><th>Status</th><th style="text-align:right">Ações</th></tr></thead><tbody>${rows.map((m) => `<tr><td><div class="person"><span class="avatar">${e(ini2(m.name))}</span><b>${e(m.name)}</b></div></td><td>${e(m.role)}</td><td>${e(m.phone)}</td><td><span class="badge ${m.status == "ativo" ? "s-confirmado" : "off"}">${m.status == "ativo" ? "Ativo" : "Inativo"}</span></td><td><div class="actions"><button type="button" data-act="editmember" data-c='${e(JSON.stringify(m))}' title="Editar" aria-label="Editar ${e(m.name)}">✎</button><button type="button" data-act="delmember" data-id="${m.id}" title="Excluir" aria-label="Excluir ${e(m.name)}">⌫</button></div></td></tr>`).join("") || '<tr><td colspan="5"><div class="empty note"><div><b>Nenhum cadastro encontrado</b>Use o botão de novo cadastro para começar.</div></div></td></tr>'}</tbody></table></div></div><dialog id="dlg"></dialog>`,
    '<button class="btn" data-act="editmember" data-c="{}">+ Novo cadastro</button>',
  );
}

async function overviewView() {
  const o = await api("GET", "/overview"),
    box = (l, n) =>
      `<div class="card"><p class="note">${l}</p><h2>${n}</h2></div>`;
  shell(
    "overview",
    "Visão Geral",
    `<div class="cards">${box("Eventos", o.events)}${box("Clientes", o.clients)}${o.byStatus.map((x) => box(ST[x.status] || x.status, x.n)).join("")}</div><h2 style="margin:24px 0 12px">Próximos eventos</h2><div class="list">${o.upcoming.map((x) => evRow(x)).join("") || '<p class="note">Nenhum evento futuro. <a href="#/event/new">Criar evento</a></p>'}</div>`,
    '<a class="btn" href="#/event/new">+ Novo evento</a>',
  );
}
function accountView() {
  shell(
    "account",
    "Minha conta",
    `<div class="row" style="align-items:start"><form class="card" data-form="profile"><h3>Dados de acesso</h3>${field("Nome", "name", me.name)}${field("E-mail", "email", me.email, "email")}<button class="btn">Salvar</button></form><form class="card" data-form="password"><h3>Alterar senha</h3>${field("Senha atual", "current", "", "password", 'autocomplete="current-password"')}${field("Nova senha (mín. 12 caracteres)", "password", "", "password", 'minlength=12 maxlength=1024 autocomplete="new-password"')}${field("Confirmar nova senha", "confirm", "", "password", 'autocomplete="new-password"')}<button class="btn">Alterar senha</button></form></div>`,
  );
}

const permissionLabels = {
  "users.view": "Listar colaboradores", "users.create": "Convidar colaboradores", "users.edit": "Editar colaboradores", "users.disable": "Ativar, desativar e bloquear", "users.delete": "Remover colaboradores",
  "events.view": "Consultar eventos", "events.create": "Criar eventos", "events.edit": "Editar eventos", "events.delete": "Excluir eventos",
  "clients.view": "Consultar clientes", "clients.create": "Criar clientes", "clients.edit": "Editar clientes", "clients.delete": "Excluir clientes",
  "finance.view": "Consultar financeiro", "finance.create": "Criar lançamentos", "finance.edit": "Editar lançamentos", "finance.delete": "Excluir lançamentos",
  "team.view": "Consultar equipe", "team.create": "Adicionar equipe", "team.edit": "Editar equipe", "team.delete": "Remover equipe",
  "reports.view": "Consultar relatórios", "repertoire.view": "Consultar repertório", "repertoire.edit": "Editar repertório", "settings.view": "Consultar configurações", "settings.edit": "Editar configurações", "audit.view": "Consultar auditoria",
};
async function adminView() {
  if (me.role !== "admin") { location.hash = "#/overview"; return; }
  const data = await api("GET", "/admin/users");
  const rows = data.users || [];
  shell("admin", "Colaboradores", `<div class="row" style="align-items:start"><form class="card" data-form="invite"><h3>Convidar usuário</h3><p class="note">Enviaremos um convite com validade de 48 horas para a pessoa criar a própria senha.</p>${field("Nome completo *", "name", "", "text", "required maxlength=120")}${field("E-mail *", "email", "", "email", "required maxlength=254")}${sel("Perfil", "role", [["admin", "Administrador"], ["collaborator", "Colaborador"]], "collaborator")}<button class="btn">Enviar convite</button></form><section class="card"><div class="between"><div><h3>Usuários da organização</h3><p class="note">Acesso restrito aos dados desta organização.</p></div><button class="btn ghost" data-act="auditview">Ver auditoria</button></div><div class="scroll"><table class="tbl"><thead><tr><th>Colaborador</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th>Ação</th></tr></thead><tbody>${rows.map((user) => `<tr><td><b>${e(user.name)}</b><br><small>${e(user.email)}</small></td><td>${user.role === "admin" ? "Administrador" : "Colaborador"}</td><td>${user.status === "active" ? "Ativo" : user.status === "blocked" ? "Bloqueado" : user.status === "pending" ? "Convite pendente" : "Desativado"}</td><td>${user.last_login_at ? new Date(user.last_login_at).toLocaleString("pt-BR") : "—"}</td><td>${Number(user.id) === Number(me.id) ? "—" : `<button class="link" data-act="edituser" data-u='${e(JSON.stringify(user))}'>Editar acesso</button>`}</td></tr>`).join("") || '<tr><td colspan="5" class="note">Nenhum usuário cadastrado.</td></tr>'}</tbody></table></div></section></div><section class="card"><h3>Convites pendentes</h3><div class="scroll"><table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Validade</th></tr></thead><tbody>${(data.invitations || []).map((invite) => `<tr><td>${e(invite.name)}</td><td>${e(invite.email)}</td><td>${invite.role === "admin" ? "Administrador" : "Colaborador"}</td><td>${new Date(invite.expires_at).toLocaleString("pt-BR")}</td></tr>`).join("") || '<tr><td colspan="4" class="note">Nenhum convite pendente.</td></tr>'}</tbody></table></div></section><section id="admin-audit" class="card" hidden aria-live="polite"></section><dialog id="dlg"></dialog>`, "");
}
function inviteView(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) return authCard(`<h2>Convite inválido</h2><p class="note">Este convite está inválido ou expirado. Solicite um novo ao administrador.</p>`);
  authCard(`<small class="eyebrow">PRIMEIRO ACESSO</small><h2>Ative sua conta</h2><p class="note">Crie uma senha com pelo menos 12 caracteres.</p><form data-form="acceptInvite"><input type="hidden" name="token" value="${e(token)}">${field("Senha", "password", "", "password", "required minlength=12 maxlength=1024 autocomplete=new-password")}<div id="msg" class="errtxt" role="alert"></div><button class="btn wide">Ativar conta</button></form>`);
}

// ---------- Financeiro e relatórios ----------
const metricCard = (label, value, tone = "") =>
  `<article class="card stat ${tone}"><small>${e(label)}</small><h2>${e(value)}</h2></article>`;
async function financesView() {
  const qs = new URLSearchParams(Object.entries(F).filter(([, value]) => value));
  const data = await api("GET", "/finances?" + qs);
  const rows = data.items || [];
  const kpi = data.kpi || {};
  shell(
    "finances",
    "Financeiro",
    `<div class="cards finance-kpis">${metricCard("Recebido", money(kpi.received))}${metricCard("A receber", money(kpi.to_receive))}${metricCard("Em atraso", money(kpi.overdue), "negative")}</div>
      <div class="bar" style="margin-top:16px"><input data-o="F" data-k="q" placeholder="Buscar lançamento ou evento" value="${e(F.q)}">${sel("", "status", financeStatusOpts, F.status, 'data-o="F" data-k="status" aria-label="Filtrar por status financeiro"')}<input type="date" data-o="F" data-k="from" value="${e(F.from)}" aria-label="Vencimento a partir de"><input type="date" data-o="F" data-k="to" value="${e(F.to)}" aria-label="Vencimento até">${Object.values(F).some(Boolean) ? '<button class="btn ghost" data-act="clearfin">Limpar filtros</button>' : ""}</div>
      <div class="card"><div class="between finance-title"><h3>Lançamentos financeiros</h3><span class="note">${rows.length} lançamento(s)</span></div><div class="scroll"><table class="tbl finance-table"><thead><tr><th>Descrição / Evento</th><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map((x) => `<tr><td><b>${e(x.description)}</b><br><small>${e(x.event_name || "Sem evento vinculado")}${x.client_name ? " · " + e(x.client_name) : ""}</small></td><td>${e(x.installment || "—")}</td><td>${fmt(x.due_date)}${x.paid_date ? `<br><small>Recebido em ${fmt(x.paid_date)}</small>` : ""}</td><td><b>${money(x.amount)}</b></td><td>${badge(x.status)}</td><td class="nw"><button class="link" data-act="editfin" data-f='${e(JSON.stringify(x))}'>Editar</button> · <button class="link" data-act="delfin" data-id="${x.id}">Excluir</button></td></tr>`).join("") || '<tr><td colspan="6"><div class="empty note"><div><b>Nenhum lançamento encontrado</b>Adicione um recebimento ou valor a receber.</div></div></td></tr>'}</tbody></table></div></div><dialog id="dlg"></dialog>`,
    '<button class="btn" data-act="editfin" data-f="{}">+ Novo lançamento</button>',
  );
}

async function reportsView() {
  const r = await api("GET", "/reports/kpis");
  const statuses = r.events.by_status || [];
  shell(
    "reports",
    "Relatórios e Indicadores",
    `<section><h2 class="report-heading">Eventos</h2><div class="cards">${metricCard("Total de eventos", r.events.total)}${metricCard("Confirmados ou concluídos", r.events.confirmed)}${metricCard("Taxa de confirmação", `${r.events.rate}%`)}</div><div class="card report-status"><h3>Eventos por status</h3><div class="scroll"><table class="tbl"><thead><tr><th>Status</th><th>Quantidade</th></tr></thead><tbody>${statuses.map((x) => `<tr><td>${badge(x.status)}</td><td>${x.count}</td></tr>`).join("") || '<tr><td colspan="2" class="note">Ainda não há eventos cadastrados.</td></tr>'}</tbody></table></div></div></section>
      <section><h2 class="report-heading">Financeiro</h2><div class="cards">${metricCard("Recebido", money(r.finances.received))}${metricCard("A receber", money(r.finances.to_receive))}${metricCard("Em atraso", money(r.finances.overdue), "negative")}</div></section>
      <section><h2 class="report-heading">Exportação CSV</h2><div class="cards report-exports"><article class="card"><h3>Relatório de eventos</h3><p class="note">Eventos, clientes, datas, status e valores de contrato.</p><button class="btn ghost" data-act="export" data-type="events">Exportar eventos</button></article><article class="card"><h3>Relatório financeiro</h3><p class="note">Recebimentos, parcelas, vencimentos e status financeiros.</p><button class="btn ghost" data-act="export" data-type="financial">Exportar financeiro</button></article></div></section>`,
  );
}

// ---------- Repertório completo ----------
const REP_MOMENTS = [
  ["entrada", "Entrada"],
  ["assinaturas", "Assinaturas"],
  ["saida", "Saída"],
  ["coquetel", "Coquetel"],
  ["outro", "Outro"],
  ["recepcao", "Recepção"],
  ["noiva", "Entrada da Noiva"],
  ["noivo", "Entrada do Noivo"],
  ["padrinhos", "Entrada dos Padrinhos"],
  ["assinatura", "Assinatura"],
];
const momentName = (key) => REP_MOMENTS.find(([value]) => value === key)?.[1] || key;
const repKey = (eventId, moment) => `${eventId}|${moment}`;
function openRepSong(song = {}) {
  const d = $("#dlg");
  d.innerHTML = `<h3>${song.id ? "Editar" : "Adicionar"} música</h3><form data-form="repSong"><input type="hidden" name="id" value="${e(song.id || "")}">${sel("Evento *", "evento", (R.events || []).map((event) => [String(event.id), event.name]), song.evento || R.eventId)}${sel("Momento *", "momento", REP_MOMENTS, song.momento || "recepcao")}${field("Ordem *", "ordem", song.ordem || 1, "number", 'required min="1" step="1"')}${field("Música *", "music", song.music || "", "text", "required maxlength=180")}${field("Artista / performer", "art", song.art || "", "text", "maxlength=180")}${field("Compositor", "compo", song.compo || "", "text", "maxlength=180")}${field("Instrumentação", "instru", song.instru || "", "text", "maxlength=240")}<label>Observações<textarea name="obs" rows="3" maxlength="2000">${e(song.obs || "")}</textarea></label>${field("Link de referência", "link", song.link || "", "url", 'maxlength=2000 placeholder="https://..."')}<div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar música</button></div></form>`;
  d.showModal();
}
async function saveRepertoire(data) {
  try {
    const saved = await api("PUT", "/repertorios", {
      musicas: data.musicas.filter((song) => !song.legacy),
      duracoes: data.duracoes,
      statusEventos: data.statusEventos,
    });
    R.data = saved;
    toast("Repertório salvo.");
    await route();
    return true;
  } catch (x) {
    toast(errMsg(x), 1);
    return false;
  }
}
async function repertoireView() {
  const [data, events, settings] = await Promise.all([
    api("GET", "/repertorios"),
    api("GET", "/events"),
    api("GET", "/configuracoes"),
  ]);
  R.data = data;
  R.events = events;
  R.settings = settings;
  if (!events.some((event) => String(event.id) === String(R.eventId)))
    R.eventId = events.length ? String(events[0].id) : "";
  const event = events.find((item) => String(item.id) === String(R.eventId));
  const eventSongs = data.musicas.filter((song) => song.evento === String(R.eventId));
  const query = R.q.trim().toLocaleLowerCase("pt-BR");
  const groups = REP_MOMENTS.map(([moment]) => [
    moment,
    eventSongs.filter((song) => song.momento === moment &&
      [momentName(moment), song.music, song.art, song.compo, song.instru, song.obs]
        .join(" ").toLocaleLowerCase("pt-BR").includes(query)),
  ]).filter(([, songs]) => songs.length);
  const status = data.statusEventos[R.eventId] || "pendente";
  const eventDate = event?.date ? fmt(event.date) : "";
  const dateText = formatConfiguredDate(event?.date, R.settings?.formato) || eventDate;
  const eventDetails = [dateText, event?.start_time, event?.venue].filter(Boolean).join(" · ");
  const body = event
    ? `<div class="rep-toolbar"><div class="rep-event-select">${sel("Evento", "eventId", events.map((x) => [String(x.id), x.name]), R.eventId, 'data-o="R" data-k="eventId"')}</div><div class="rep-event-meta"><span>${e(eventDetails || "Sem data ou local informados")}</span><span class="rep-approval ${status}">${status === "aprovado" ? "Aprovado" : "Pendente de aprovação"}</span><button class="btn ghost" data-act="editRepStatus">Alterar status</button></div></div>
      <div class="bar rep-search"><input data-o="R" data-k="q" type="search" placeholder="Buscar música, artista ou momento" value="${e(R.q)}"><button class="btn" data-act="newRepSong">+ Adicionar música</button></div>
      <div class="rep-groups">${groups.map(([moment, songs]) => {
        const key = repKey(R.eventId, moment);
        const duration = data.duracoes[key];
        const ordered = [...songs].sort((a, b) => a.ordem - b.ordem);
        return `<section class="card rep-group" data-moment="${e(moment)}"><header class="rep-group-head"><div><h2>${e(momentName(moment))}</h2><p class="note">${ordered.length} música(s)${duration ? ` · Aproximadamente ${duration} min` : ""}</p></div><button class="btn ghost" data-act="editRepDuration" data-moment="${e(moment)}">${duration ? "Editar duração" : "Definir duração"}</button></header><div class="rep-song-list">${ordered.map((song) => `<article class="rep-song"><div class="rep-song-order">${song.ordem}</div><div class="rep-song-info"><h3>${e(song.music)}</h3><p>${e(song.art)}${song.compo ? ` · ${e(song.compo)}` : ""}</p>${song.instru ? `<small>Instrumentação: ${e(song.instru)}</small>` : ""}${song.obs ? `<small>${e(song.obs)}</small>` : ""}${song.legacy ? '<span class="rep-legacy">Já cadastrado em Eventos · somente leitura aqui</span>' : ""}</div><div class="rep-song-actions">${song.link ? `<button class="btn ghost" data-act="playRepSong" data-song='${e(JSON.stringify(song))}'>Reproduzir</button>` : ""}${song.legacy ? `<a class="btn ghost" href="#/event/${e(song.evento)}/edit">Abrir evento</a>` : `<button class="btn ghost" data-act="editRepSong" data-id="${song.id}">Editar</button><button class="btn danger" data-act="deleteRepSong" data-id="${song.id}">Excluir</button>`}</div></article>`).join("")}</div></section>`;
      }).join("") || `<div class="card empty note"><div><b>${query ? "Nenhuma música encontrada" : "Nenhuma música neste evento"}</b>${query ? "Altere a busca ou limpe o filtro." : "Adicione músicas para organizar o repertório por momento."}</div></div>`}</div>
      <dialog id="dlg"></dialog><dialog id="rep-player"><button class="btn ghost" data-act="closeRepPlayer">Fechar</button><h2 id="rep-player-title"></h2><div id="rep-player-content"></div><p id="rep-player-message" class="note"></p><a id="rep-player-link" class="btn ghost" target="_blank" rel="noopener noreferrer">Abrir referência</a></dialog>`
    : `<div class="card empty note"><div><b>Nenhum evento disponível</b>Cadastre um evento antes de organizar o repertório.</div></div>`;
  shell("repertoire", "Repertório", body,
    event ? `<span class="badge s-${status === "aprovado" ? "confirmado" : "pendente"}">${status === "aprovado" ? "Aprovado" : "Pendente de aprovação"}</span>` : "");
}

// ---------- Configurações da empresa ----------
const CONFIG_DEFAULTS = {
  nome: "", exibicao: "", email: me?.email || "", telefone: "", idioma: "pt-BR",
  moeda: "BRL", formato: "dd/mm/aaaa", fuso: "America/Sao_Paulo",
  novosEventos: true, vencimentos: true, escalas: false,
};
async function settingsView() {
  const loaded = await api("GET", "/configuracoes");
  const data = { ...CONFIG_DEFAULTS, ...loaded };
  const checkbox = (name, title, desc) =>
    `<label class="setting-toggle"><span><b>${title}</b><small>${desc}</small></span><input type="checkbox" name="${name}" ${data[name] ? "checked" : ""}></label>`;
  shell(
    "settings",
    "Configurações",
    `<section class="card settings-account"><div><small>Conta conectada</small><h2>${e(me.name || "Usuário")}</h2><p class="note">${e(me.email || "")}</p></div><span class="badge s-confirmado">Sessão ativa</span></section>
      <form data-form="settings" class="settings-form"><section class="card"><h2>Perfil da empresa</h2><p class="note">Esses dados são independentes das credenciais de login.</p><div class="settings-grid">${field("Nome da empresa *", "nome", data.nome, "text", "required maxlength=120")}${field("Nome de exibição *", "exibicao", data.exibicao, "text", "required maxlength=120")}${field("E-mail corporativo *", "email", data.email, "email", "required maxlength=254")}${field("Telefone com DDD *", "telefone", data.telefone, "tel", 'required inputmode="numeric" maxlength=11 placeholder="11999999999"')}</div></section>
      <section class="card"><h2>Preferências</h2><div class="settings-grid">${sel("Idioma", "idioma", [["pt-BR", "Português (Brasil)"]], data.idioma)}${sel("Moeda", "moeda", [["BRL", "BRL — Real brasileiro"], ["USD", "USD — Dólar americano"], ["EUR", "EUR — Euro"]], data.moeda)}${sel("Formato de data", "formato", [["dd/mm/aaaa", "dd/mm/aaaa"], ["mm/dd/aaaa", "mm/dd/aaaa"], ["aaaa-mm-dd", "aaaa-mm-dd"]], data.formato)}${sel("Fuso horário", "fuso", [["America/Sao_Paulo", "Brasília (UTC−3)"], ["America/Manaus", "Manaus (UTC−4)"], ["America/Rio_Branco", "Rio Branco (UTC−5)"], ["America/Noronha", "Fernando de Noronha (UTC−2)"]], data.fuso)}</div><p class="note">A moeda e o fuso são preferências e não convertem valores ou horários automaticamente.</p></section>
      <section class="card"><h2>Notificações</h2><p class="note">Preferências para alertas dos módulos correspondentes.</p>${checkbox("novosEventos", "Novos eventos e propostas", "Avisos sobre novos cadastros e propostas.")}${checkbox("vencimentos", "Vencimentos financeiros", "Avisos sobre parcelas próximas ou em atraso.")}${checkbox("escalas", "Alterações de escala", "Avisos sobre equipe e disponibilidade.")}</section><div class="acts"><span id="settings-message" class="note" role="status"></span><button class="btn">Salvar configurações</button></div></form>`,
  );
}

function syncA11yControls() {
  document.querySelectorAll("[data-pref]").forEach((control) => {
    control.setAttribute("aria-checked", String(!!a11yPreferences[control.dataset.pref]));
  });
  document.querySelectorAll('input[name="a11ySize"]').forEach((radio) => {
    radio.checked = radio.value === a11yPreferences.tamanho;
  });
}
function accessibilityView() {
  const sizeOptions = [
    ["1", "100%"],
    ["1.25", "125%"],
    ["1.5", "150%"],
  ];
  const toggle = (key, title, description) =>
    `<div class="a11y-option"><div class="a11y-option-copy"><b id="a11y-label-${key}">${title}</b><small>${description}</small></div><button type="button" class="a11y-switch" role="switch" aria-checked="${a11yPreferences[key]}" aria-labelledby="a11y-label-${key}" data-act="toggleA11y" data-pref="${key}"></button></div>`;
  shell(
    "accessibility",
    "Acessibilidade",
    `<div class="a11y-layout"><aside class="card a11y-aside" aria-label="Informações de acessibilidade"><small class="eyebrow">PREFERÊNCIAS PESSOAIS</small><b>Privacidade</b><p>Estas preferências são aplicadas neste navegador e não alteram as configurações de outras pessoas.</p><span class="a11y-pill">Navegação por teclado ativa</span></aside><div class="a11y-content">
      <section class="card a11y-intro"><span class="a11y-mark" aria-hidden="true">Aa</span><div><h2>Preferências inclusivas</h2><p>Ajustes pessoais para leitura, navegação e compreensão da interface.</p></div></section>
      <section class="card a11y-section" aria-labelledby="a11y-reading"><h2 id="a11y-reading">Leitura e percepção</h2><p class="note">Ajustes visuais para facilitar a leitura sem remover informações.</p>
        <div class="a11y-option"><div class="a11y-option-copy"><b id="a11y-label-size">Tamanho do texto</b><small>Escolha uma escala confortável para a interface.</small></div><fieldset class="a11y-segmented" role="radiogroup" aria-labelledby="a11y-label-size"><legend class="sr-only">Tamanho do texto</legend>${sizeOptions.map(([value, label]) => `<label><input type="radio" name="a11ySize" value="${value}" ${a11yPreferences.tamanho === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</fieldset></div>
        ${toggle("contraste", "Contraste reforçado", "Aumenta o contraste de textos, bordas e controles.")}
        ${toggle("foco", "Foco sempre visível", "Destaca o elemento selecionado durante a navegação por teclado.")}
      </section>
      <section class="card a11y-section" aria-labelledby="a11y-interaction"><h2 id="a11y-interaction">Interação e movimento</h2><p class="note">Controle animações e mantenha mensagens claras.</p>
        ${toggle("animacoes", "Reduzir animações", "Remove transições e movimentos que não sejam essenciais.")}
        ${toggle("alertas", "Alertas visuais e por texto", "Mensagens também são anunciadas por leitores de tela e identificadas por texto.")}
        <div class="a11y-option"><div class="a11y-option-copy"><b>Navegação por teclado</b><small>Use Tab e Shift + Tab para percorrer os controles.</small></div><span class="a11y-pill">Ativa</span></div>
      </section>
      <section class="card a11y-section a11y-reader" aria-labelledby="a11y-readers"><div><h2 id="a11y-readers">Leitores de tela</h2><p class="note">Controles com rótulos descritivos e estados anunciados. A interface mantém indicadores além da cor.</p></div><span class="a11y-pill">Preparado</span></section>
      <div class="a11y-actions"><button type="button" class="btn ghost" data-act="restoreA11y">Restaurar padrão</button><span id="a11y-status" class="note" role="status" aria-live="polite"></span><button type="button" class="btn" data-act="saveA11y">Salvar preferências</button></div>
    </div></div><button type="button" class="a11y-fab" data-act="a11yShortcut" aria-label="Ir para as preferências de acessibilidade" title="Acessibilidade"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="m5 8 7 1.5L19 8M12 10v4.5M9 21l3-6.5 3 6.5"/></svg></button>`,
  );
}

// ---------- Agenda ----------
async function agendaView() {
  const { cur } = V,
    mode = innerWidth <= 800 && V.mode == "month" ? "list" : V.mode;
  let a, b;
  const f1 = new Date(cur.getFullYear(), cur.getMonth(), 1);
  if (mode == "week") {
    a = add(cur, -((cur.getDay() + 6) % 7));
    b = add(a, 6);
  } else if (mode == "month") {
    a = add(f1, -((f1.getDay() + 6) % 7));
    b = add(a, 41);
  } else {
    a = f1;
    b = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
  }
  const qs = new URLSearchParams({
    from: V.from && V.from > iso(a) ? V.from : iso(a),
    to: V.to && V.to < iso(b) ? V.to : iso(b),
  });
  if (V.q) qs.set("q", V.q);
  if (V.status) qs.set("status", V.status);
  const ev = await api("GET", "/events?" + qs),
    today = iso(new Date());
  const tm = (s) => (s ? +s.slice(0, 2) * 60 + +s.slice(3, 5) : null),
    en = (x) => tm(x.end_time) ?? tm(x.start_time) + 60,
    conf = new Set();
  ev.forEach((p) =>
    ev.forEach((q) => {
      if (
        p.id < q.id &&
        p.date &&
        p.date == q.date &&
        p.start_time &&
        q.start_time &&
        p.status != "cancelado" &&
        q.status != "cancelado" &&
        tm(p.start_time) < en(q) &&
        tm(q.start_time) < en(p)
      ) {
        conf.add(p.id);
        conf.add(q.id);
      }
    }),
  );
  const chip = (x) =>
    `<button class="chip s-${x.status}" data-act="open" data-id="${x.id}" title="${e(x.name)}${conf.has(x.id) ? " — conflito de horário" : ""}">${conf.has(x.id) ? "⚠ " : ""}${e(x.start_time || "")} ${e(x.name)}</button>`;
  const by = (d) => ev.filter((x) => x.date == d);
  let grid = "";
  const dn = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  if (mode == "month") {
    grid = `<div class="grid7">${dn.map((d) => `<div class="dh">${d}</div>`).join("")}${Array.from(
      { length: 42 },
      (_, i) => {
        const d = add(a, i),
          k = iso(d);
        return `<div class="day ${d.getMonth() != cur.getMonth() ? "dim" : ""} ${k == today ? "today" : ""}" data-act="newday" data-date="${k}"><b>${d.getDate()}</b>${by(k).map(chip).join("")}</div>`;
      },
    ).join("")}</div>`;
  } else if (mode == "week") {
    const days = Array.from({ length: 7 }, (_, i) => add(a, i)),
      rows = ["dia", ...Array.from({ length: 17 }, (_, i) => i + 7)];
    const hr = (x) =>
      x.start_time
        ? Math.min(23, Math.max(7, +x.start_time.slice(0, 2)))
        : "dia";
    grid = `<div class="scroll"><div class="grid7 wk"><div class="dh"></div>${days.map((d, i) => `<div class="dh">${dn[i]} ${d.getDate()}</div>`).join("")}${rows
      .map(
        (h) =>
          `<div class="tl">${h == "dia" ? "Sem hora" : String(h).padStart(2, "0") + ":00"}</div>${days
            .map((d) => {
              const k = iso(d);
              return `<div class="slot" data-act="newday" data-date="${k}" ${h == "dia" ? "" : `data-time="${String(h).padStart(2, "0")}:00"`}>${by(
                k,
              )
                .filter((x) => hr(x) == h)
                .map(chip)
                .join("")}</div>`;
            })
            .join("")}`,
      )
      .join("")}</div></div>`;
  } else {
    grid = ev.length
      ? `<div class="list">${groupDays(ev)}</div>`
      : '<div class="empty note"><div><b>Nenhum evento neste período</b>Use "Novo evento" ou clique em um dia para criar um compromisso.</div></div>';
  }
  const title = mode == "week" ? `${fmt(iso(a))} – ${fmt(iso(b))}` : mes(cur);
  shell(
    "agenda",
    title,
    `<div class="bar"><button class="btn ghost" data-act="nav" data-n="-1">‹</button><button class="btn ghost" data-act="today">Hoje</button><button class="btn ghost" data-act="nav" data-n="1">›</button>${sel(
      "",
      "mode",
      [
        ["month", "Mês"],
        ["week", "Semana"],
        ["list", "Lista"],
      ],
      mode,
      'data-o="V" data-k="mode" style="width:auto"',
    )}${V.q || V.status || V.from || V.to ? '<button class="btn ghost" data-act="clearf">Limpar filtros</button>' : ""}<input type="date" data-o="V" data-k="from" value="${e(V.from)}" aria-label="Data inicial"><input type="date" data-o="V" data-k="to" value="${e(V.to)}" aria-label="Data final"><input data-o="V" data-k="q" placeholder="Buscar evento, cliente ou local" value="${e(V.q)}">${sel("", "status", statusOpts, V.status, 'data-o="V" data-k="status" style="width:auto"')}</div>${grid}`,
    `<a class="btn" href="#/event/new">+ Novo evento</a>`,
  );
}
const evRow = (x) =>
  `<div class="card item" data-act="open" data-id="${x.id}"><div><h3>${e(x.name)}</h3><small>${e(x.client_name || "Sem cliente")} · ${fmt(x.date)} ${e(x.start_time || "")} · ${e(x.venue || "Local a definir")}${x.city ? ", " + e(x.city) : ""}${x.lineup ? " · " + e(x.lineup) : ""}</small></div>${badge(x.status)}</div>`;

// ---------- Eventos ----------
const DOW = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const groupDays = (ev) => {
  let last = "";
  return ev
    .map((x) => {
      const h =
        x.date != last
          ? ((last = x.date),
            `<h4 class="dayh">${x.date ? pd(x.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).toUpperCase() + " · " + DOW[pd(x.date).getDay()] + (x.date == iso(new Date()) ? " · Hoje" : "") : "SEM DATA"}</h4>`)
          : "";
      return h + evRow(x);
    })
    .join("");
};
async function eventsView() {
  const qs = new URLSearchParams(
    Object.entries(E).filter(([k, v]) => v && k != "page"),
  );
  const [ev, o] = await Promise.all([
    api("GET", "/events?" + qs),
    api("GET", "/overview"),
  ]);
  const n = (s) => o.byStatus.find((x) => x.status == s)?.n || 0,
    per = 8,
    pages = Math.max(1, Math.ceil(ev.length / per)),
    pg = Math.min(E.page || 1, pages),
    rows = ev.slice((pg - 1) * per, pg * per);
  const box = (l, v, s) =>
    `<div class="card stat"><small>${l}</small><h2>${v}</h2><span class="note">${s}</span></div>`;
  shell(
    "events",
    "Eventos",
    `<div class="cards">${box("EVENTOS CONFIRMADOS", n("confirmado"), "no total")}${box("PROPOSTAS PENDENTES", n("pendente"), "aguardando retorno")}${box("EM PREPARAÇÃO", n("preparacao"), "em andamento")}</div><div class="bar" style="margin-top:16px"><input data-o="E" data-k="q" placeholder="Buscar por evento, cliente ou local..." value="${e(E.q)}">${sel("", "s", statusOpts, E.status, 'data-o="E" data-k="status" aria-label="Status"')}<input type="date" data-o="E" data-k="from" value="${e(E.from)}" aria-label="Data inicial"><input type="date" data-o="E" data-k="to" value="${e(E.to)}" aria-label="Data final">${E.q || E.status || E.from || E.to ? '<button class="btn ghost" data-act="cleare">Limpar filtros</button>' : ""}<a class="btn ghost" href="#/agenda">Calendário</a></div><div class="card"><div class="between"><h3>Lista de eventos</h3><span class="note">${ev.length} evento(s)</span></div><div class="scroll"><table class="tbl"><thead><tr><th>Evento / cliente</th><th>Data</th><th>Local</th><th>Formação</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map((x) => `<tr><td><b>${e(x.name)}</b><br><small>${e(x.client_name || "Sem cliente")}</small></td><td>${fmt(x.date)}<br><small>${e(x.start_time || "")}</small></td><td>${e(x.venue || "—")}<br><small>${e(x.city || "")}</small></td><td>${e(x.lineup || "—")}</td><td>${badge(x.status)}</td><td class="nw"><a class="link" href="#/event/${x.id}">Ver</a> · <a class="link" href="#/event/${x.id}/edit">Editar</a> · <button class="link" data-act="delevent" data-id="${x.id}">Excluir</button></td></tr>`).join("") || '<tr><td colspan="6"><div class="empty note"><div><b>Nenhum evento encontrado</b>Ajuste os filtros ou use "Novo evento" para começar.</div></div></td></tr>'}</tbody></table></div><div class="between"><span class="note">Exibindo ${rows.length ? (pg - 1) * per + 1 : 0}–${(pg - 1) * per + rows.length} de ${ev.length}</span><div class="acts">${Array.from({ length: pages }, (_, i) => `<button class="btn ${i + 1 == pg ? "" : "ghost"}" data-act="page" data-p="${i + 1}" aria-label="Página ${i + 1}">${i + 1}</button>`).join("")}</div></div></div>`,
    '<a class="btn" href="#/event/new">+ Novo evento</a>',
  );
}
const MOM = [
  ["entrada", "Entrada"],
  ["assinaturas", "Assinaturas"],
  ["saida", "Saída"],
  ["coquetel", "Coquetel"],
  ["outro", "Outro"],
];
const money = (v) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ini = (n) =>
  String(n)
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
const KEYS = [
  "name",
  "type",
  "date",
  "start_time",
  "end_time",
  "client_id",
  "contact",
  "venue",
  "city",
  "lineup",
  "attire",
  "crew_arrival",
  "venue_contact",
  "contract_value",
];
const pct = (d) =>
  Math.round(
    ((KEYS.filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== "")
      .length +
      (d.repertoire?.some((r) => r.title?.trim()) ? 1 : 0)) /
      (KEYS.length + 1)) *
      100,
  );
let W = null;
async function eventRoute(s, q) {
  if (s[1] == "new") {
    W = {
      id: null,
      step: 1,
      d: {
        date: q.get("date") || "",
        start_time: q.get("time") || "",
        status: "rascunho",
        repertoire: [],
      },
    };
    return wizard();
  }
  const x = await api("GET", "/events/" + s[1]).catch(() => null);
  if (!x) {
    toast("Evento não encontrado.", 1);
    return (location.hash = "#/events");
  }
  if (s[2] == "edit") {
    W = { id: x.id, step: 1, d: x };
    return wizard();
  }
  detail(x);
}
function detail(x) {
  const t = (l, v) =>
    `<div><small class="lbl">${l}</small><p>${e(v || "—")}</p></div>`;
  const hr = x.start_time
    ? x.start_time + (x.end_time ? " - " + x.end_time : "")
    : "—";
  const reps = MOM.map(([k, l]) => [
    l,
    x.repertoire.filter((r) => r.moment == k),
  ]).filter((g) => g[1].length);
  const place = [x.venue, x.city, x.uf].filter(Boolean).join(", ");
  shell(
    "events",
    "Detalhes do evento",
    `<a href="#/agenda" class="back">← Voltar para a agenda</a>
<div class="card hero"><div class="hero-top"><div><h2>${e(x.name)}</h2><p class="note">${e(x.type || "Tipo não informado")}</p></div>${badge(x.status)}</div><div class="three">${t("Data", fmt(x.date))}${t("Horário", hr)}${t("Local", [x.venue, x.city].filter(Boolean).join(", "))}</div></div>
<div class="cols"><div>
<div class="card"><h3>Operacional</h3><div class="two">${t("Formação", x.lineup)}${t("Traje", x.attire)}${t("Chegada da equipe", x.crew_arrival)}${t("Contato no local", x.venue_contact)}${t("Cliente", x.client_name)}${t("Contato principal", x.contact)}</div></div>
<div class="card"><h3>Repertório aprovado</h3>${reps.length ? reps.map(([l, rs]) => rs.map((r, i) => `<div class="rep"><b>${i ? "" : l}</b><div><p>${e(r.title)}</p><small>${e([r.performer, r.notes].filter(Boolean).join(" · "))}</small></div></div>`).join("")).join("") : '<p class="note">Nenhuma música cadastrada.</p>'}</div>
</div><div>
<div class="card"><h3>Observações críticas</h3><p>${e(x.critical_notes || "Nenhuma observação crítica.")}</p>${x.notes ? `<p class="note">${e(x.notes)}</p>` : ""}</div>
<div class="card"><h3>Localização</h3><p>${e(place || "Local não informado")}</p>${x.venue ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}">Abrir no mapa</a>` : ""}</div>
<div class="card"><h3>Status</h3>${sel(
      "",
      "st",
      Object.entries(ST).filter(
        (k) => k[0] != "rascunho" || x.status == "rascunho",
      ),
      x.status,
      `data-chg="status" data-id="${x.id}" aria-label="Status do evento"`,
    )}${x.contract_value != null ? `<p class="note">Valor do contrato: ${money(x.contract_value)}</p>` : ""}</div>
</div></div>`,
    `<a class="btn" href="#/event/${x.id}/edit">Editar</a> <button class="btn danger" data-act="delevent" data-id="${x.id}">Excluir</button>`,
  );
}
async function wizard() {
  const d = W.d,
    n = W.step,
    cl = await api("GET", "/clients");
  d.repertoire ||= [];
  const sec = (t, b) => `<section class="card sec"><h3>${t}</h3>${b}</section>`;
  const names = [
    "Dados gerais",
    "Cliente e local",
    "Música e equipe",
    "Financeiro",
  ];
  const cn = cl.find((c) => c.id == d.client_id)?.name;
  const body = [
    sec(
      "Informações do evento",
      `${field("Nome do evento *", "name", d.name, "text", 'placeholder="Digite o nome do evento"')}<div class="row">${sel("Tipo de evento", "type", [["", "Selecione o tipo"], ...TIPOS.map((t) => [t, t])], d.type)}${field("Data *", "date", d.date, "date")}</div><div class="row">${field("Horário de início *", "start_time", d.start_time, "time")}${field("Horário final", "end_time", d.end_time, "time")}</div>`,
    ),
    sec(
      "Cliente e contato",
      `${sel("Cliente *", "client_id", [["", "Selecionar cliente"], ...cl.map((c) => [c.id, c.name])], d.client_id)}<p class="note"><a href="#/clients">Cadastrar novo cliente</a> (salve o rascunho antes)</p>${field("Contato principal", "contact", d.contact, "text", 'placeholder="Telefone ou e-mail"')}`,
    ) +
      sec(
        "Local e observações",
        `${field("Local *", "venue", d.venue, "text", 'placeholder="Nome do local"')}<div class="row">${field("Cidade", "city", d.city)}${field("UF", "uf", d.uf, "text", "maxlength=2")}</div><label>Observações<textarea name="notes" rows="3">${e(d.notes)}</textarea></label><label>Observações críticas<textarea name="critical_notes" rows="3" placeholder="Restrições de ruído, acesso, montagem...">${e(d.critical_notes)}</textarea></label>`,
      ),
    sec(
      "Música e equipe",
      `${field("Formação musical", "lineup", d.lineup, "text", 'placeholder="Ex.: Quarteto de cordas e harpa"')}<div class="row">${field("Traje", "attire", d.attire)}${field("Chegada da equipe", "crew_arrival", d.crew_arrival, "text", 'placeholder="Ex.: 14:30 (passagem de som)"')}</div>${field("Contato responsável no local", "venue_contact", d.venue_contact)}`,
    ) +
      sec(
        "Repertório por momento",
        `${d.repertoire.map((r, i) => `<div class="reprow"><select data-r="moment" aria-label="Momento">${MOM.map(([k, l]) => `<option value="${k}" ${r.moment == k ? "selected" : ""}>${l}</option>`).join("")}</select><input data-r="title" aria-label="Música" placeholder="Música" value="${e(r.title)}"><input data-r="performer" aria-label="Formação" placeholder="Formação" value="${e(r.performer)}"><input data-r="notes" aria-label="Observações" placeholder="Observações" value="${e(r.notes)}"><button type="button" class="btn ghost" data-act="delrep" data-i="${i}" aria-label="Remover música">✕</button></div>`).join("")}<button type="button" class="btn ghost" data-act="addrep">+ Adicionar música</button>`,
      ),
    sec(
      "Financeiro",
      `${field("Valor do contrato (R$)", "contract_value", d.contract_value, "number", 'min=0 step="0.01"')}<p class="note">Parcelas e recebimentos pertencem ao módulo Financeiro (em breve); aqui é salvo apenas o valor do contrato.</p>`,
    ) +
      sec(
        "Revisão",
        `<p><b>${e(d.name || "—")}</b> ${d.type ? "· " + e(d.type) : ""}</p><p>${fmt(d.date)} · ${e(d.start_time || "—")}${d.end_time ? " – " + e(d.end_time) : ""}</p><p>Cliente: ${e(cn || "—")} · Local: ${e(d.venue || "—")}</p><p>Formação: ${e(d.lineup || "—")} · ${d.repertoire.filter((r) => r.title?.trim()).length} música(s)</p>${
          W.id && d.status != "rascunho"
            ? sel(
                "Status",
                "status",
                Object.entries(ST).filter((k) => k[0] != "rascunho"),
                d.status,
              )
            : ""
        }`,
      ),
  ][n - 1];
  const p = pct(d);
  shell(
    "events",
    W.id ? "Editar evento" : "Cadastrar novo evento",
    `<div class="steps">${names.map((t, i) => `<span class="${i + 1 == n ? "on" : ""} ${i + 1 < n ? "done" : ""}"><i>${i + 1}</i>${t}</span>`).join("")}</div><div class="cols wz"><form data-form="wizard">${body}<div class="acts"><a class="btn ghost" href="#/events">Cancelar</a><span style="flex:1"></span>${n > 1 ? '<button type="button" class="btn ghost" data-act="prev">Voltar</button>' : ""}${!W.id || d.status == "rascunho" ? '<button type="button" class="btn rose" data-act="draft">Salvar rascunho</button>' : ""}<button class="btn">${n < 4 ? "Continuar" : "Salvar evento"}</button></div></form><aside><div class="card"><div class="between"><h3>Progresso do cadastro</h3><b>${p}%</b></div><div class="bar2"><i style="width:${p}%"></i></div><p class="note">Etapa ${n} de 4 • ${names[n - 1]}</p></div><div class="card"><h3>Etapas do cadastro</h3>${names.map((t, i) => `<p class="stp ${i + 1 == n ? "on" : ""}"><i>${i + 1}</i><span><b>${t}</b><br><small>${i + 1 < n ? "Concluída" : i + 1 == n ? "Em preenchimento" : "Pendente"}</small></span></p>`).join("")}</div><div class="card dark"><small>ANTES DE CONTINUAR</small><h3>Revise os dados principais</h3><p>As informações poderão ser revisadas antes da confirmação final do evento.</p></div></aside></div>`,
    badge(d.status || "rascunho"),
  );
}
const readForm = (f) => {
  Object.assign(W.d, Object.fromEntries(new FormData(f)));
  if (W.step == 3)
    W.d.repertoire = [...f.querySelectorAll(".reprow")].map((r) =>
      Object.fromEntries(
        [...r.querySelectorAll("[data-r]")].map((i) => [i.dataset.r, i.value]),
      ),
    );
};
async function saveEvent(status) {
  const d = W.d,
    btns = document.querySelectorAll("form[data-form=wizard] button");
  btns.forEach((b) => (b.disabled = true));
  const body = {
    ...d,
    status,
    repertoire: (d.repertoire || []).filter((r) => r.title?.trim()),
    contract_value:
      d.contract_value === "" || d.contract_value == null
        ? null
        : Number(String(d.contract_value).replace(",", ".")),
  };
  try {
    const x = W.id
      ? await api("PUT", "/events/" + W.id, body)
      : await api("POST", "/events", body);
    toast(status == "rascunho" ? "Rascunho salvo." : "Evento salvo.");
    location.hash = "#/event/" + x.id;
  } catch (x) {
    toast(errMsg(x), 1);
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------- Clientes ----------
async function clientsView() {
  const cl = await api(
    "GET",
    `/clients?q=${encodeURIComponent(C.q)}&sort=${C.sort}&status=${C.status || ""}`,
  );
  shell(
    "clients",
    "Clientes",
    `<div class="bar"><input data-o="C" data-k="q" placeholder="Buscar por nome, e-mail ou telefone" value="${e(C.q)}">${sel("", "f", [["", "Todos os clientes"], ["sem", "Sem eventos"], ...Object.entries(ST).filter((k) => k[0] != "rascunho")], C.status, 'data-o="C" data-k="status" aria-label="Filtrar clientes por status de evento"')}${sel(
      "",
      "sort",
      [
        ["name", "Nome (A–Z)"],
        ["recent", "Mais recentes"],
        ["events", "Mais eventos"],
      ],
      C.sort,
      'data-o="C" data-k="sort" style="width:auto"',
    )}</div><div class="cards client-grid">${cl.map((c) => `<article class="card client-card"><header class="client-top"><span class="client-avatar">${ini(c.name)}</span><div class="client-id"><h3>${e(c.name)}</h3><small>${e(c.ev_type || "Sem evento")}</small></div>${c.ev_status ? badge(c.ev_status) : ""}</header><ul class="client-info">${ciRow("cal", c.ev_date ? longDate(c.ev_date) : "")}${ciRow("pin", c.ev_venue)}${ciRow("phone", c.phone)}${ciRow("mail", c.email)}<li class="muted"><span>${c.n} evento(s)</span></li></ul>${c.notes ? `<p class="client-notes">${e(c.notes)}</p>` : ""}<div class="client-actions"><button type="button" data-act="editclient" data-c='${e(JSON.stringify(c))}' title="Editar" aria-label="Editar cliente ${e(c.name)}">✎</button><button type="button" data-act="delclient" data-id="${c.id}" title="Excluir" aria-label="Excluir cliente ${e(c.name)}">⌫</button></div></article>`).join("") || '<div class="empty note"><div><b>Nenhum cliente encontrado</b>Use o botão "Novo cliente" para começar.</div></div>'}</div><dialog id="dlg"></dialog>`,
    `<button class="btn" data-act="editclient" data-c="{}">+ Novo cliente</button>`,
  );
}

// ---------- Eventos de UI ----------
const A = {
  toggleA11y: (t) => {
    const key = t.dataset.pref;
    if (!Object.hasOwn(A11Y_DEFAULTS, key)) return;
    a11yPreferences[key] = !a11yPreferences[key];
    t.setAttribute("aria-checked", String(a11yPreferences[key]));
    applyA11yPreferences();
  },
  restoreA11y: () => {
    a11yPreferences = { ...A11Y_DEFAULTS };
    syncA11yControls();
    applyA11yPreferences();
    const status = $("#a11y-status");
    if (status) status.textContent = "Padrão restaurado. Salve para manter esta escolha.";
    toast("Padrão restaurado. Salve para manter esta escolha.");
  },
  saveA11y: () => {
    try {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(a11yPreferences));
      const status = $("#a11y-status");
      if (status) status.textContent = "Preferências salvas neste navegador.";
      toast("Preferências de acessibilidade salvas.");
    } catch {
      const status = $("#a11y-status");
      if (status) status.textContent = "Não foi possível salvar no navegador.";
      toast("Não foi possível salvar. Verifique as permissões do navegador.", 1);
    }
  },
  a11yShortcut: () => {
    const target = $(".a11y-intro");
    target?.scrollIntoView?.({
      behavior: a11yPreferences.animacoes ? "auto" : "smooth",
      block: "start",
    });
    $('input[name="a11ySize"]:checked')?.focus();
  },
  editmember: (t) => {
    const m = JSON.parse(t.dataset.c),
      d = $("#dlg");
    d.innerHTML = `<h3>${m.id ? "Editar" : "Novo"} cadastro</h3><form data-form="member"><input type="hidden" name="id" value="${m.id || ""}">${field("Nome completo *", "name", m.name, "text", "required")}${sel(
      "Função",
      "role",
      TEAM_ROLES.map((r) => [r, r]),
      m.role || "Músico",
    )}${field("Telefone *", "phone", m.phone, "tel", "required")}${sel(
      "Status",
      "status",
      [
        ["ativo", "Ativo"],
        ["inativo", "Inativo"],
      ],
      m.status || "ativo",
    )}<div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar</button></div></form>`;
    d.showModal();
  },
  delmember: async (t) => {
    if (!confirm("Deseja excluir este cadastro?")) return;
    try {
      await api("DELETE", "/team/" + t.dataset.id);
      toast("Cadastro excluído.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  editfin: async (t) => {
    const item = JSON.parse(t.dataset.f || "{}"),
      events = await api("GET", "/events"),
      d = $("#dlg");
    d.innerHTML = `<h3>${item.id ? "Editar" : "Novo"} lançamento</h3><form data-form="finance"><input type="hidden" name="id" value="${item.id || ""}">${field("Descrição *", "description", item.description || "", "text", "required maxlength=180")}<div class="row">${field("Valor (R$) *", "amount", item.amount ?? "", "number", 'required min="0.01" step="0.01"')}${sel("Evento vinculado", "event_id", [["", "Sem evento"], ...events.map((x) => [x.id, `${x.name}${x.date ? " · " + fmt(x.date) : ""}`])], item.event_id ?? "")}</div><div class="row">${field("Vencimento *", "due_date", item.due_date || "", "date", "required")}${field("Parcela", "installment", item.installment || "", "text", 'placeholder="Ex.: 2 de 4" maxlength=60')}</div><div class="row">${sel("Status", "status", Object.entries(FIN_ST), item.status || "pendente")}${field("Data do recebimento", "paid_date", item.paid_date || "", "date")}</div><p class="note">Para marcar como recebido, informe a data do recebimento.</p><div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar lançamento</button></div></form>`;
    d.showModal();
  },
  delfin: async (t) => {
    if (!confirm("Excluir este lançamento financeiro?")) return;
    try {
      await api("DELETE", "/finances/" + t.dataset.id);
      toast("Lançamento excluído.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  edituser: (t) => {
    const user = JSON.parse(t.dataset.u || "{}"), d = $("#dlg"), selected = new Set(user.permissions || []);
    const groups = ["users", "events", "clients", "finance", "team", "reports", "repertoire", "settings", "audit"];
    d.innerHTML = `<h3>Permissões de ${e(user.name)}</h3><form data-form="adminUser"><input type="hidden" name="id" value="${e(user.id)}">${field("Nome", "name", user.name, "text", "required maxlength=120")}${field("E-mail", "email", user.email, "email", "required maxlength=254")}${sel("Perfil", "role", [["collaborator", "Colaborador"], ["admin", "Administrador"]], user.role)}${sel("Status", "status", [["active", "Ativo"], ["disabled", "Desativado"], ["blocked", "Bloqueado"]], user.status)}<fieldset><legend>Permissões do colaborador</legend><p class="note">Permissões desmarcadas ficam negadas, mesmo quando fazem parte do perfil padrão.</p>${groups.map((group) => `<div class="permission-group"><b>${e(group === "users" ? "Colaboradores" : group === "team" ? "Equipe" : group === "finance" ? "Financeiro" : group === "audit" ? "Auditoria" : group === "reports" ? "Relatórios" : group === "repertoire" ? "Repertório" : group === "settings" ? "Configurações" : group === "clients" ? "Clientes" : "Eventos")}</b><div class="row">${Object.keys(permissionLabels).filter((permission) => permission.startsWith(group + ".")).map((permission) => `<label class="chk"><input type="checkbox" name="permission" value="${e(permission)}" ${selected.has(permission) ? "checked" : ""}> ${e(permissionLabels[permission])}</label>`).join("")}</div></div>`).join("")}</fieldset><div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar acesso</button></div></form>`;
    d.showModal();
  },
  auditview: async () => {
    try {
      const rows = await api("GET", "/admin/audit"), target = $("#admin-audit");
      target.hidden = false;
      target.innerHTML = `<h3>Auditoria da organização</h3><div class="scroll"><table class="tbl"><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Registro</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${new Date(row.created_at).toLocaleString("pt-BR")}</td><td>${e(row.actor_user_id)}</td><td>${e(row.action)}</td><td>${e(row.target_type)} ${e(row.target_id || "")}</td></tr>`).join("") || '<tr><td colspan="4">Nenhuma ação registrada.</td></tr>'}</tbody></table></div>`;
    } catch (x) { toast(errMsg(x), 1); }
  },
  export: async (t) => {
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(t.dataset.type)}/export`);
      if (!r.ok) throw await r.json().catch(() => ({ error: "Falha ao exportar relatório." }));
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `relatorio_${t.dataset.type}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },

  newRepSong: () => openRepSong({ evento: R.eventId, momento: "recepcao", ordem: 1 }),
  editRepSong: (t) => {
    const song = R.data.musicas.find((item) => String(item.id) === String(t.dataset.id));
    if (song && !song.legacy) openRepSong(song);
  },
  deleteRepSong: async (t) => {
    if (!confirm("Excluir esta música do repertório?")) return;
    await saveRepertoire({ ...R.data, musicas: R.data.musicas.filter((song) => song.legacy || String(song.id) !== String(t.dataset.id)) });
  },
  editRepDuration: (t) => {
    const moment = t.dataset.moment, key = repKey(R.eventId, moment), d = $("#dlg");
    d.innerHTML = `<h3>Duração de ${e(momentName(moment))}</h3><form data-form="repDuration"><input type="hidden" name="moment" value="${e(moment)}">${field("Duração aproximada em minutos *", "minutes", R.data.duracoes[key] || "", "number", 'required min="1" max="1440" step="1"') }<div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar</button></div></form>`;
    d.showModal();
  },
  editRepStatus: () => {
    const d = $("#dlg"), status = R.data.statusEventos[R.eventId] || "pendente";
    d.innerHTML = `<h3>Aprovação do repertório</h3><form data-form="repStatus"><div class="field"><label>Status</label><select name="status"><option value="pendente" ${status === "pendente" ? "selected" : ""}>Pendente</option><option value="aprovado" ${status === "aprovado" ? "selected" : ""}>Aprovado</option></select></div><div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar</button></div></form>`;
    d.showModal();
  },
  playRepSong: (t) => {
    const song = JSON.parse(t.dataset.song || "{}");
    let url;
    try { url = new URL(song.link); } catch { return toast("Referência inválida.", 1); }
    if (!["http:", "https:"].includes(url.protocol)) return toast("Referência inválida.", 1);
    const d = $("#rep-player"), content = $("#rep-player-content"), link = $("#rep-player-link");
    $("#rep-player-title").textContent = song.music || "Referência";
    content.replaceChildren();
    $("#rep-player-message").textContent = "A referência será aberta em uma nova aba quando o formato não puder ser reproduzido aqui.";
    link.href = url.href;
    const audio = /\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(url.pathname + url.search);
    const yt = url.hostname === "youtu.be" || url.hostname.endsWith("youtube.com");
    if (audio) {
      const player = document.createElement("audio"); player.controls = true; player.src = url.href; content.append(player);
      $("#rep-player-message").textContent = "";
    } else if (yt) {
      const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      if (id && /^[\w-]{6,20}$/.test(id)) {
        const frame = document.createElement("iframe"); frame.title = "Player de referência"; frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`; frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"; frame.allowFullscreen = true; content.append(frame);
        $("#rep-player-message").textContent = "";
      }
    }
    d.showModal();
  },
  closeRepPlayer: () => $("#rep-player").close(),

  addrep: (t) => {
    readForm(t.closest("form"));
    W.d.repertoire.push({ moment: "entrada", title: "" });
    wizard();
  },
  delrep: (t) => {
    readForm(t.closest("form"));
    W.d.repertoire.splice(+t.dataset.i, 1);
    wizard();
  },
  clearf: () => {
    Object.assign(V, { q: "", status: "", from: "", to: "" });
    route();
  },
  cleare: () => {
    Object.assign(E, { q: "", status: "", from: "", to: "", page: 1 });
    route();
  },
  clearfin: () => {
    Object.assign(F, { q: "", status: "", from: "", to: "" });
    route();
  },
  page: (t) => {
    E.page = +t.dataset.p;
    route();
  },
  showpw: (t) => {
    const i = t.previousElementSibling;
    i.type = i.type == "password" ? "text" : "password";
    t.setAttribute(
      "aria-label",
      i.type == "password" ? "Mostrar senha" : "Ocultar senha",
    );
  },
  logout: async () => {
    await api("POST", "/auth/logout");
    location.hash = "#/login";
    route();
  },
  open: (t) => (location.hash = "#/event/" + t.dataset.id),
  newday: (t) =>
    (location.hash = `#/event/new?date=${t.dataset.date}${t.dataset.time ? "&time=" + t.dataset.time : ""}`),
  nav: (t) => {
    const n = +t.dataset.n,
      c = V.cur;
    V.cur =
      V.mode == "week"
        ? add(c, 7 * n)
        : new Date(c.getFullYear(), c.getMonth() + n, 1);
    route();
  },
  today: () => {
    V.cur = new Date();
    route();
  },
  prev: (t) => {
    readForm(t.closest("form"));
    W.step--;
    wizard();
  },
  draft: (t) => {
    readForm(t.closest("form"));
    saveEvent("rascunho");
  },
  delevent: async (t) => {
    if (confirm("Excluir este evento? Esta ação não pode ser desfeita.")) {
      await api("DELETE", "/events/" + t.dataset.id);
      toast("Evento excluído.");
      if (location.hash == "#/events") return route();
      location.hash = "#/events";
    }
  },
  delclient: async (t) => {
    if (!confirm("Excluir este cliente?")) return;
    try {
      await api("DELETE", "/clients/" + t.dataset.id);
      toast("Cliente excluído.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  editclient: (t) => {
    const c = JSON.parse(t.dataset.c),
      d = $("#dlg");
    d.innerHTML = `<h3>${c.id ? "Editar" : "Novo"} cliente</h3><form data-form="client"><input type="hidden" name="id" value="${c.id || ""}">${field("Nome *", "name", c.name)}${field("E-mail", "email", c.email, "email")}${field("Telefone", "phone", c.phone, "tel")}<label>Observações<textarea name="notes" rows="3">${e(c.notes)}</textarea></label><div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar</button></div></form>`;
    d.showModal();
  },
};
const FORMS = {
  invite: async (f) => {
    const data = Object.fromEntries(new FormData(f));
    try {
      await api("POST", "/admin/invitations", data);
      toast("Convite enviado.");
      f.reset();
      await adminView();
    } catch (x) { toast(errMsg(x), 1); }
  },
  acceptInvite: async (f) => {
    try {
      await api("POST", "/invitations/accept", Object.fromEntries(new FormData(f)));
      toast("Conta ativada. Entre com seu e-mail e senha.");
      location.hash = "#/login";
      route();
    } catch (x) {
      $("#msg").textContent = errMsg(x);
    }
  },
  adminUser: async (f) => {
    const data = Object.fromEntries(new FormData(f));
    data.permissions = [...f.querySelectorAll('input[name="permission"]:checked')].map((input) => input.value);
    try {
      await api("PATCH", "/admin/users/" + encodeURIComponent(data.id), data);
      $("#dlg")?.close();
      toast("Acesso do colaborador atualizado.");
      await adminView();
    } catch (x) { toast(errMsg(x), 1); }
  },
  repSong: async (f) => {
    const form = Object.fromEntries(new FormData(f));
    const id = form.id;
    const song = {
      id: id ? Number(id) : null,
      evento: form.evento,
      momento: form.momento,
      ordem: Number(form.ordem),
      music: form.music.trim(),
      art: form.art.trim(),
      compo: form.compo.trim(),
      instru: form.instru.trim(),
      obs: form.obs.trim(),
      link: form.link.trim(),
      legacy: false,
    };
    const songs = R.data.musicas.filter((item) => item.legacy || String(item.id) !== String(id));
    try {
      await saveRepertoire({ ...R.data, musicas: [...songs, song] });
      $("#dlg")?.close();
    } catch (x) { toast(errMsg(x), 1); }
  },
  repDuration: async (f) => {
    const form = Object.fromEntries(new FormData(f));
    const duracoes = { ...R.data.duracoes, [repKey(R.eventId, form.moment)]: Number(form.minutes) };
    if (!Number.isInteger(Number(form.minutes)) || Number(form.minutes) < 1) return toast("Informe uma duração válida.", 1);
    await saveRepertoire({ ...R.data, duracoes });
    $("#dlg")?.close();
  },
  repStatus: async (f) => {
    const { status } = Object.fromEntries(new FormData(f));
    await saveRepertoire({ ...R.data, statusEventos: { ...R.data.statusEventos, [R.eventId]: status } });
    $("#dlg")?.close();
  },
  settings: async (f) => {
    const form = Object.fromEntries(new FormData(f));
    for (const key of ["novosEventos", "vencimentos", "escalas"]) form[key] = f.elements.namedItem(key).checked;
    try {
      await api("PUT", "/configuracoes", form);
      const status = $("#settings-message");
      if (status) status.textContent = "Configurações salvas.";
      toast("Configurações salvas.");
    } catch (x) { toast(errMsg(x), 1); }
  },
  finance: async (f) => {
    const d = Object.fromEntries(new FormData(f)),
      id = d.id;
    d.amount = Number(String(d.amount).replace(",", "."));
    d.event_id = d.event_id || null;
    d.paid_date = d.paid_date || null;
    try {
      await api(id ? "PUT" : "POST", "/finances" + (id ? "/" + id : ""), d);
      toast("Lançamento salvo.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  member: async (f) => {
    const d = Object.fromEntries(new FormData(f));
    try {
      await api(d.id ? "PUT" : "POST", "/team" + (d.id ? "/" + d.id : ""), d);
      toast("Cadastro salvo com sucesso.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },

  profile: async (f) => {
    try {
      await api("PUT", "/account", Object.fromEntries(new FormData(f)));
      toast("Dados atualizados.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  password: async (f) => {
    try {
      await api(
        "PUT",
        "/account/password",
        Object.fromEntries(new FormData(f)),
      );
      toast("Senha alterada.");
      f.reset();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
  login: async (f) => {
    const d = Object.fromEntries(new FormData(f));
    d.remember = !!d.remember;
    try {
      await api("POST", "/auth/login", d);
      location.hash = "#/overview";
      route();
    } catch (x) {
      $("#msg").textContent = errMsg(x);
    }
  },
  forgot: async (f) => {
    try {
      const r = await api(
        "POST",
        "/auth/forgot",
        Object.fromEntries(new FormData(f)),
      );
      $("#msg").textContent = r.message;
    } catch (x) {
      $("#msg").textContent = errMsg(x);
    }
  },
  reset: async (f) => {
    try {
      await api("POST", "/auth/reset", Object.fromEntries(new FormData(f)));
      toast("Senha redefinida. Faça login.");
      location.hash = "#/login";
    } catch (x) {
      $("#msg").textContent = errMsg(x);
    }
  },
  wizard: async (f) => {
    readForm(f);
    const need =
      {
        1: [
          ["name", "o nome"],
          ["date", "a data"],
          ["start_time", "o horário"],
        ],
        2: [
          ["client_id", "o cliente"],
          ["venue", "o local"],
        ],
      }[W.step] || [];
    const miss = need.find(([k]) => !W.d[k]);
    if (miss) return toast(`Informe ${miss[1]}.`, 1);
    if (W.step < 4) {
      W.step++;
      return wizard();
    }
    await saveEvent(
      W.d.status && W.d.status != "rascunho" ? W.d.status : "pendente",
    );
  },
  client: async (f) => {
    const d = Object.fromEntries(new FormData(f)),
      id = d.id;
    try {
      await api(id ? "PUT" : "POST", "/clients" + (id ? "/" + id : ""), d);
      toast("Cliente salvo.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
    }
  },
};
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-act]");
  if (t) A[t.dataset.act]?.(t, ev);
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("[data-form]");
  if (f) {
    ev.preventDefault();
    FORMS[f.dataset.form]?.(f);
  }
});
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.name === "a11ySize" && t.checked) {
    a11yPreferences.tamanho = ["1", "1.25", "1.5"].includes(t.value)
      ? t.value
      : "1";
    applyA11yPreferences();
  }
  if (t.dataset.o) {
    O[t.dataset.o][t.dataset.k] = t.value;
    E.page = 1;
    route();
  }
  if (t.dataset.chg == "status") {
    try {
      await api("PATCH", `/events/${t.dataset.id}/status`, { status: t.value });
      toast("Status atualizado.");
      route();
    } catch (x) {
      toast(errMsg(x), 1);
      route();
    }
  }
});
