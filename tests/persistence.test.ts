import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, readdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scryptSync } from "node:crypto";
const DB = "/tmp/h-persist.db",
  P = 3918,
  B = `http://localhost:${P}`;
const start = async () => {
  const s = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(P),
      DB_FILE: DB,
      ADMIN_EMAIL: "p@t.com",
      ADMIN_PASSWORD: "senha-forte-1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(B + "/api/auth/me");
      return s;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("servidor não iniciou");
};
const stop = (s: any) =>
  new Promise((r) => {
    s.once("exit", r);
    s.kill();
  });
const login = async () => {
  const r = await fetch(B + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "p@t.com", password: "senha-forte-1" }),
  });
  return r.headers.get("set-cookie")!.split(";")[0];
};
test("clientes, eventos e repertório persistem após reiniciar o servidor", async () => {
  rmSync(DB, { force: true });
  let s = await start(),
    ck = await login();
  const h = { "content-type": "application/json", cookie: ck };
  const post = async (u: string, b: any) =>
    (
      await fetch(B + u, {
        method: "POST",
        headers: h,
        body: JSON.stringify(b),
      })
    ).json();
  const c = await post("/api/clients", { name: "Persistente" });
  const ev = await post("/api/events", {
    name: "Evento P",
    date: "2027-01-05",
    start_time: "10:00",
    client_id: c.id,
    venue: "Sala",
    status: "confirmado",
    repertoire: [{ moment: "entrada", title: "Música" }],
  });
  const finRes = await fetch(B + "/api/finances", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      event_id: ev.id,
      description: "Sinal",
      amount: 450,
      due_date: "2027-01-01",
      status: "pendente",
      installment: "1 de 2",
    }),
  });
  const fin = await finRes.json();
  assert.equal(finRes.status, 201);
  const rep = await fetch(B + "/api/repertorios", {
    method: "PUT",
    headers: h,
    body: JSON.stringify({
      musicas: [{ evento: String(ev.id), momento: "noiva", ordem: 1, music: "Persistente", art: "Artista", compo: "Autor", instru: "Voz", obs: "Teste", link: "https://example.com/audio.mp3" }],
      duracoes: { [`${ev.id}|noiva`]: 4 },
      statusEventos: { [ev.id]: "aprovado" },
    }),
  });
  assert.equal(rep.status, 200);
  const settings = await fetch(B + "/api/configuracoes", {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ nome: "MWE persistente", exibicao: "MWE", email: "empresa@example.com", telefone: "41999990000", idioma: "pt-BR", moeda: "BRL", formato: "dd/mm/aaaa", fuso: "America/Sao_Paulo", novosEventos: true, vencimentos: false, escalas: true }),
  });
  assert.equal(settings.status, 200);
  await stop(s);
  s = await start();
  ck = await login();
  const got = await (
    await fetch(B + "/api/events/" + ev.id, { headers: { cookie: ck } })
  ).json();
  assert.equal(got.name, "Evento P");
  assert.equal(got.status, "confirmado");
  assert.equal(got.client_name, "Persistente");
  assert.equal(got.repertoire.length, 1);
  const repertoire = await (await fetch(B + "/api/repertorios", { headers: { cookie: ck } })).json();
  assert.equal(repertoire.musicas.find((x: any) => x.music === "Persistente")?.compo, "Autor");
  assert.equal(repertoire.duracoes[`${ev.id}|noiva`], 4);
  assert.equal(repertoire.statusEventos[String(ev.id)], "aprovado");
  assert.equal(repertoire.musicas.some((x: any) => x.music === "Música" && x.legacy), true);
  const restoredSettings = await (await fetch(B + "/api/configuracoes", { headers: { cookie: ck } })).json();
  assert.equal(restoredSettings.nome, "MWE persistente");
  assert.equal(restoredSettings.vencimentos, false);
  const financial = await (
    await fetch(B + "/api/finances", { headers: { cookie: ck } })
  ).json();
  assert.equal(financial.items.find((x: any) => x.id == fin.id)?.description, "Sinal");
  await stop(s);
});

test("integrantes da equipe persistem após reiniciar o servidor", async () => {
  rmSync(DB, { force: true });
  let s = await start(),
    ck = await login();
  const res = await fetch(B + "/api/team", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ck },
    body: JSON.stringify({
      name: "Lucas Andrade",
      role: "Músico",
      phone: "41999990000",
      status: "ativo",
    }),
  });
  const m = await res.json();
  await stop(s);
  s = await start();
  ck = await login();
  const list = await (
    await fetch(B + "/api/team", { headers: { cookie: ck } })
  ).json();
  assert.equal(list.find((x: any) => x.id == m.id)?.name, "Lucas Andrade");
  await stop(s);
});

test("migração de banco legado preserva e associa dados existentes à organização inicial", async () => {
  rmSync(DB, { force: true });
  const legacy = new DatabaseSync(DB), salt = "legacy-admin-salt";
  legacy.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,hash TEXT NOT NULL);
    CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT,phone TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT,date TEXT,start_time TEXT,client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,contact TEXT,venue TEXT,city TEXT,uf TEXT,lineup TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'rascunho',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE finances(id INTEGER PRIMARY KEY,event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,description TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,paid_date TEXT,status TEXT NOT NULL DEFAULT 'pendente',installment TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE security_audit(id INTEGER PRIMARY KEY,actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE repertoire(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,moment TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL,performer TEXT,notes TEXT);
    CREATE TABLE company_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,nome TEXT NOT NULL,exibicao TEXT NOT NULL,email TEXT NOT NULL,telefone TEXT NOT NULL,idioma TEXT NOT NULL DEFAULT 'pt-BR',moeda TEXT NOT NULL DEFAULT 'BRL',formato TEXT NOT NULL DEFAULT 'dd/mm/aaaa',fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',novosEventos INTEGER NOT NULL DEFAULT 1,vencimentos INTEGER NOT NULL DEFAULT 1,escalas INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integrantes_equipe(id INTEGER PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ativo',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const admin = legacy.prepare("INSERT INTO users(email,name,hash) VALUES(?,?,?)").run("p@t.com", "Administrador legado", `${salt}:${scryptSync("senha-forte-1", salt, 64).toString("hex")}`);
  const client = legacy.prepare("INSERT INTO clients(name) VALUES(?)").run("Cliente legado"), clientId = Number(client.lastInsertRowid);
  const event = legacy.prepare("INSERT INTO events(name,date,client_id,status) VALUES(?,?,?,'confirmado')").run("Evento legado", "2099-01-01", clientId), eventId = Number(event.lastInsertRowid);
  legacy.prepare("INSERT INTO finances(event_id,description,amount,due_date,status) VALUES(?,?,?,?,'pendente')").run(eventId, "Parcela legado", 750, "2098-12-01");
  legacy.prepare("INSERT INTO repertoire(event_id,moment,position,title,performer) VALUES(?,?,?,?,?)").run(eventId, "entrada", 1, "Música legada", "Artista legado");
  legacy.prepare("INSERT INTO integrantes_equipe(name,role,phone) VALUES(?,?,?)").run("Integrante legado", "Músico", "41999990000");
  legacy.prepare("INSERT INTO company_settings(user_id,nome,exibicao,email,telefone) VALUES(?,?,?,?,?)").run(Number(admin.lastInsertRowid), "Empresa legada", "Legado", "empresa@legado.com", "41999990000");
  legacy.close();

  let s = await start(), ck = await login();
  const headers = { cookie: ck };
  const [events, finances, team, repertoire, settings] = await Promise.all([
    fetch(B + "/api/events", { headers }).then((r) => r.json()),
    fetch(B + "/api/finances", { headers }).then((r) => r.json()),
    fetch(B + "/api/team", { headers }).then((r) => r.json()),
    fetch(B + "/api/repertorios", { headers }).then((r) => r.json()),
    fetch(B + "/api/configuracoes", { headers }).then((r) => r.json()),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].client_name, "Cliente legado");
  assert.equal(finances.items[0].description, "Parcela legado");
  assert.equal(team[0].name, "Integrante legado");
  assert.equal(repertoire.musicas[0].music, "Música legada");
  assert.equal(settings.nome, "Empresa legada");
  let migrated = new DatabaseSync(DB, { readOnly: true });
  const organizationId = Number((migrated.prepare("SELECT id FROM organizations").get() as any).id);
  for (const table of ["clients", "events", "finances", "integrantes_equipe", "repertoire", "company_settings"])
    assert.equal((migrated.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id=?`).get(organizationId) as any).n, 1, `${table} recebeu organização`);
  assert.equal((migrated.prepare("PRAGMA foreign_key_check").all() as any[]).length, 0);
  migrated.close();
  const backups = readdirSync(dirname(DB)).filter((file) => file.startsWith(basename(DB) + ".pre-org-") && file.endsWith(".sqlite"));
  assert.ok(backups.length > 0, "backup íntegro criado antes da migração");
  const backup = new DatabaseSync(`${dirname(DB)}/${backups.at(-1)}`, { readOnly: true });
  assert.equal((backup.prepare("PRAGMA integrity_check").get() as any).integrity_check, "ok");
  backup.close();
  await stop(s);
  s = await start();
  ck = await login();
  assert.equal((await (await fetch(B + "/api/events", { headers: { cookie: ck } })).json())[0].name, "Evento legado", "dados migrados sobrevivem a um restart");
  await stop(s);
  for (const file of backups) rmSync(`${dirname(DB)}/${file}`, { force: true });
});

test("migração interrompe banco legado ambíguo antes de alterar o schema ou registros", async () => {
  rmSync(DB, { force: true });
  const legacy = new DatabaseSync(DB);
  legacy.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,hash TEXT NOT NULL); CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL); INSERT INTO users(email,name,hash) VALUES('a@legacy.test','A','x'),('b@legacy.test','B','x'); INSERT INTO clients(name) VALUES('Preservado');");
  legacy.close();
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: { ...process.env, PORT: String(P), DB_FILE: DB, ADMIN_EMAIL: "p@t.com", ADMIN_PASSWORD: "senha-forte-1" },
    stdio: "ignore",
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Migração ambígua não foi interrompida")); }, 5000);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolveExit(code ?? -1); });
  });
  assert.equal(exitCode, 1);
  const unchanged = new DatabaseSync(DB, { readOnly: true });
  assert.equal((unchanged.prepare("SELECT COUNT(*) n FROM users").get() as any).n, 2);
  assert.equal((unchanged.prepare("SELECT COUNT(*) n FROM clients").get() as any).n, 1);
  assert.equal(unchanged.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organizations'").get(), undefined);
  unchanged.close();
});

test("upgrade de convites legados adiciona o perfil sem perder convites pendentes", async () => {
  rmSync(DB, { force: true });
  let s = await start();
  await stop(s);
  const legacy = new DatabaseSync(DB);
  legacy.exec("ALTER TABLE invitations DROP COLUMN target_role");
  legacy.prepare("INSERT INTO invitations(organization_id,email,name,role,token_hash,expires_at,created_by,created_at) VALUES(1,?,?, 'collaborator',?,?,1,?)")
    .run("pendente@legacy.test", "Convite legado", "legacy-token-hash", Date.now() + 86400000, Date.now());
  legacy.close();
  s = await start();
  const raw = new DatabaseSync(DB, { readOnly: true });
  const pending = raw.prepare("SELECT target_role FROM invitations WHERE email='pendente@legacy.test'").get() as any;
  assert.equal(pending.target_role, "collaborator");
  assert.equal((raw.prepare("SELECT COUNT(*) n FROM invitations WHERE email='pendente@legacy.test'").get() as any).n, 1);
  raw.close();
  const ck = await login();
  const adminList = await (await fetch(B + "/api/admin/users", { headers: { cookie: ck } })).json();
  assert.equal(adminList.invitations.find((item: any) => item.email === "pendente@legacy.test")?.role, "collaborator");
  await stop(s);
});
