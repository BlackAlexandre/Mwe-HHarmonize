import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { JSDOM } from "jsdom";

const P = 3919,
  B = `http://localhost:${P}`,
  DB = "/tmp/h-ui.db";
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
  rmSync(DB, { force: true });
  srv = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(P),
      DB_FILE: DB,
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
after(() => srv.kill());

test("login em duas colunas, erro de credencial e entrada", async () => {
  await until(() => $("form[data-form=login]"), "login");
  assert.ok($(".brand"), "painel de marca do Figma");
  fill("email", "ui@t.com");
  fill("password", "errada");
  submit("form[data-form=login]");
  await until(() => $("#msg")?.textContent.includes("inválidos"), "erro");
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
