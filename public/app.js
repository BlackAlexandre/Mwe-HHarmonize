const $ = (s) => document.querySelector(s),
  app = $("#app");
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
const mes = (d) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const toast = (m, err) => {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = m;
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
const badge = (s) => `<span class="badge s-${s}">${ST[s] || s}</span>`;
const statusOpts = [["", "Todos os status"], ...Object.entries(ST)];
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
  C = { q: "", sort: "recent", status: "" };
const O = { V, E, C };

const NAV = [
    ["overview", "Visão Geral"],
    ["agenda", "Agenda"],
    ["events", "Eventos"],
    ["clients", "Clientes"],
  ],
  SOON = ["Financeiro", "Equipe", "Repertório", "Relatórios"];
const shell = (page, title, body, actions = "") => {
  app.innerHTML = `<aside class="side"><div class="logo"><img class="brand-logo" src="logo.jpg" width="150" height="120" alt="Logo MWE Harmonize">MWE Harmonize<small>Gestão de Eventos Musicais</small></div><nav>${NAV.map(([k, l]) => `<a href="#/${k}" class="${k == page ? "on" : ""}">${l}</a>`).join("")}${SOON.map((l) => `<span class="soon" title="Módulo de outro integrante">${l}<small>em breve</small></span>`).join("")}</nav><a class="btn rose" href="#/event/new">Novo evento</a><div class="me"><a class="link" href="#/account">${e(me.name || me.email)}</a><button data-act="logout" class="link">Sair</button></div></aside><main><header class="top"><h1>${title}</h1><div>${actions}</div></header>${body}</main><nav class="tabbar" aria-label="Navegação principal">${[
    ["overview", "Início"],
    ["agenda", "Agenda"],
    ["events", "Eventos"],
    ["clients", "Clientes"],
  ]
    .map(
      ([k, l]) => `<a href="#/${k}" class="${k == page ? "on" : ""}">${l}</a>`,
    )
    .join("")}<a href="#/account">Conta</a></nav>`;
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
  if (!me)
    return s[0] == "reset"
      ? resetView(q.get("token"))
      : loginView(s[0] == "forgot");
  if (["login", "forgot", "reset"].includes(s[0]))
    return (location.hash = "#/overview");
  const f =
    {
      overview: overviewView,
      account: accountView,
      agenda: agendaView,
      events: eventsView,
      clients: clientsView,
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
    `<h2>Nova senha</h2><form data-form="reset"><input type="hidden" name="token" value="${e(t)}">${field("Nova senha (mín. 8 caracteres)", "password", "", "password", "required minlength=8")}<div id="msg" class="errtxt"></div><button class="btn">Redefinir</button></form>`,
  );

// ---------- Visão geral e conta ----------
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
    `<div class="row" style="align-items:start"><form class="card" data-form="profile"><h3>Dados de acesso</h3>${field("Nome", "name", me.name)}${field("E-mail", "email", me.email, "email")}<button class="btn">Salvar</button></form><form class="card" data-form="password"><h3>Alterar senha</h3>${field("Senha atual", "current", "", "password", 'autocomplete="current-password"')}${field("Nova senha (mín. 8 caracteres)", "password", "", "password", 'minlength=8 autocomplete="new-password"')}${field("Confirmar nova senha", "confirm", "", "password", 'autocomplete="new-password"')}<button class="btn">Alterar senha</button></form></div>`,
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
      : '<p class="note">Nenhum evento neste período.</p>';
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
    `<div class="cards">${box("EVENTOS CONFIRMADOS", n("confirmado"), "no total")}${box("PROPOSTAS PENDENTES", n("pendente"), "aguardando retorno")}${box("EM PREPARAÇÃO", n("preparacao"), "em andamento")}</div><div class="bar" style="margin-top:16px"><input data-o="E" data-k="q" placeholder="Buscar por evento, cliente ou local..." value="${e(E.q)}">${sel("", "s", statusOpts, E.status, 'data-o="E" data-k="status" aria-label="Status"')}<input type="date" data-o="E" data-k="from" value="${e(E.from)}" aria-label="Data inicial"><input type="date" data-o="E" data-k="to" value="${e(E.to)}" aria-label="Data final">${E.q || E.status || E.from || E.to ? '<button class="btn ghost" data-act="cleare">Limpar filtros</button>' : ""}<a class="btn ghost" href="#/agenda">Calendário</a></div><div class="card"><div class="between"><h3>Lista de eventos</h3><span class="note">${ev.length} evento(s)</span></div><div class="scroll"><table class="tbl"><thead><tr><th>Evento / cliente</th><th>Data</th><th>Local</th><th>Formação</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map((x) => `<tr><td><b>${e(x.name)}</b><br><small>${e(x.client_name || "Sem cliente")}</small></td><td>${fmt(x.date)}<br><small>${e(x.start_time || "")}</small></td><td>${e(x.venue || "—")}<br><small>${e(x.city || "")}</small></td><td>${e(x.lineup || "—")}</td><td>${badge(x.status)}</td><td class="nw"><a class="link" href="#/event/${x.id}">Ver</a> · <a class="link" href="#/event/${x.id}/edit">Editar</a> · <button class="link" data-act="delevent" data-id="${x.id}">Excluir</button></td></tr>`).join("") || '<tr><td colspan="6" class="note">Nenhum evento encontrado.</td></tr>'}</tbody></table></div><div class="between"><span class="note">Exibindo ${rows.length ? (pg - 1) * per + 1 : 0}–${(pg - 1) * per + rows.length} de ${ev.length}</span><div class="acts">${Array.from({ length: pages }, (_, i) => `<button class="btn ${i + 1 == pg ? "" : "ghost"}" data-act="page" data-p="${i + 1}" aria-label="Página ${i + 1}">${i + 1}</button>`).join("")}</div></div></div>`,
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
    .filter(Boolean)
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
    )}</div><div class="cards">${cl.map((c) => `<div class="card"><div class="chead"><span class="av">${ini(c.name)}</span><div><h3>${e(c.name)}</h3><small>${e(c.ev_type || "Sem evento")}</small></div>${c.ev_status ? badge(c.ev_status) : ""}</div><p class="note">${e(c.email || "Sem e-mail")}<br>${e(c.phone || "Sem telefone")}<br>${c.ev_date ? fmt(c.ev_date) + " · " + e(c.ev_venue || "Local a definir") + "<br>" : ""}${c.n} evento(s)</p>${c.notes ? `<p>${e(c.notes)}</p>` : ""}<div class="acts"><button class="btn ghost" data-act="editclient" data-c='${e(JSON.stringify(c))}'>Editar</button><button class="btn danger" data-act="delclient" data-id="${c.id}">Excluir</button></div></div>`).join("") || '<p class="note">Nenhum cliente encontrado.</p>'}</div><dialog id="dlg"></dialog>`,
    `<button class="btn" data-act="editclient" data-c="{}">+ Novo cliente</button>`,
  );
}

// ---------- Eventos de UI ----------
const A = {
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
    const r = await api(
      "POST",
      "/auth/forgot",
      Object.fromEntries(new FormData(f)),
    );
    $("#msg").textContent = r.message;
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
