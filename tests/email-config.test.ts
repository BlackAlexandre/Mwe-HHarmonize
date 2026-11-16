import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { logEmailConfiguration } from "../email-service.js";
import { testDatabaseConfigured, prepareTestDatabase, queryTestDatabase, cleanTestDatabase } from "./postgres-test.js";

const port = 3922;
const base = `http://localhost:${port}`;
const databaseTest = (name: string, fn: (...args: any[]) => any) => nodeTest(name, { skip: !testDatabaseConfigured }, fn as any);
let server: ReturnType<typeof spawn>;

const request = async (method: string, path: string, body?: unknown, cookie = "") => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
};

before(async () => {
  if (!testDatabaseConfigured) return;
  await prepareTestDatabase();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATABASE_URL: process.env.MWE_TEST_DATABASE_URL, ADMIN_EMAIL: "email-admin@test.com", ADMIN_PASSWORD: "email-admin-password-1" };
  delete env.BREVO_API_KEY;
  delete env.EMAIL_FROM;
  delete env.APP_URL;
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], { env, stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${base}/api/auth/me`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Servidor de teste de e-mail não iniciou");
});

after(async () => {
  if (server?.exitCode === null) {
    server.kill();
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  }
  if (testDatabaseConfigured) await cleanTestDatabase();
});

databaseTest("sem configuração Brevo, recuperação e convite informam indisponibilidade sem criar token", async () => {
  const known = await request("POST", "/api/auth/forgot", { email: "email-admin@test.com" });
  const unknown = await request("POST", "/api/auth/forgot", { email: "ausente@test.com" });
  assert.equal(known.status, 503);
  assert.deepEqual(known.body, unknown.body, "resposta sem configuração não enumera contas");
  assert.equal(JSON.stringify(known.body).includes("BREVO_API_KEY"), false);

  const login = await request("POST", "/api/auth/login", { email: "email-admin@test.com", password: "email-admin-password-1" });
  assert.equal(login.status, 200);
  const invitation = await request("POST", "/api/admin/invitations", { name: "Convidado", email: "convidado@test.com", role: "collaborator" }, login.cookie);
  assert.equal(invitation.status, 503);
  assert.equal(JSON.stringify(invitation.body).includes("BREVO_API_KEY"), false);

  assert.equal(Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM resets")).rows[0].n), 0);
  assert.equal(Number((await queryTestDatabase("SELECT COUNT(*)::int n FROM invitations")).rows[0].n), 0);
});

nodeTest("diagnóstico de inicialização identifica APP_URL HTTP em produção sem revelar valores", () => {
  const keys = ["BREVO_API_KEY", "EMAIL_FROM", "APP_URL", "NODE_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const output: string[] = [];
  const info = console.info;
  const warn = console.warn;
  process.env.BREVO_API_KEY = "mock-diagnostic-key-for-tests";
  process.env.EMAIL_FROM = "MWE Test <sender@example.test>";
  process.env.APP_URL = "http://localhost:3000";
  process.env.NODE_ENV = "production";
  const capture = (...values: unknown[]) => output.push(`${String(values[0])} ${JSON.stringify(values[1])}`);
  console.info = capture;
  console.warn = capture;
  try {
    logEmailConfiguration();
  } finally {
    console.info = info;
    console.warn = warn;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  const text = output.join("\n");
  assert.match(text, /"BREVO_API_KEY":"configurada"/);
  assert.match(text, /"EMAIL_FROM":"configurado"/);
  assert.match(text, /"APP_URL":"configurada"/);
  assert.match(text, /APP_URL precisa usar HTTPS quando NODE_ENV=production/);
  assert.equal(text.includes("mock-diagnostic-key-for-tests"), false);
  assert.equal(text.includes("sender@example.test"), false);
  assert.equal(text.includes("http://localhost:3000"), false);
});
