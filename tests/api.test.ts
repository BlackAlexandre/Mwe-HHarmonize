import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, scryptSync } from "node:crypto";
import { testDatabaseConfigured, prepareTestDatabase, queryTestDatabase, cleanTestDatabase } from "./postgres-test.js";
const test = (name: string, fn: (...args: any[]) => any) => nodeTest(name, { skip: !testDatabaseConfigured }, fn as any);
const P = 3917,
  B = `http://localhost:${P}`,
  EMAIL_CAPTURE = "/tmp/h-brevo-capture.jsonl",
  EMAIL_FAIL = "/tmp/h-brevo-fail";
const mails = () => existsSync(EMAIL_CAPTURE)
  ? readFileSync(EMAIL_CAPTURE, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
let srv: any,
  ck = "",
  logs = "";
const call = async (m: string, u: string, b?: any, c = ck) => {
  const r = await fetch(B + u, {
    method: m,
    headers: { "content-type": "application/json", cookie: c },
    body: b && m !== "GET" ? JSON.stringify(b) : undefined,
  });
  const s = r.headers.get("set-cookie");
  if (s && u.includes("login")) ck = s.split(";")[0];
  return { s: r.status, j: await r.json(), h: s };
};
before(async () => {
  if (!testDatabaseConfigured) return;
  await prepareTestDatabase();
  rmSync(EMAIL_CAPTURE, { force: true });
  rmSync(EMAIL_FAIL, { force: true });
  srv = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/mock-brevo.ts", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(P),
      DATABASE_URL: process.env.MWE_TEST_DATABASE_URL,
      ADMIN_EMAIL: "a@t.com",
      ADMIN_PASSWORD: "senha-forte-1",
      NODE_ENV: "test",
      BREVO_API_KEY: "mock-brevo-key-for-tests",
      EMAIL_FROM: "MWE Test <no-reply@test.local>",
      APP_URL: B,
      BREVO_TEST_CAPTURE_FILE: EMAIL_CAPTURE,
      BREVO_TEST_FAIL_FILE: EMAIL_FAIL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", (d: any) => (logs += d));
  srv.stderr.on("data", (d: any) => (logs += d));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(B + "/api/auth/me");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});
after(async () => {
  if (srv && srv.exitCode === null) await new Promise<void>((resolve) => { srv.once("exit", () => resolve()); srv.kill(); });
  if (testDatabaseConfigured) await cleanTestDatabase();
});

test("rotas privadas exigem login", async () => {
  for (let attempt = 0; attempt < 20 && !logs.includes("Email configuration status"); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(logs, /BREVO_API_KEY: 'configurada'/);
  assert.match(logs, /EMAIL_FROM: 'configurado'/);
  assert.match(logs, /APP_URL: 'configurada'/);
  assert.equal(logs.includes("mock-brevo-key-for-tests"), false, "inicialização não registra a chave");
  for (const u of [
    "/api/events",
    "/api/clients",
    "/api/auth/me",
    "/api/account",
    "/api/overview",
    "/api/finances",
    "/api/reports/kpis",
    "/api/reports/events/export",
    "/api/repertorios",
    "/api/configuracoes",
  ])
    assert.equal((await call("GET", u, undefined, "")).s, 401);
  assert.equal((await call("PUT", "/api/repertorios", { musicas: [], duracoes: {}, statusEventos: {} }, "")).s, 401);
  assert.equal((await call("PUT", "/api/configuracoes", {}, "")).s, 401);
});
test('login inválido e válido (sessão e "permanecer conectado")', async () => {
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "a@t.com",
        password: "errada",
      })
    ).s,
    401,
  );
  const r = await call("POST", "/api/auth/login", {
    email: "a@t.com",
    password: "senha-forte-1",
    remember: true,
  });
  assert.equal(r.s, 200);
  assert.match(r.h!, /HttpOnly/);
  assert.match(r.h!, /Max-Age=/);
  assert.equal((await call("GET", "/api/auth/me")).s, 200);
  assert.equal("expires" in (await call("GET", "/api/auth/me")).j, false, "não expõe expiração interna da sessão");
});
test("segurança transversal: origem, limitação de tentativas, headers e auditoria sem segredos", async () => {
  const csrf = await fetch(B + "/api/account", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: ck, origin: "https://evil.example" },
    body: JSON.stringify({ name: "X", email: "x@example.com" }),
  });
  assert.equal(csrf.status, 403);
  const denied = await fetch(B + "/api/events", { headers: { cookie: ck } });
  assert.equal(denied.headers.get("x-content-type-options"), "nosniff");
  assert.equal(denied.headers.get("x-frame-options"), "DENY");
  assert.equal(denied.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  for (let i = 0; i < 10; i++)
    assert.equal((await call("POST", "/api/auth/login", { email: "rate-limit@example.test", password: "incorreta" })).s, 401);
  assert.equal((await call("POST", "/api/auth/login", { email: "rate-limit@example.test", password: "incorreta" })).s, 429);
  const audit = (await queryTestDatabase("SELECT action,target_type,target_id FROM security_audit ORDER BY id")).rows;
  assert.ok(audit.some((row) => row.action === "login.success"));
  assert.equal(JSON.stringify(audit).includes("a@t.com"), false);
  assert.equal(JSON.stringify(audit).includes("senha-forte-1"), false);
  const sessionToken = ck.split("=")[1];
  await queryTestDatabase("UPDATE sessions SET expires=? WHERE token=?", Date.now() - 1, createHash("sha256").update(sessionToken).digest("hex"));
  assert.equal((await call("GET", "/api/auth/me")).s, 401, "sessão expirada é rejeitada");
  assert.equal((await call("POST", "/api/auth/login", { email: "a@t.com", password: "senha-forte-1" })).s, 200);
});
let cid: number, eid: number;
test("clientes: CRUD, validação e busca", async () => {
  assert.equal((await call("POST", "/api/clients", { name: "" })).s, 422);
  const c = await call("POST", "/api/clients", {
    name: "Ana Souza",
    email: "ana@x.com",
    phone: "41999990000",
  });
  assert.equal(c.s, 201);
  cid = c.j.id;
  assert.equal(
    (
      await call("PUT", "/api/clients/" + cid, {
        name: "Ana S.",
        email: "ana@x.com",
        phone: "41999990000",
      })
    ).j.name,
    "Ana S.",
  );
  for (const q of ["4199999", "ana@x", "Ana S"])
    assert.equal((await call("GET", "/api/clients?q=" + q)).j.length, 1);
  assert.equal((await call("GET", "/api/clients?q=zzz")).j.length, 0);
});
test("eventos: rascunho, validação, CRUD, filtros e status", async () => {
  assert.equal(
    (await call("POST", "/api/events", { name: "Só rascunho" })).s,
    201,
  );
  assert.equal(
    (await call("POST", "/api/events", { name: "X", status: "pendente" })).s,
    422,
  );
  const r = await call("POST", "/api/events", {
    name: "Casamento Ana",
    type: "Casamento",
    date: "2026-11-15",
    start_time: "19:30",
    client_id: cid,
    venue: "Espaço Verde",
    city: "Curitiba",
    uf: "pr",
    status: "pendente",
  });
  assert.equal(r.s, 201);
  eid = r.j.id;
  assert.equal(r.j.uf, "PR");
  assert.equal(r.j.client_name, "Ana S.");
  assert.equal(
    (
      await call(
        "GET",
        "/api/events?q=Ana&status=pendente&from=2026-11-01&to=2026-11-30",
      )
    ).j.length,
    1,
  );
  assert.equal((await call("GET", "/api/events?from=2027-01-01")).j.length, 0);
  assert.equal(
    (await call("PUT", "/api/events/" + eid, { ...r.j, venue: "Novo Local" })).j
      .venue,
    "Novo Local",
  );
  assert.equal(
    (await call("PATCH", `/api/events/${eid}/status`, { status: "confirmado" }))
      .j.status,
    "confirmado",
  );
  assert.equal(
    (await call("PATCH", `/api/events/${eid}/status`, { status: "xx" })).s,
    422,
  );
});
test("repertório e configurações: CRUD, validação, preservação e compartilhamento na organização", async () => {
  const originalCookie = ck;
  const legacyEvent = await call("PUT", `/api/events/${eid}`, {
    name: "Casamento Ana", type: "Casamento", date: "2026-11-15", start_time: "19:30",
    client_id: cid, venue: "Novo Local", city: "Curitiba", uf: "PR", status: "confirmado",
    repertoire: [{ moment: "entrada", title: "Clássica antiga", performer: "Artista legado", notes: "não apagar" }],
  });
  assert.equal(legacyEvent.s, 200);
  const created = await call("PUT", "/api/repertorios", {
    musicas: [{ evento: String(eid), momento: "noiva", ordem: 1, music: "Canção nova", art: "Artista", compo: "Compositor", instru: "Voz e piano", obs: "Entrada", link: "https://youtu.be/abcdefghijk" }],
    duracoes: { [`${eid}|noiva`]: 5 }, statusEventos: { [eid]: "aprovado" },
  });
  assert.equal(created.s, 200);
  assert.equal(created.j.musicas.find((x: any) => x.music === "Canção nova").compo, "Compositor");
  assert.equal(created.j.musicas.find((x: any) => x.music === "Clássica antiga").legacy, true);
  const songId = created.j.musicas.find((x: any) => x.music === "Canção nova").id;
  const edited = await call("PUT", "/api/repertorios", {
    ...created.j,
    musicas: created.j.musicas.filter((x: any) => !x.legacy).map((x: any) => ({ ...x, music: "Canção revisada", instru: "Quarteto" })),
  });
  assert.equal(edited.j.musicas.find((x: any) => x.id === songId).music, "Canção revisada");
  assert.equal(edited.j.musicas.find((x: any) => x.music === "Clássica antiga").legacy, true);
  assert.equal((await call("PUT", "/api/repertorios", { musicas: [{ evento: String(eid), momento: "noiva", ordem: 0, music: "Invalida", art: "", compo: "", instru: "", link: "javascript:alert(1)" }], duracoes: {}, statusEventos: {} })).s, 422);
  assert.deepEqual((await call("GET", "/api/configuracoes")).j, {});
  const settings = await call("PUT", "/api/configuracoes", {
    nome: "MWE", exibicao: "MWE Eventos", email: "corporativo@mwe.com", telefone: "41999990000",
    idioma: "pt-BR", moeda: "BRL", formato: "dd/mm/aaaa", fuso: "America/Sao_Paulo",
    novosEventos: true, vencimentos: false, escalas: true,
  });
  assert.equal(settings.s, 200);
  assert.equal((await call("GET", "/api/auth/me")).j.email, "a@t.com", "e-mail corporativo não altera login");
  const salt = "second-account-salt";
  const otherEmail = "isolamento@t.com";
  const other = await queryTestDatabase("INSERT INTO users(email,name,hash) VALUES(?,?,?) RETURNING id", otherEmail, "Outra conta", `${salt}:${scryptSync("senha-forte-2", salt, 64).toString("hex")}`);
  const org = await queryTestDatabase("SELECT organization_id FROM organization_members WHERE user_id=1");
  await queryTestDatabase("INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(?,?,'collaborator','active')", other.rows[0].id, org.rows[0].organization_id);
  const second = await call("POST", "/api/auth/login", { email: otherEmail, password: "senha-forte-2" });
  assert.equal(second.s, 200);
  const secondCookie = second.h!.split(";")[0];
  assert.equal((await call("GET", "/api/configuracoes", undefined, secondCookie)).j.email, "corporativo@mwe.com");
  const secondRep = await call("GET", "/api/repertorios", undefined, secondCookie);
  assert.equal(secondRep.j.musicas.some((x: any) => x.music === "Canção revisada"), true);
  const unauthorizedEdit = await call("PUT", "/api/repertorios", {
    musicas: [{ ...edited.j.musicas.find((x: any) => x.id === songId), music: "Tentativa cruzada" }],
    duracoes: {}, statusEventos: {},
  }, secondCookie);
  assert.equal(unauthorizedEdit.s, 403);
  assert.equal((await call("GET", "/api/repertorios", undefined, originalCookie)).j.musicas.some((x: any) => x.music === "Canção revisada"), true);
  ck = originalCookie;
});
test("integridade: cliente com evento não pode ser excluído", async () => {
  assert.equal((await call("DELETE", "/api/clients/" + cid)).s, 409);
  assert.equal((await call("DELETE", "/api/events/" + eid)).s, 200);
  assert.equal((await call("GET", "/api/events/" + eid)).s, 404);
  const rest = (await call("GET", "/api/events?q=rascunho")).j;
  for (const x of rest) await call("DELETE", "/api/events/" + x.id);
  assert.equal((await call("DELETE", "/api/clients/" + cid)).s, 200);
});
test("recuperação de acesso e logout", async () => {
  const unknown = await call("POST", "/api/auth/forgot", { email: "ninguem@t.com" }, "");
  assert.equal(unknown.s, 200);
  assert.equal(mails().length, 0, "não envia e-mail para endereço inexistente");

  writeFileSync(EMAIL_FAIL, "fail");
  const rejected = await call("POST", "/api/auth/forgot", { email: "a@t.com" }, "");
  assert.equal(rejected.s, 200);
  assert.deepEqual(rejected.j, unknown.j, "falha do provedor não revela se o endereço existe");
  assert.equal((await queryTestDatabase("SELECT COUNT(*)::int n FROM resets")).rows[0].n, 0, "remove token não enviado");
  rmSync(EMAIL_FAIL, { force: true });

  const f = await call("POST", "/api/auth/forgot", { email: "a@t.com" }, "");
  assert.deepEqual(f.j, unknown.j, "resposta igual para conta cadastrada e inexistente");
  assert.equal(JSON.stringify(f.j).includes("mock-brevo-key-for-tests"), false);
  const sent = mails();
  assert.equal(sent.length, 2, "um envio rejeitado e um aceito; nenhum para endereço inexistente");
  assert.equal(sent[0].to[0].email, "a@t.com");
  assert.deepEqual(sent[1].sender, { name: "MWE Harmonize", email: "no-reply@test.local" });
  assert.match(sent[1].htmlContent, /http:\/\/localhost:3917\/#\/reset\?token=[0-9a-f]{64}/);
  const token = /token=([0-9a-f]{64})/.exec(sent[1].htmlContent)![1];
  assert.equal(logs.includes(token), false, "token de recuperação não aparece nos logs");
  assert.equal(logs.includes("mock-brevo-key-for-tests"), false, "chave da Brevo não aparece nos logs");
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  assert.equal((await queryTestDatabase("SELECT token FROM resets WHERE user_id=1")).rows[0].token, sha(token), "banco armazena apenas o hash");
  await queryTestDatabase("INSERT INTO resets VALUES(?,?,?)", sha("expirado"), 1, Date.now() - 1000);
  assert.equal(
    (
      await call(
        "POST",
        "/api/auth/reset",
        { token: "expirado", password: "qualquer-senha-1" },
        "",
      )
    ).s,
    400,
    "token expirado",
  );
  assert.equal(
    (
      await call(
        "POST",
        "/api/auth/reset",
        { token: "inexistente", password: "qualquer-senha-1" },
        "",
      )
    ).s,
    400,
    "token inválido",
  );
  assert.equal(
    (await call("POST", "/api/auth/reset", { token, password: "curta" }, "")).s,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/api/auth/reset",
        { token, password: "nova-senha-2" },
        "",
      )
    ).s,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/api/auth/reset",
        { token, password: "nova-senha-3" },
        "",
      )
    ).s,
    400,
  );
  assert.equal(
    (await call("GET", "/api/auth/me")).s,
    401,
    "sessões antigas são encerradas",
  );
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "a@t.com",
        password: "senha-forte-1",
      })
    ).s,
    401,
  );
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "a@t.com",
        password: "nova-senha-2",
      })
    ).s,
    200,
  );
  await call("POST", "/api/auth/logout");
  assert.equal((await call("GET", "/api/auth/me")).s, 401);
  assert.doesNotMatch(logs, new RegExp(token), "token de recuperação não aparece nos logs");
  assert.doesNotMatch(logs, /mock-brevo-key-for-tests/, "API key não aparece nos logs");
});

test("minha conta: dados, e-mail duplicado e senha", async () => {
  await call("POST", "/api/auth/login", {
    email: "a@t.com",
    password: "nova-senha-2",
  });
  await queryTestDatabase("INSERT INTO users(email,name,hash) VALUES(?,?,?)", "b@t.com", "B", "x:00");
  assert.equal(
    (await call("PUT", "/api/account", { name: "", email: "x" })).s,
    422,
  );
  assert.equal(
    (await call("PUT", "/api/account", { name: "Outro", email: "b@t.com" })).s,
    409,
  );
  assert.equal(
    (
      await call("PUT", "/api/account", {
        name: "Novo Nome",
        email: "NOVO@t.com",
      })
    ).j.email,
    "novo@t.com",
  );
  const pw = (b: any) => call("PUT", "/api/account/password", b);
  assert.equal(
    (
      await pw({
        current: "errada",
        password: "outra-senha-9",
        confirm: "outra-senha-9",
      })
    ).s,
    403,
  );
  assert.equal(
    (await pw({ current: "nova-senha-2", password: "curta", confirm: "curta" }))
      .s,
    422,
  );
  assert.equal(
    (
      await pw({
        current: "nova-senha-2",
        password: "outra-senha-9",
        confirm: "diferente",
      })
    ).s,
    422,
  );
  assert.equal(
    (
      await pw({
        current: "nova-senha-2",
        password: "outra-senha-9",
        confirm: "outra-senha-9",
      })
    ).s,
    200,
  );
  assert.equal(
    (await call("GET", "/api/auth/me")).s,
    200,
    "sessão atual continua válida",
  );
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "novo@t.com",
        password: "outra-senha-9",
      })
    ).s,
    200,
  );
});
test("erros: ids inexistentes, cliente inexistente, JSON inválido e visão geral", async () => {
  for (const [m, u] of [
    ["GET", "/api/events/99999"],
    ["PUT", "/api/events/99999"],
    ["PUT", "/api/clients/99999"],
    ["GET", "/api/rota-inexistente"],
  ])
    assert.equal((await call(m, u, { name: "X" })).s, 404, u);
  assert.equal(
    (await call("POST", "/api/events", { name: "X", client_id: 99999 })).s,
    422,
  );
  const r = await fetch(B + "/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ck },
    body: "{ruim",
  });
  assert.equal(r.status, 400);
  const o = await call("GET", "/api/overview");
  assert.equal(o.s, 200);
  assert.ok(Array.isArray(o.j.upcoming) && Array.isArray(o.j.byStatus));
});

test("evento completo: operacional, repertório por momento, status e vínculo", async () => {
  const c = await call("POST", "/api/clients", {
    name: "Cliente Op",
    phone: "11999",
  });
  const base = {
    name: "Gala",
    type: "Corporativo",
    date: "2026-12-10",
    start_time: "18:00",
    end_time: "22:00",
    client_id: c.j.id,
    venue: "Hotel",
    city: "SP",
    uf: "sp",
    attire: "Social",
    crew_arrival: "15:30",
    venue_contact: "Maria",
    critical_notes: "Ruído após 22h",
    contract_value: 12500.5,
    status: "preparacao",
    repertoire: [
      { moment: "entrada", title: "Canon in D", performer: "Quarteto" },
      { moment: "saida", title: "Marcha Nupcial" },
    ],
  };
  const r = await call("POST", "/api/events", base);
  assert.equal(r.s, 201);
  assert.equal(r.j.status, "preparacao");
  assert.equal(r.j.repertoire.length, 2);
  assert.equal(r.j.attire, "Social");
  assert.equal(r.j.contract_value, 12500.5);
  assert.equal(r.j.end_time, "22:00");
  assert.equal(
    (
      await call("POST", "/api/events", {
        ...base,
        repertoire: [{ moment: "x", title: "A" }],
      })
    ).s,
    422,
  );
  assert.equal(
    (await call("POST", "/api/events", { ...base, end_time: "25:00" })).s,
    422,
  );
  assert.equal(
    (await call("POST", "/api/events", { ...base, contract_value: -5 })).s,
    422,
  );
  const u = await call("PUT", "/api/events/" + r.j.id, {
    ...r.j,
    repertoire: [{ moment: "coquetel", title: "Fly Me to the Moon" }],
  });
  assert.deepEqual(
    u.j.repertoire.map((x: any) => x.title),
    ["Fly Me to the Moon"],
  );
  assert.equal(
    (await call("GET", "/api/events/" + r.j.id)).j.repertoire.length,
    1,
  );
  const cl = (await call("GET", "/api/clients?sort=recent")).j.find(
    (x: any) => x.id == c.j.id,
  );
  assert.equal(cl.ev_status, "preparacao");
  assert.equal((await call("DELETE", "/api/events/" + r.j.id)).s, 200);
  assert.equal(
    Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM repertoire")).rows[0].n),
    0,
    "repertório removido em cascata",
  );
});

test("manter conectado: cookie persistente só quando marcado; logout encerra a sessão", async () => {
  const a = await call("POST", "/api/auth/login", {
    email: "novo@t.com",
    password: "outra-senha-9",
  });
  assert.doesNotMatch(
    a.h!,
    /Max-Age=\d/,
    "sem marcar: cookie de sessão do navegador",
  );
  const b = await call("POST", "/api/auth/login", {
    email: "novo@t.com",
    password: "outra-senha-9",
    remember: true,
  });
  assert.match(b.h!, /Max-Age=2592000/);
  assert.match(b.h!, /HttpOnly/);
  const c = b.h!.split(";")[0];
  assert.equal((await call("GET", "/api/auth/me", undefined, c)).s, 200);
  await call("POST", "/api/auth/logout", undefined, c);
  assert.equal((await call("GET", "/api/auth/me", undefined, c)).s, 401);
});
test("duplicidade, filtros de período e filtro de clientes por status", async () => {
  await call("POST", "/api/auth/login", {
    email: "novo@t.com",
    password: "outra-senha-9",
  });
  const c = await call("POST", "/api/clients", { name: "Cliente Filtro" });
  const ev = {
    name: "Show Filtro",
    date: "2027-03-10",
    start_time: "20:00",
    client_id: c.j.id,
    venue: "Teatro",
    status: "pendente",
  };
  const a = await call("POST", "/api/events", ev);
  assert.equal(a.s, 201);
  assert.equal(
    (await call("POST", "/api/events", ev)).s,
    409,
    "duplicado bloqueado",
  );
  assert.equal(
    (await call("POST", "/api/events", { ...ev, start_time: "21:00" })).s,
    201,
    "outro horário é permitido",
  );
  assert.equal(
    (await call("PUT", "/api/events/" + a.j.id, { ...a.j })).s,
    200,
    "editar o próprio evento não conflita",
  );
  assert.equal(
    (await call("GET", "/api/events?from=2027-03-01&to=2027-03-31&q=Filtro")).j
      .length,
    2,
  );
  assert.equal(
    (await call("GET", "/api/events?from=2027-04-01&q=Filtro")).j.length,
    0,
  );
  const has = async (st: string) =>
    (await call("GET", "/api/clients?status=" + st)).j.some(
      (x: any) => x.id == c.j.id,
    );
  assert.equal(await has("pendente"), true);
  assert.equal(await has("confirmado"), false);
  assert.equal(await has("sem"), false);
});

test("financeiro e relatórios: CRUD, filtros, indicadores, exportação e autenticação", async () => {
  const previous = await call("GET", "/api/reports/kpis");
  const client = await call("POST", "/api/clients", { name: "Cliente Financeiro" });
  const event = await call("POST", "/api/events", {
    name: "Evento Financeiro",
    date: "2027-06-20",
    start_time: "20:00",
    client_id: client.j.id,
    venue: "Teatro",
    status: "confirmado",
    contract_value: 1800,
  });
  const base = {
    event_id: event.j.id,
    description: "Parcela contratual",
    amount: 900,
    due_date: "2027-05-20",
    paid_date: null,
    status: "pendente",
    installment: "1 de 2",
  };
  assert.equal((await call("POST", "/api/finances", { ...base, amount: 0 })).s, 422);
  assert.equal((await call("POST", "/api/finances", { ...base, event_id: 99999 })).s, 422);
  assert.equal((await call("POST", "/api/finances", { ...base, due_date: "2027-02-30" })).s, 422);
  assert.equal((await call("POST", "/api/finances", { ...base, status: "pago" })).s, 422);
  const created = await call("POST", "/api/finances", base);
  assert.equal(created.s, 201);
  assert.equal(created.j.installment, "1 de 2");
  assert.equal((await call("GET", "/api/finances?q=Financeiro")).j.items[0].event_name, "Evento Financeiro");
  assert.equal((await call("GET", "/api/finances?status=pago")).j.items.length, 0);
  assert.equal((await call("GET", "/api/finances?from=2027-05-20&to=2027-05-20")).j.items.length, 1);
  const paid = await call("PUT", "/api/finances/" + created.j.id, {
    ...base,
    status: "pago",
    paid_date: "2027-05-18",
  });
  assert.equal(paid.s, 200);
  assert.equal(paid.j.status, "pago");
  assert.equal((await call("PUT", "/api/finances/99999", base)).s, 404);
  const report = await call("GET", "/api/reports/kpis");
  assert.equal(report.j.events.total, previous.j.events.total + 1);
  assert.equal(report.j.events.confirmed, previous.j.events.confirmed + 1);
  assert.equal(report.j.events.rate, Math.round(report.j.events.confirmed / report.j.events.total * 100));
  assert.equal(report.j.finances.received, 900);
  assert.equal((await call("GET", "/api/reports/not-a-report/export")).s, 404);
  for (const type of ["financial", "events"]) {
    const csv = await fetch(`${B}/api/reports/${type}/export`, { headers: { cookie: ck } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") || "", /text\/csv/);
    assert.deepEqual([...new Uint8Array(await csv.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  }
  assert.equal((await call("DELETE", "/api/finances/" + created.j.id)).s, 200);
  assert.equal((await call("DELETE", "/api/finances/" + created.j.id)).s, 404);
  const linked = await call("POST", "/api/finances", { ...base, description: "Cascata" });
  assert.equal(linked.s, 201);
  assert.equal((await call("DELETE", "/api/events/" + event.j.id)).s, 200);
  const kept = (await call("GET", "/api/finances")).j.items.find((x: any) => x.id == linked.j.id);
  assert.equal(kept.description, "Cascata");
  assert.equal(kept.event_id, null);
});

test("equipe (Wesley): exige login, valida, cadastra, edita, impede duplicidade e exclui", async () => {
  assert.equal((await call("GET", "/api/team", undefined, "")).s, 401);
  await call("POST", "/api/auth/login", {
    email: "novo@t.com",
    password: "outra-senha-9",
  });
  const body = {
    name: "Carolina Martins",
    role: "Músico",
    phone: "(41) 99999-0000",
    status: "ativo",
  };
  assert.equal(
    (await call("POST", "/api/team", { ...body, name: " " })).s,
    422,
  );
  assert.equal(
    (await call("POST", "/api/team", { ...body, role: "Cantor" })).s,
    422,
  );
  assert.equal(
    (await call("POST", "/api/team", { ...body, phone: "123" })).s,
    422,
  );
  assert.equal(
    (await call("POST", "/api/team", { ...body, status: "x" })).s,
    422,
  );
  const c = await call("POST", "/api/team", body);
  assert.equal(c.s, 201);
  assert.equal(c.j.status, "ativo");
  assert.ok(c.j.created_at);
  assert.equal(
    (await call("POST", "/api/team", { ...body, phone: "41 99999 0000" })).s,
    409,
    "mesmo nome e telefone",
  );
  const u = await call("PUT", "/api/team/" + c.j.id, {
    ...body,
    role: "Técnico",
    status: "inativo",
  });
  assert.equal(u.j.role, "Técnico");
  assert.equal(u.j.status, "inativo");
  assert.equal((await call("PUT", "/api/team/99999", body)).s, 404);
  assert.ok(
    (await call("GET", "/api/team")).j.some((x: any) => x.id == c.j.id),
  );
  assert.equal((await call("DELETE", "/api/team/" + c.j.id)).s, 200);
  assert.equal((await call("DELETE", "/api/team/" + c.j.id)).s, 404);
});

test("colaboradores: convite, ativação, RBAC granular e revogação de sessão", async () => {
  const event = await call("POST", "/api/events", { name: "Evento RBAC" });
  assert.equal(event.s, 201);
  const emailCountBeforeInvite = mails().length;
  const invited = await call("POST", "/api/admin/invitations", { name: "Colaborador RBAC", email: "rbac@t.com", role: "collaborator" });
  assert.equal(invited.s, 201);
  assert.equal(invited.j.role, "collaborator");
  assert.equal(invited.j.token, undefined, "token não é devolvido pela API");
  assert.equal((await call("GET", "/api/admin/users")).j.invitations.some((item: any) => item.email === "rbac@t.com"), true);
  assert.equal((await queryTestDatabase("SELECT target_role FROM invitations WHERE email=?", "rbac@t.com")).rows[0].target_role, "collaborator");
  const inviteMail = mails().at(-1);
  assert.equal(mails().length, emailCountBeforeInvite + 1, "convite chama a API da Brevo");
  assert.deepEqual(inviteMail.sender, { name: "MWE Harmonize", email: "no-reply@test.local" });
  assert.equal(inviteMail.to[0].email, "rbac@t.com");
  const token = /token=([a-f0-9]{64})/i.exec(inviteMail.htmlContent)?.[1];
  assert.ok(token, "link de convite contém token aleatório");
  assert.equal(JSON.stringify(invited.j).includes(token), false);
  assert.equal(JSON.stringify(invited.j).includes("mock-brevo-key-for-tests"), false);
  assert.equal(logs.includes(token), false, "token não aparece nos logs");
  const expiredToken = "b".repeat(64);
  await queryTestDatabase("INSERT INTO invitations(organization_id,email,name,role,target_role,token_hash,expires_at,created_by,created_at) VALUES(1,?,'Expirado','collaborator','collaborator',?,?,1,?)", "expirado@t.com", createHash("sha256").update(expiredToken).digest("hex"), Date.now() - 1000, Date.now());
  assert.equal((await call("POST", "/api/invitations/accept", { token: expiredToken, password: "senha-expirada-1" }, "")).s, 400, "convite expirado não pode ser aceito");
  assert.equal((await call("POST", "/api/invitations/accept", { token, password: "senha-colaborador-1" }, "")).s, 200);
  assert.equal((await call("POST", "/api/invitations/accept", { token, password: "senha-colaborador-2" }, "")).s, 400, "convite é de uso único");
  const collaboratorId = Number((await queryTestDatabase("SELECT id FROM users WHERE email=?", "rbac@t.com")).rows[0].id);
  assert.equal((await queryTestDatabase("SELECT role FROM organization_members WHERE user_id=?", collaboratorId)).rows[0].role, "collaborator");
  assert.deepEqual((await queryTestDatabase("SELECT permission FROM role_permissions WHERE role='collaborator' ORDER BY permission")).rows.map((row: any) => row.permission), ["clients.create","clients.edit","clients.view","events.create","events.edit","events.view","finance.view","repertoire.view","reports.view","settings.view","team.create","team.edit","team.view"]);
  assert.equal((await queryTestDatabase("SELECT 1 FROM role_permissions WHERE role='collaborator' AND permission='users.view'")).rows.length, 0);
  const login = await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "");
  assert.equal(login.s, 200);
  const collaboratorCookie = login.h!.split(";")[0];
  assert.equal((await call("GET", "/api/auth/me", undefined, collaboratorCookie)).j.role, "collaborator");
  assert.equal((await call("GET", "/api/admin/users", undefined, collaboratorCookie)).s, 403);
  assert.equal((await call("DELETE", `/api/events/${event.j.id}`, undefined, collaboratorCookie)).s, 403, "sem events.delete");
  const adminLogin = await call("POST", "/api/auth/login", { email: "novo@t.com", password: "outra-senha-9" }, "");
  assert.equal(adminLogin.s, 200);
  ck = adminLogin.h!.split(";")[0];
  const adminCookie = ck;
  const userId = Number((await queryTestDatabase("SELECT id FROM users WHERE email=?", "rbac@t.com")).rows[0].id);
  const scoped = await call("GET", "/api/admin/users");
  assert.equal(scoped.s, 200);
  assert.equal(scoped.j.users.some((user: any) => user.id === userId), true);
  assert.equal(JSON.stringify(scoped.j).includes("hash"), false);
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { permissions: ["users.create", "users.edit", "events.view", "events.delete", "reports.view"] })).s, 200);
  const refreshed = await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "");
  const refreshedCookie = refreshed.h!.split(";")[0];
  assert.equal((await call("POST", "/api/events", { name: "Negado pelo perfil" }, refreshedCookie)).s, 403, "criação fica desativada pelo override explícito");
  assert.equal((await call("GET", "/api/reports/kpis", undefined, refreshedCookie)).s, 403, "relatórios não expõem valores sem finance.view");
  assert.equal((await call("POST", "/api/admin/invitations", { name: "Tentativa", email: "unauthorized-admin@t.com", role: "admin" }, refreshedCookie)).s, 403, "usuário comum não pode definir perfil de administrador mesmo com users.create");
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { role: "admin" }, refreshedCookie)).s, 403, "colaborador não pode elevar o próprio perfil por HTTP");
  assert.equal((await call("DELETE", `/api/events/${event.j.id}`, undefined, refreshedCookie)).s, 200, "permissão explícita de exclusão funciona");
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { role: "admin" }, adminCookie)).s, 200);
  const promoted = await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "");
  assert.equal((await call("GET", "/api/auth/me", undefined, promoted.h!.split(";")[0])).j.role, "admin");
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { role: "collaborator" }, adminCookie)).s, 200);
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { status: "blocked" }, adminCookie)).s, 200);
  assert.equal((await call("GET", "/api/auth/me", undefined, refreshedCookie)).s, 401, "bloqueio revoga sessões existentes");
  assert.equal((await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "")).s, 401);
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { status: "active" }, adminCookie)).s, 200);
  const activeAgain = await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "");
  const activeCookie = activeAgain.h!.split(";")[0];
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { status: "disabled" }, adminCookie)).s, 200);
  assert.equal((await call("GET", "/api/events", undefined, activeCookie)).s, 401, "usuário desativado perde acesso às áreas protegidas");
  assert.equal((await call("POST", "/api/auth/login", { email: "rbac@t.com", password: "senha-colaborador-1" }, "")).s, 401);
  assert.equal((await call("PATCH", `/api/admin/users/${userId}`, { status: "active" }, adminCookie)).s, 200);
});

test("administrador pode convidar um novo administrador com perfil persistido", async () => {
  const admin = await call("POST", "/api/auth/login", { email: "novo@t.com", password: "outra-senha-9" }, "");
  assert.equal(admin.s, 200);
  const adminCookie = admin.h!.split(";")[0];
  const failInviteEmailCount = mails().length;
  const providerEchoToken = "c".repeat(64);
  writeFileSync(EMAIL_FAIL, JSON.stringify({ status: 403, body: { code: "domain_not_verified", message: `The sender domain is not verified: sender@example.test; recipient private.user@example.com; token=${providerEchoToken}` } }));
  const rejectedInvite = await call("POST", "/api/admin/invitations", { name: "Falha de envio", email: "falha-convite@t.com", role: "collaborator" }, adminCookie);
  assert.equal(rejectedInvite.s, 503, "convite só informa sucesso após aceite da Brevo");
  assert.equal(JSON.stringify(rejectedInvite.j).includes("mock-brevo-key-for-tests"), false);
  const rejectedInviteMail = mails().at(-1)!;
  const rejectedInviteToken = /token=([a-f0-9]{64})/i.exec(rejectedInviteMail.htmlContent)?.[1];
  assert.ok(rejectedInviteToken);
  assert.equal(logs.includes(rejectedInviteToken), false, "token de convite rejeitado não aparece nos logs");
  for (let attempt = 0; attempt < 20 && !logs.includes("domain-unverified"); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(logs, /operation: 'collaborator-invite'/);
  assert.match(logs, /endpoint: 'https:\/\/api\.brevo\.com\/v3\/smtp\/email'/);
  assert.match(logs, /category: 'domain-unverified'/);
  assert.match(logs, /status: 403/);
  assert.match(logs, /not verified/);
  assert.equal(logs.includes("private.user@example.com"), false, "mensagem do provedor tem e-mail sanitizado");
  assert.equal(logs.includes(providerEchoToken), false, "token ecoado pelo provedor é sanitizado");
  assert.equal(logs.includes("mock-brevo-key-for-tests"), false, "chave nunca aparece nos logs");
  assert.equal(Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM invitations WHERE email=?", "falha-convite@t.com")).rows[0].n), 0, "convite não enviado é removido");
  assert.equal(mails().length, failInviteEmailCount + 1);

  writeFileSync(EMAIL_FAIL, JSON.stringify({ status: 401, body: { code: "unauthorized", message: "Authentication failed: mock-brevo-key-for-tests" } }));
  const invalidKeyInvite = await call("POST", "/api/admin/invitations", { name: "Falha de chave", email: "falha-chave@t.com", role: "collaborator" }, adminCookie);
  assert.equal(invalidKeyInvite.s, 503);
  for (let attempt = 0; attempt < 20 && !logs.includes("api-key-invalid"); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(logs, /category: 'api-key-invalid'/);
  assert.match(logs, /status: 401/);
  assert.equal(logs.includes("mock-brevo-key-for-tests"), false, "chave não aparece mesmo se o provedor ecoar erro");

  const providerFailures = [
    { status: 400, code: "invalid_parameter", message: "Invalid sender email", category: "sender-not-authorized" },
    { status: 429, code: "too_many_requests", message: "Too many requests", category: "rate-limit" },
    { status: 500, code: "internal_error", message: "Temporary provider error", category: "http-error" },
  ];
  for (const [index, failure] of providerFailures.entries()) {
    writeFileSync(EMAIL_FAIL, JSON.stringify({ status: failure.status, body: { code: failure.code, message: failure.message } }));
    const failed = await call("POST", "/api/admin/invitations", { name: "Falha Brevo", email: `falha-brevo-${index}@t.com`, role: "collaborator" }, adminCookie);
    assert.equal(failed.s, 503);
    for (let attempt = 0; attempt < 20 && !logs.includes(`category: '${failure.category}'`); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(logs.includes(`category: '${failure.category}'`), `categoriza HTTP ${failure.status}`);
    assert.ok(logs.includes(`status: ${failure.status}`), `registra status HTTP ${failure.status}`);
  }
  rmSync(EMAIL_FAIL, { force: true });
  const beforeAdminInvite = mails().length;
  const invitation = await call("POST", "/api/admin/invitations", { name: "Admin convidado", email: "admin-convidado@t.com", role: "admin" }, adminCookie);
  assert.equal(invitation.s, 201);
  assert.equal(invitation.j.role, "admin");
  const stored = (await queryTestDatabase("SELECT target_role,token_hash FROM invitations WHERE email=?", "admin-convidado@t.com")).rows[0] as any;
  assert.equal(stored.target_role, "admin");
  const adminMail = mails().at(-1)!;
  assert.equal(mails().length, beforeAdminInvite + 1);
  assert.equal(adminMail.to[0].email, "admin-convidado@t.com");
  assert.deepEqual(adminMail.sender, { name: "MWE Harmonize", email: "no-reply@test.local" });
  const token = /token=([a-f0-9]{64})/i.exec(adminMail.htmlContent)?.[1];
  assert.ok(token);
  assert.equal(JSON.stringify(invitation.j).includes(token), false);
  assert.equal(JSON.stringify(invitation.j).includes("mock-brevo-key-for-tests"), false);
  assert.equal(logs.includes(token), false, "token não aparece nos logs");
  assert.equal(createHash("sha256").update(token).digest("hex"), stored.token_hash, "token enviado corresponde apenas ao hash armazenado");
  assert.equal((await call("POST", "/api/invitations/accept", { token, password: "senha-admin-convidado-1" }, "")).s, 200);
  const id = Number((await queryTestDatabase("SELECT id FROM users WHERE email=?", "admin-convidado@t.com")).rows[0].id);
  assert.equal((await queryTestDatabase("SELECT role FROM organization_members WHERE user_id=?", id)).rows[0].role, "admin");
  assert.equal(Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM role_permissions WHERE role='admin'")).rows[0].n), Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM permissions")).rows[0].n));
  const login = await call("POST", "/api/auth/login", { email: "admin-convidado@t.com", password: "senha-admin-convidado-1" }, "");
  const cookie = login.h!.split(";")[0];
  assert.equal((await call("GET", "/api/auth/me", undefined, cookie)).j.role, "admin");
  assert.equal((await call("GET", "/api/admin/users", undefined, cookie)).s, 200);
});

test("isolamento entre organizações bloqueia IDOR em dados e usuários", async () => {
  const orgId = Number((await queryTestDatabase("INSERT INTO organizations(name) VALUES(?) RETURNING id", "Organização B")).rows[0].id), salt = "other-org-password-salt";
  const userId = Number((await queryTestDatabase("INSERT INTO users(email,name,hash) VALUES(?,?,?) RETURNING id", "orgb@t.com", "Usuário B", `${salt}:${scryptSync("senha-orgb-1", salt, 64).toString("hex")}`)).rows[0].id);
  await queryTestDatabase("INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(?,?,'admin','active')", userId, orgId);
  const clientId = Number((await queryTestDatabase("INSERT INTO clients(name,organization_id) VALUES(?,?) RETURNING id", "Cliente B", orgId)).rows[0].id);
  const eventId = Number((await queryTestDatabase("INSERT INTO events(name,client_id,organization_id) VALUES(?,?,?) RETURNING id", "Evento B", clientId, orgId)).rows[0].id);
  const financeId = Number((await queryTestDatabase("INSERT INTO finances(event_id,description,amount,due_date,organization_id) VALUES(?,?,?,?,?) RETURNING id", eventId, "Lançamento B", 100, "2027-01-01", orgId)).rows[0].id);
  const memberId = Number((await queryTestDatabase("INSERT INTO integrantes_equipe(name,role,phone,organization_id) VALUES(?,?,?,?) RETURNING id", "Equipe B", "Músico", "41999999999", orgId)).rows[0].id);
  const repertoireId = Number((await queryTestDatabase("INSERT INTO repertoire(event_id,moment,position,title,organization_id) VALUES(?,?,?,?,?) RETURNING id", eventId, "entrada", 1, "Música B", orgId)).rows[0].id);
  await queryTestDatabase("INSERT INTO company_settings(user_id,organization_id,nome,exibicao,email,telefone) VALUES(?,?,?,?,?,?)", userId, orgId, "Empresa B", "B", "b@empresa.com", "41999999999");
  const login = await call("POST", "/api/auth/login", { email: "novo@t.com", password: "outra-senha-9" }, "");
  const adminCookie = login.h!.split(";")[0];
  const ownEvent = await call("POST", "/api/events", { name: "Evento A" }, adminCookie);
  const attacks = [
    ["GET", `/api/events/${eventId}`], ["PUT", `/api/events/${eventId}`], ["DELETE", `/api/events/${eventId}`],
    ["PUT", `/api/clients/${clientId}`], ["DELETE", `/api/clients/${clientId}`],
    ["PUT", `/api/finances/${financeId}`], ["DELETE", `/api/finances/${financeId}`],
    ["PATCH", `/api/admin/users/${userId}`], ["DELETE", `/api/admin/users/${userId}`],
  ] as const;
  for (const [method, path] of attacks) {
    const body = { name: "Alteração indevida", description: "Alteração indevida" };
    const result = await call(method, path, body, adminCookie);
    assert.equal(result.s, 404, `${method} ${path} deve se comportar como recurso inexistente fora da organização`);
  }
  const foreignRepertoire = await call("PUT", "/api/repertorios", { musicas: [{ id: repertoireId, evento: String(ownEvent.j.id), momento: "entrada", ordem: 1, music: "Ataque", art: "", compo: "", instru: "", obs: "", link: "" }], duracoes: {}, statusEventos: {} }, adminCookie);
  assert.equal(foreignRepertoire.s, 403, "música pertencente à outra organização não pode ser alterada");
  assert.equal((await call("GET", "/api/clients", undefined, adminCookie)).j.some((item: any) => item.id === clientId), false);
  assert.equal((await call("GET", "/api/events", undefined, adminCookie)).j.some((item: any) => item.id === eventId), false);
  assert.equal((await call("GET", "/api/finances", undefined, adminCookie)).j.items.some((item: any) => item.id === financeId), false);
  assert.equal((await call("GET", "/api/team", undefined, adminCookie)).j.some((item: any) => item.id === memberId), false);
  assert.equal((await call("GET", "/api/repertorios", undefined, adminCookie)).j.musicas.some((item: any) => item.id === repertoireId), false);
  assert.notEqual((await call("GET", "/api/configuracoes", undefined, adminCookie)).j.nome, "Empresa B");
  assert.equal((await call("GET", "/api/admin/users", undefined, adminCookie)).j.users.some((user: any) => user.id === userId), false);
});
