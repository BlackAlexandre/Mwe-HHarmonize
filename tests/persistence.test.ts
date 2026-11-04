import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
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
  await stop(s);
});
