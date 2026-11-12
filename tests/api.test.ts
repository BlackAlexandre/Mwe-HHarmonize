import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const P = 3917,
  B = `http://localhost:${P}`,
  DB = "/tmp/h-test.db";
const mails: string[] = [];
const smtp = net.createServer((s) => {
  let buf = "",
    data = "",
    inData = false;
  s.write("220 test ESMTP\r\n");
  s.on("data", (c) => {
    buf += c;
    const lines = buf.split("\r\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (inData) {
        if (line == ".") {
          inData = false;
          mails.push(data);
          data = "";
          s.write("250 OK\r\n");
        } else data += line + "\r\n";
      } else if (/^DATA/i.test(line)) {
        inData = true;
        s.write("354 go\r\n");
      } else if (/^QUIT/i.test(line)) {
        s.write("221 bye\r\n");
        s.end();
      } else if (/^EHLO/i.test(line)) s.write("250-test\r\n250 8BITMIME\r\n");
      else if (line) s.write("250 OK\r\n");
    }
  });
});
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
  rmSync(DB, { force: true });
  await new Promise<void>((r) => smtp.listen(2599, r));
  srv = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(P),
      DB_FILE: DB,
      ADMIN_EMAIL: "a@t.com",
      ADMIN_PASSWORD: "senha-forte-1",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "2599",
      SMTP_FROM: "Harmonize <no-reply@test.local>",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  srv.stdout.on("data", (d: any) => (logs += d));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(B + "/api/auth/me");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});
after(() => {
  srv.kill();
  smtp.close();
});

test("rotas privadas exigem login", async () => {
  for (const u of [
    "/api/events",
    "/api/clients",
    "/api/auth/me",
    "/api/account",
    "/api/overview",
  ])
    assert.equal((await call("GET", u, undefined, "")).s, 401);
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
test("integridade: cliente com evento não pode ser excluído", async () => {
  assert.equal((await call("DELETE", "/api/clients/" + cid)).s, 409);
  assert.equal((await call("DELETE", "/api/events/" + eid)).s, 200);
  assert.equal((await call("GET", "/api/events/" + eid)).s, 404);
  const rest = (await call("GET", "/api/events?q=rascunho")).j;
  for (const x of rest) await call("DELETE", "/api/events/" + x.id);
  assert.equal((await call("DELETE", "/api/clients/" + cid)).s, 200);
});
test("recuperação de acesso e logout", async () => {
  const f = await call("POST", "/api/auth/forgot", { email: "a@t.com" }, "");
  assert.equal(f.j.devLink, undefined, "token nunca vai na resposta da API");
  assert.deepEqual(
    (await call("POST", "/api/auth/forgot", { email: "ninguem@t.com" }, "")).j,
    f.j,
    "resposta igual para e-mail inexistente",
  );
  for (let i = 0; i < 30 && !mails.length; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    mails.length,
    1,
    "um e-mail enviado ao cadastrado e nenhum ao inexistente",
  );
  const [head, ...rest] = mails[0].split("\r\n\r\n"),
    body = rest.join("\r\n\r\n"),
    enc = /Content-Transfer-Encoding: (\S+)/i.exec(head)?.[1].toLowerCase();
  const text =
    enc == "base64"
      ? Buffer.from(body.replace(/\s/g, ""), "base64").toString()
      : enc == "quoted-printable"
        ? body
            .replace(/=\r\n/g, "")
            .replace(/=([0-9A-F]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16)),
            )
        : body;
  assert.match(head, /To: .*a@t\.com/i);
  const token = /token=([0-9a-f]{64})/.exec(text)![1];
  const raw = new DatabaseSync(DB),
    sha = (t: string) => createHash("sha256").update(t).digest("hex");
  raw
    .prepare("INSERT INTO resets VALUES(?,?,?)")
    .run(sha("expirado"), 1, Date.now() - 1000);
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
  raw.close();
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
});

test("minha conta: dados, e-mail duplicado e senha", async () => {
  await call("POST", "/api/auth/login", {
    email: "a@t.com",
    password: "nova-senha-2",
  });
  const raw = new DatabaseSync(DB);
  raw
    .prepare("INSERT INTO users(email,name,hash) VALUES(?,?,?)")
    .run("b@t.com", "B", "x:00");
  raw.close();
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
  const raw = new DatabaseSync(DB);
  assert.equal(
    (raw.prepare("SELECT COUNT(*) n FROM repertoire").get() as any).n,
    0,
    "repertório removido em cascata",
  );
  raw.close();
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
