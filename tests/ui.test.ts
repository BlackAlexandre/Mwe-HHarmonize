import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { testDatabaseConfigured, prepareTestDatabase, cleanTestDatabase } from "./postgres-test.js";
const test = (name: string, fn: (...args: any[]) => any) => nodeTest(name, { skip: !testDatabaseConfigured }, fn as any);

const P = 3919,
  B = `http://localhost:${P}`;
let srv: any,
  dom: JSDOM,
  jar = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => any, label: string) => {
  for (let t = 0; t < 5000; t += 50) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error("timeout: " + label);
};
const $ = (s: string) => dom.window.document.querySelector(s) as any;
const $$ = (s: string) => [...dom.window.document.querySelectorAll(s)] as any[];
const go = (h: string) => {
  dom.window.location.hash = h;
};
const fill = (n: string, v: string) => {
  $(`[name=${n}]`).value = v;
};
const change = (sel: string, v: string) => {
  const el = $(sel);
  el.value = v;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
};
const submit = (sel: string) =>
  $(sel).dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
const api = (m: string, u: string, b?: any) =>
  (dom.window as any)
    .fetch(u, {
      method: m,
      headers: { "Content-Type": "application/json" },
      body: b ? JSON.stringify(b) : undefined,
    })
    .then((r: any) => r.json());
const now = new Date(),
  ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

before(async () => {
  if (!testDatabaseConfigured) return;
  await prepareTestDatabase();
  srv = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(P),
      DATABASE_URL: process.env.MWE_TEST_DATABASE_URL,
      ADMIN_EMAIL: "ui@t.com",
      ADMIN_PASSWORD: "senha-forte-1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(B + "/api/auth/me");
      break;
    } catch {
      await sleep(200);
    }
  }
  dom = new JSDOM(
    `<div id="app"></div><script>${readFileSync("public/app.js", "utf8")}</script>`,
    {
      url: B + "/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(w: any) {
        w.confirm = () => true;
        w.fetch = async (u: string, o: any = {}) => {
          const r = await fetch(
            new URL(u.startsWith("/") && !u.startsWith("/api") ? u : u, B),
            { ...o, headers: { ...o.headers, cookie: jar } },
          );
          const sc = r.headers.get("set-cookie");
          if (sc) jar = sc.startsWith("sid=;") ? "" : sc.split(";")[0];
          return r;
        };
      },
    },
  );
});
after(async () => {
  if (srv && srv.exitCode === null) await new Promise<void>((resolve) => { srv.once("exit", () => resolve()); srv.kill(); });
  if (testDatabaseConfigured) await cleanTestDatabase();
});

test("login em duas colunas, erro de credencial e entrada", async () => {
  await until(() => $("form[data-form=login]"), "login");
  assert.ok($(".brand"), "painel de marca do Figma");
  fill("email", "ui@t.com");
  fill("password", "errada");
  submit("form[data-form=login]");
  await until(() => /(inválidos|invÃ¡lidos)/i.test($("#msg")?.textContent || ""), "erro");
  fill("password", "senha-forte-1");
  $("[name=remember]").checked = true;
  submit("form[data-form=login]");
  await until(() => $(".side"), "shell após login");
  assert.ok($$(".side nav a").length >= 4);
});

let cid: number;
test("cadastro de evento em 4 etapas pela agenda (data e hora pré-preenchidas)", async () => {
  cid = (
    await api("POST", "/api/clients", { name: "Ana Souza", phone: "41999" })
  ).id;
  go(`#/agenda`);
  await until(() => $$(".day").length == 42, "grade mensal");
  $(`.day[data-date="${ym}-15"]`).click();
  await until(() => $("form[data-form=wizard]") && $("[name=date]"), "wizard");
  assert.equal($("[name=date]").value, `${ym}-15`);
  fill("name", "Casamento UI");
  fill("start_time", "19:00");
  fill("end_time", "22:00");
  fill("type", "Casamento");
  submit("form[data-form=wizard]");
  await until(() => $("[name=client_id]"), "etapa 2");
  fill("client_id", String(cid));
  fill("venue", "Palácio");
  fill("city", "Sintra");
  fill("uf", "PT");
  submit("form[data-form=wizard]");
  await until(() => $("[name=lineup]"), "etapa 3");
  $("[data-act=addrep]").click();
  await until(() => $(".reprow"), "linha de repertório");
  $(".reprow [data-r=title]").value = "Canon in D";
  fill("lineup", "Quarteto");
  submit("form[data-form=wizard]");
  await until(() => $("[name=contract_value]"), "etapa 4");
  fill("contract_value", "1500");
  submit("form[data-form=wizard]");
  await until(() => $(".hero"), "detalhes");
  const t = $("main").textContent;
  for (const s of [
    "Casamento UI",
    "Canon in D",
    "Palácio",
    "Quarteto",
    "Proposta",
    "19:00 - 22:00",
  ])
    assert.ok(t.includes(s), s);
});

test("agenda: mensal, semanal, lista, busca, filtros, limpar, conflito e detalhes", async () => {
  await api("POST", "/api/events", {
    name: "Ensaio sobreposto",
    date: `${ym}-15`,
    start_time: "20:00",
    client_id: cid,
    venue: "Sala",
    status: "confirmado",
  });
  go("#/agenda");
  await until(() => $$(".chip").length >= 2, "chips no mês");
  assert.ok(
    $$(".chip").every((c) => c.textContent.includes("⚠")),
    "conflito de horário destacado",
  );
  change("[data-k=mode]", "week");
  await until(() => $(".grid7.wk"), "semana");
  change("[data-k=mode]", "list");
  await until(() => $(".dayh") && $$(".item").length >= 2, "lista");
  change("[data-k=q]", "zzz");
  await until(() => !$(".item"), "busca sem resultado");
  $("[data-act=clearf]").click();
  await until(() => $$(".item").length >= 2, "filtros limpos");
  change("[data-k=from]", `${ym}-28`);
  await until(() => !$(".item"), "filtro por data");
  $("[data-act=clearf]").click();
  await until(() => $$(".item").length >= 2, "limpou período");
  $$(".item")
    .find((i) => i.textContent.includes("Casamento UI"))
    .click();
  await until(() => $(".hero"), "detalhes pela agenda");
  go("#/agenda");
  await until(() => $("[data-k=mode]"), "volta à agenda");
  change("[data-k=mode]", "month");
  await until(() => $$(".day").length == 42, "mês de novo");
});

test("eventos, clientes, conta, status e exclusão", async () => {
  go("#/events");
  await until(() => $("table.tbl tbody tr td b"), "tabela de eventos");
  assert.equal($$(".stat").length, 3);
  go("#/clients");
  await until(
    () => $$(".cards .card").some((c) => c.textContent.includes("Ana Souza")),
    "cartão do cliente",
  );
  assert.ok($("[data-k=status]"), "filtro de clientes");
  go("#/account");
  await until(() => $("form[data-form=password]"), "minha conta");
  const evs = await api("GET", "/api/events");
  go(`#/event/${evs[0].id}`);
  await until(() => $("[data-chg=status]"), "seletor de status");
  change("[data-chg=status]", "confirmado");
  await until(
    async () =>
      (await api("GET", "/api/events/" + evs[0].id)).status == "confirmado",
    "status salvo",
  ).catch(() => {});
  assert.equal(
    (await api("GET", "/api/events/" + evs[0].id)).status,
    "confirmado",
  );
  go("#/events");
  await until(
    () => $("table.tbl") && $("[data-act=delevent]"),
    "botão excluir na tabela",
  );
  const antes = $$("table.tbl tbody tr").length;
  $("[data-act=delevent]").click();
  await until(
    () =>
      $$("table.tbl tbody tr").length < antes ||
      $(".note")?.textContent.includes("Nenhum"),
    "linha removida",
  );
});

test("financeiro e relatórios: navegação atual, cadastro e indicadores", async () => {
  (dom.window as any).HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  (dom.window as any).HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  await api("POST", "/api/auth/login", {
    email: "ui@t.com",
    password: "senha-forte-1",
  });
  go("#/finances");
  await until(() => $(".finance-table") && $("[data-act=editfin]"), "financeiro");
  assert.ok($$(".side nav a").some((a) => a.textContent.includes("Financeiro")));
  assert.ok($$(".side nav a").some((a) => a.textContent.includes("Relatórios")));
  assert.ok($$(".side nav a").some((a) => a.textContent.includes("Equipe")));
  assert.ok(!$$(".soon").some((x) => /Financeiro|Relatórios/.test(x.textContent)));
  $(".top [data-act=editfin]").click();
  await until(() => $("form[data-form=finance]"), "formulário de lançamento");
  fill("description", "Entrada de sinal");
  fill("amount", "750");
  fill("due_date", "2027-05-20");
  fill("installment", "1 de 2");
  submit("form[data-form=finance]");
  await until(() => $(".finance-table")?.textContent.includes("Entrada de sinal"), "lançamento salvo");
  assert.ok($("main")?.textContent.includes("R$"));
  go("#/reports");
  await until(() => $("[data-act=export][data-type=events]"), "relatórios");
  assert.ok($("main")?.textContent.includes("Eventos por status"));
  assert.ok($("main")?.textContent.includes("Financeiro"));
  assert.ok($("[data-act=export][data-type=financial]"));
});

test("Repertório e Configurações: fluxo nativo, edição, exclusão e preferências", async () => {
  const ev = await api("POST", "/api/events", {
    name: "Evento Repertório UI", date: `${ym}-20`, start_time: "18:00", client_id: cid,
    venue: "Salão UI", status: "confirmado", repertoire: [{ moment: "entrada", title: "Legado UI" }],
  });
  assert.ok(ev.id, `evento de teste não criado: ${JSON.stringify(ev)}`);
  go("#/repertoire");
  await until(() => $("[data-act=newRepSong]"), "tela repertório");
  change("[name=eventId]", String(ev.id));
  await until(() => $(".rep-group"), "momento do repertório");
  assert.ok($(".rep-group"), `momento do repertório não renderizado: ${$("main")?.textContent}`);
  assert.ok($$(".side nav a").some((a) => a.textContent.includes("Repertório")));
  assert.ok(!$$(".soon").some((x) => x.textContent.includes("Repertório")));
  assert.ok($("main").textContent.includes("Legado UI"), "música antiga permanece visível");
  $("[data-act=newRepSong]").click();
  await until(() => $("form[data-form=repSong]"), "formulário de música");
  fill("evento", String(ev.id)); fill("momento", "noiva"); fill("ordem", "1");
  fill("music", "Nova pela interface"); fill("art", "Artista UI"); fill("compo", ""); fill("instru", ""); fill("obs", "Observação"); fill("link", "https://example.com/audio.mp3");
  submit("form[data-form=repSong]");
  await until(() => $("main").textContent.includes("Nova pela interface"), "música persistida");
  $("[data-act=editRepSong]").click();
  await until(() => $("form[data-form=repSong]") && $(`[name=music]`).value === "Nova pela interface", "edição preenchida");
  fill("music", "Música editada UI");
  submit("form[data-form=repSong]");
  await until(() => $("main").textContent.includes("Música editada UI"), "edição salva");
  $("[data-act=playRepSong]").click();
  await until(() => $("#rep-player audio"), "player de referência de áudio");
  $("[data-act=closeRepPlayer]").click();
  $("[data-moment=noiva] [data-act=editRepDuration]").click();
  await until(() => $("form[data-form=repDuration]"), "duração do momento");
  fill("minutes", "6"); submit("form[data-form=repDuration]");
  await until(() => $("[data-moment=noiva]")?.textContent.includes("6 min"), "duração salva");
  $("[data-act=editRepStatus]").click();
  await until(() => $("form[data-form=repStatus]"), "status approval");
  fill("status", "aprovado"); submit("form[data-form=repStatus]");
  await until(() => $("main").textContent.includes("Aprovado"), "aprovação salva");
  go("#/settings");
  await until(() => $("form[data-form=settings]"), "configurações");
  assert.ok($("main").textContent.includes("Sessão ativa"));
  fill("nome", "Empresa UI"); fill("exibicao", "Exibição UI"); fill("email", "corporativo@ui.com");
  fill("telefone", "41999990000"); fill("moeda", "BRL"); fill("formato", "aaaa-mm-dd");
  submit("form[data-form=settings]");
  await until(() => $("#settings-message")?.textContent.includes("salvas"), "preferências salvas");
  assert.equal((await api("GET", "/api/auth/me")).email, "ui@t.com", "e-mail de login preservado");
  go("#/repertoire");
  await until(() => $("[data-act=deleteRepSong]"), "repertório atualizado");
  dom.window.confirm = () => true;
  $("[data-act=deleteRepSong]").click();
  await until(() => !$("main").textContent.includes("Música editada UI"), "música removida");
});

test("acessibilidade: escala, preferências globais, persistência e restauração", async () => {
  go("#/accessibility");
  await until(() => $("[data-act=saveA11y]") && $("[data-pref=contraste]"), "preferências de acessibilidade");
  assert.equal($(".side nav a[aria-current=page]")?.textContent.trim(), "Acessibilidade");
  const scale = $('input[name="a11ySize"][value="1.25"]');
  scale.checked = true;
  scale.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(dom.window.document.documentElement.style.getPropertyValue("--a11y-scale"), "1.25");
  for (const key of ["contraste", "foco", "animacoes", "alertas"]) $(`[data-pref=${key}]`).click();
  assert.ok(dom.window.document.body.classList.contains("a11y-high-contrast"));
  assert.ok(dom.window.document.body.classList.contains("a11y-focus-always"));
  assert.ok(dom.window.document.body.classList.contains("a11y-reduce-motion"));
  assert.ok(dom.window.document.body.classList.contains("a11y-visual-alerts"));
  $("[data-act=saveA11y]").click();
  const stored = JSON.parse(dom.window.localStorage.getItem("mwe-acessibilidade"));
  assert.deepEqual(stored, { tamanho: "1.25", contraste: true, foco: true, animacoes: true, alertas: true });
  go("#/clients");
  await until(() => $(".side nav a[aria-current=page]")?.getAttribute("href") === "#/clients", "preferências mantidas entre telas");
  assert.ok(dom.window.document.body.classList.contains("a11y-high-contrast"));
  go("#/accessibility");
  await until(() => $("[data-pref=contraste]"), "retorno às preferências");
  assert.equal($('input[name="a11ySize"][value="1.25"]').checked, true);
  $("[data-act=restoreA11y]").click();
  assert.equal(dom.window.document.documentElement.style.getPropertyValue("--a11y-scale"), "1");
  assert.ok(!dom.window.document.body.classList.contains("a11y-high-contrast"));
  $("[data-act=saveA11y]").click();
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("mwe-acessibilidade")), { tamanho: "1", contraste: false, foco: false, animacoes: false, alertas: false });
});

test("equipe (Wesley): menu com ícones, cadastro, filtro, edição e exclusão com dados reais", async () => {
  (dom.window as any).HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  go("#/team");
  await until(
    () => $$(".tstat").length == 4 && $$(".side nav a img.mi").length >= 5,
    "equipe",
  );
  assert.equal($$(".tstat").length, 4);
  assert.ok(
    $$(".side nav a").some((a) => a.textContent.includes("Equipe")),
    "Equipe no menu",
  );
  assert.ok(
    !$$(".soon").some((s) => s.textContent.includes("Equipe")),
    "Equipe não é mais placeholder",
  );
  $(".top [data-act=editmember]").click();
  await until(() => $("form[data-form=member]"), "formulário");
  fill("name", "Marina Souza");
  fill("role", "Técnico");
  fill("phone", "(41) 98888-7777");
  submit("form[data-form=member]");
  await until(
    () =>
      $$("table.tbl tbody tr").some((r) =>
        r.textContent.includes("Marina Souza"),
      ),
    "linha criada",
  );
  assert.equal($$(".tstat strong")[0].textContent, "1");
  assert.equal($$(".tstat strong")[1].textContent, "1");
  change("[data-k=role]", "Mídia");
  await until(
    () =>
      $("table.tbl tbody").textContent.includes("Nenhum cadastro encontrado"),
    "filtro por função",
  );
  change("[data-k=role]", "");
  await until(
    () => $("table.tbl tbody").textContent.includes("Marina Souza"),
    "filtro limpo",
  );
  change("[data-k=q]", "zzz");
  await until(
    () =>
      $("table.tbl tbody").textContent.includes("Nenhum cadastro encontrado"),
    "busca",
  );
  change("[data-k=q]", "");
  await until(
    () => $("table.tbl tbody").textContent.includes("Marina Souza"),
    "busca limpa",
  );
  $("[data-act=editmember][aria-label^=Editar]").click();
  await until(
    () => $("form[data-form=member] [name=name]").value == "Marina Souza",
    "edição preenchida",
  );
  fill("status", "inativo");
  submit("form[data-form=member]");
  await until(
    () => $("table.tbl tbody .badge")?.textContent == "Inativo",
    "status atualizado",
  );
  assert.equal($$(".tstat strong")[3].textContent, "1");
  $("[data-act=delmember]").click();
  await until(
    () =>
      $("table.tbl tbody").textContent.includes("Nenhum cadastro encontrado"),
    "excluído",
  );
  for (const path of [
    "/icons/equipe.png",
    "/icons/evento.png",
    "/logo_icon.png",
  ]) {
    const r = await fetch(B + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get("content-type")!, /image\/png/);
  }
});
test("celular: mês vira lista agrupada por dia; logout volta ao login", async () => {
  await api("POST", "/api/events", {
    name: "Evento mobile",
    date: `${ym}-10`,
    start_time: "10:00",
    client_id: cid,
    venue: "Local",
    status: "pendente",
  });
  Object.defineProperty(dom.window, "innerWidth", {
    value: 500,
    configurable: true,
  });
  go("#/clients");
  await sleep(200);
  go("#/agenda");
  await until(() => $(".dayh") && !$(".grid7"), "lista no celular");
  assert.ok($(".tabbar"), "barra inferior");
  $("[data-act=logout]").click();
  await until(() => $("form[data-form=login]"), "logout");
  assert.equal((await dom.window.fetch("/api/events")).status, 401);
});

test("área de colaboradores aparece no shell para administrador", async () => {
  go("#/login");
  await until(() => $("form[data-form=login]"), "login de administrador");
  fill("email", "ui@t.com");
  fill("password", "senha-forte-1");
  submit("form[data-form=login]");
  await until(() => $("header.top h1")?.textContent === "Visão Geral", "entrada do administrador");
  go("#/admin");
  await until(() => $("main h3")?.textContent === "Convidar usuário", "formulário de convite");
  assert.ok($(".side nav a[href='#/admin']"), "item no menu lateral atual");
  assert.ok($("form[data-form=invite] input[name=email]"), "convite por nome/e-mail");
  const role = $("form[data-form=invite] select[name=role]");
  assert.deepEqual([...role.options].map((option: any) => [option.value, option.textContent]), [["admin", "Administrador"], ["collaborator", "Colaborador"]]);
  assert.equal(role.value, "collaborator", "convite começa com o perfil restrito");
  assert.ok($("table.tbl"), "lista de usuários da organização");
  assert.ok($("header.top h1")?.textContent === "Colaboradores", "cabeçalho Wesley preservado");
});
