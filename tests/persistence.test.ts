import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { testDatabaseConfigured, prepareTestDatabase, queryTestDatabase, cleanTestDatabase } from "./postgres-test.js";

const test = (name: string, fn: (...args: any[]) => any) => nodeTest(name, { skip: !testDatabaseConfigured }, fn as any);
const P = 3918, B = "http://localhost:" + P;
let server: ReturnType<typeof spawn> | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const start = async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: { ...process.env, PORT: String(P), DATABASE_URL: process.env.MWE_TEST_DATABASE_URL, ADMIN_EMAIL: "pg-persist@test.com", ADMIN_PASSWORD: "senha-forte-1", NODE_ENV: "test" },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await fetch(B + "/api/auth/me");
      return child;
    } catch { await sleep(150); }
  }
  child.kill();
  throw new Error("PostgreSQL app server did not start");
};
const stop = async (child: ReturnType<typeof spawn>) => {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill(); });
};
const login = async () => {
  const response = await fetch(B + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "pg-persist@test.com", password: "senha-forte-1" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0];
};

before(async () => {
  if (!testDatabaseConfigured) return;
  await prepareTestDatabase();
  server = await start();
});
after(async () => {
  if (server) await stop(server);
  if (testDatabaseConfigured) await cleanTestDatabase();
});

test("PostgreSQL mantém clientes, eventos, financeiro e equipe após nova conexão e reinicialização", async () => {
  let cookie = await login();
  const headers = { "content-type": "application/json", cookie };
  const clientResponse = await fetch(B + "/api/clients", { method: "POST", headers, body: JSON.stringify({ name: "Persistente PG", email: "pg@example.test" }) });
  assert.equal(clientResponse.status, 201);
  const client = await clientResponse.json() as any;
  const eventResponse = await fetch(B + "/api/events", {
    method: "POST", headers,
    body: JSON.stringify({ name: "Evento PostgreSQL", date: "2027-01-05", start_time: "10:00", client_id: client.id, venue: "Sala PG", status: "confirmado", repertoire: [{ moment: "entrada", title: "Música PG" }] }),
  });
  assert.equal(eventResponse.status, 201);
  const event = await eventResponse.json() as any;
  const financeResponse = await fetch(B + "/api/finances", {
    method: "POST", headers,
    body: JSON.stringify({ event_id: event.id, description: "Sinal PG", amount: 450, due_date: "2027-01-01", status: "pendente", installment: "1 de 2" }),
  });
  assert.equal(financeResponse.status, 201);
  const finance = await financeResponse.json() as any;
  const teamResponse = await fetch(B + "/api/team", { method: "POST", headers, body: JSON.stringify({ name: "Integrante PG", role: "Músico", phone: "41999990000" }) });
  assert.equal(teamResponse.status, 201);
  const member = await teamResponse.json() as any;

  // Independent PostgreSQL connection confirms data is committed and visible.
  assert.equal(Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM events WHERE id=?", event.id)).rows[0].n), 1);
  assert.equal((await queryTestDatabase("SELECT client_id FROM events WHERE id=?", event.id)).rows[0].client_id, String(client.id));
  await stop(server!);
  server = await start();
  cookie = await login();
  const persistedEvent = await fetch(B + "/api/events/" + event.id, { headers: { cookie } }).then((r) => r.json()) as any;
  assert.equal(persistedEvent.name, "Evento PostgreSQL");
  assert.equal(persistedEvent.client_name, "Persistente PG");
  assert.equal(persistedEvent.repertoire[0].title, "Música PG");
  const persistedFinance = await fetch(B + "/api/finances", { headers: { cookie } }).then((r) => r.json()) as any;
  assert.equal(persistedFinance.items.find((item: any) => item.id == finance.id)?.description, "Sinal PG");
  const persistedTeam = await fetch(B + "/api/team", { headers: { cookie } }).then((r) => r.json()) as any[];
  assert.equal(persistedTeam.find((item) => item.id == member.id)?.role, "Músico");
  assert.equal((await fetch(B + "/api/clients", { headers: { cookie } }).then((r) => r.json()) as any[]).some((item) => item.id == client.id), true);
});

test("PostgreSQL transações preservam integridade sob gravações concorrentes", async () => {
  const cookie = await login();
  const headers = { "content-type": "application/json", cookie };
  const client = await fetch(B + "/api/clients", { method: "POST", headers, body: JSON.stringify({ name: "Concorrência PG" }) }).then((r) => r.json()) as any;
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => fetch(B + "/api/events", {
    method: "POST", headers,
    body: JSON.stringify({ name: "Evento concorrente " + index, date: "2027-02-01", start_time: "12:" + String(index).padStart(2, "0"), client_id: client.id, venue: "Sala", status: "confirmado", repertoire: [{ moment: "entrada", title: "Música " + index }] }),
  })));
  assert.ok(results.every((response) => response.status === 201));
  const rows = await queryTestDatabase("SELECT COUNT(*)::int n FROM events WHERE client_id=?", client.id);
  assert.equal(Number(rows.rows[0].n), 8);
});
