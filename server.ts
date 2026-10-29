import express from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

const db = new DatabaseSync(process.env.DB_FILE || "harmonize.db");
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT,phone TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT,date TEXT,start_time TEXT,client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,contact TEXT,venue TEXT,city TEXT,uf TEXT,lineup TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'rascunho',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ev_date ON events(date);`);

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const hashPw = (p: string) => {
  const s = randomBytes(16).toString("hex");
  return `${s}:${scryptSync(p, s, 64).toString("hex")}`;
};
const checkPw = (p: string, st: string) => {
  const [s, h] = st.split(":");
  return timingSafeEqual(Buffer.from(h, "hex"), scryptSync(p, s, 64));
};
const now = () => Date.now();
const all = (sql: string, ...a: any[]): any[] =>
  db.prepare(sql).all(...a) as any[];
const one = (sql: string, ...a: any[]): any => db.prepare(sql).get(...a);
const run = (sql: string, ...a: any[]) => db.prepare(sql).run(...a);

if (
  !one("SELECT id FROM users") &&
  process.env.ADMIN_EMAIL &&
  process.env.ADMIN_PASSWORD
)
  run(
    "INSERT INTO users(email,name,hash) VALUES(?,?,?)",
    process.env.ADMIN_EMAIL.toLowerCase(),
    process.env.ADMIN_NAME || "Administrador",
    hashPw(process.env.ADMIN_PASSWORD),
  );

const PROD = process.env.NODE_ENV === "production";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
const fail = (res: any, c: number, error: string, fields?: any) =>
  res.status(c).json({ error, fields });
const cookie = (req: any, k: string) =>
  (req.headers.cookie || "")
    .split(/;\s*/)
    .map((c: string) => c.split("="))
    .find((p: string[]) => p[0] === k)?.[1];
const tries = new Map<string, number[]>();
const limited = (k: string) => {
  const t = (tries.get(k) || []).filter((x) => x > now() - 9e5);
  t.push(now());
  tries.set(k, t);
  return t.length > 10;
};

// ---------- Autenticação ----------
app.post("/api/auth/login", (req, res) => {
  const { email = "", password = "", remember } = req.body || {};
  if (limited(req.ip + email))
    return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const u = one(
    "SELECT * FROM users WHERE email=?",
    String(email).toLowerCase().trim(),
  );
  if (!u || !checkPw(String(password), u.hash))
    return fail(res, 401, "E-mail ou senha inválidos.");
  const t = randomBytes(32).toString("hex"),
    ttl = remember ? 30 * 864e5 : 12 * 36e5;
  run("INSERT INTO sessions VALUES(?,?,?)", sha(t), u.id, now() + ttl);
  res.setHeader(
    "Set-Cookie",
    `sid=${t}; HttpOnly; SameSite=Lax; Path=/${PROD ? "; Secure" : ""}${remember ? `; Max-Age=${ttl / 1000}` : ""}`,
  );
  res.json({ id: u.id, name: u.name, email: u.email });
});
app.post("/api/auth/logout", (req, res) => {
  const t = cookie(req, "sid");
  if (t) run("DELETE FROM sessions WHERE token=?", sha(t));
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
const auth = (req: any, res: any, next: any) => {
  const t = cookie(req, "sid");
  const s =
    t &&
    one(
      "SELECT u.id,u.name,u.email,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
      sha(t),
    );
  if (!s || s.expires < now()) return fail(res, 401, "Não autenticado.");
  req.user = s;
  next();
};
app.get("/api/auth/me", auth, (req: any, res) => res.json(req.user));
app.post("/api/auth/forgot", (req, res) => {
  const u = one(
    "SELECT id FROM users WHERE email=?",
    String(req.body?.email || "")
      .toLowerCase()
      .trim(),
  );
  let devLink;
  if (u) {
    const t = randomBytes(32).toString("hex");
    run("INSERT INTO resets VALUES(?,?,?)", sha(t), u.id, now() + 36e5);
    const link = `${process.env.APP_URL || "http://localhost:3000"}/#/reset?token=${t}`;
    console.log("[recuperação de acesso] enviar ao usuário:", link); // TODO: integrar SMTP (ver README)
    if (!PROD) devLink = link;
  }
  res.json({
    ok: true,
    message: "Se o e-mail estiver cadastrado, enviaremos as instruções.",
    devLink,
  });
});
app.post("/api/auth/reset", (req, res) => {
  const { token = "", password = "" } = req.body || {};
  if (String(password).length < 8)
    return fail(res, 400, "A senha deve ter ao menos 8 caracteres.");
  const r = one("SELECT * FROM resets WHERE token=?", sha(String(token)));
  if (!r || r.expires < now())
    return fail(res, 400, "Link inválido ou expirado.");
  run("UPDATE users SET hash=? WHERE id=?", hashPw(password), r.user_id);
  run("DELETE FROM resets WHERE user_id=?", r.user_id);
  run("DELETE FROM sessions WHERE user_id=?", r.user_id);
  res.json({ ok: true });
});
app.use("/api/clients", auth);
app.use("/api/events", auth);

// ---------- Clientes ----------
const pick = (b: any, keys: string[]) =>
  keys.map((k) => {
    const v = b?.[k];
    return v === undefined || v === ""
      ? null
      : typeof v === "string"
        ? v.trim()
        : v;
  });
const CF = ["name", "email", "phone", "notes"];
const cval = (b: any) => {
  const f: any = {};
  if (!b?.name?.trim()) f.name = "Informe o nome.";
  if (b?.email && !/^\S+@\S+\.\S+$/.test(b.email)) f.email = "E-mail inválido.";
  return f;
};
app.get("/api/clients", (req, res) => {
  const q = `%${req.query.q || ""}%`,
    sort =
      ({ name: "c.name", recent: "c.id DESC", events: "n DESC" } as any)[
        req.query.sort as string
      ] || "c.name";
  res.json(
    all(
      `SELECT c.*,(SELECT COUNT(*) FROM events e WHERE e.client_id=c.id) n FROM clients c WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? ORDER BY ${sort}`,
      q,
      q,
      q,
    ),
  );
});
app.post("/api/clients", (req, res) => {
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  const r = run(
    "INSERT INTO clients(name,email,phone,notes) VALUES(?,?,?,?)",
    ...pick(req.body, CF),
  );
  res
    .status(201)
    .json(one("SELECT * FROM clients WHERE id=?", Number(r.lastInsertRowid)));
});
app.put("/api/clients/:id", (req, res) => {
  if (!one("SELECT id FROM clients WHERE id=?", req.params.id))
    return fail(res, 404, "Cliente não encontrado.");
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  run(
    "UPDATE clients SET name=?,email=?,phone=?,notes=? WHERE id=?",
    ...pick(req.body, CF),
    req.params.id,
  );
  res.json(one("SELECT * FROM clients WHERE id=?", req.params.id));
});
app.delete("/api/clients/:id", (req, res) => {
  const n = one(
    "SELECT COUNT(*) n FROM events WHERE client_id=?",
    req.params.id,
  ).n;
  if (n)
    return fail(
      res,
      409,
      `Cliente possui ${n} evento(s) vinculado(s). Exclua ou reatribua os eventos antes.`,
    );
  run("DELETE FROM clients WHERE id=?", req.params.id);
  res.json({ ok: true });
});

// ---------- Eventos ----------
const EF = [
  "name",
  "type",
  "date",
  "start_time",
  "client_id",
  "contact",
  "venue",
  "city",
  "uf",
  "lineup",
  "notes",
  "status",
];
const STATUS = ["rascunho", "pendente", "confirmado", "concluido", "cancelado"];
const evalid = (b: any) => {
  const f: any = {},
    st = b?.status || "rascunho";
  if (!b?.name?.trim()) f.name = "Informe o nome do evento.";
  if (!STATUS.includes(st)) f.status = "Status inválido.";
  if (b?.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) f.date = "Data inválida.";
  if (b?.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time))
    f.start_time = "Horário inválido.";
  if (b?.client_id && !one("SELECT id FROM clients WHERE id=?", b.client_id))
    f.client_id = "Cliente inexistente.";
  if (b?.uf && !/^[A-Za-z]{2}$/.test(b.uf)) f.uf = "UF inválida.";
  if (st !== "rascunho")
    for (const [k, m] of [
      ["date", "Informe a data."],
      ["start_time", "Informe o horário."],
      ["client_id", "Selecione o cliente."],
      ["venue", "Informe o local."],
    ])
      if (!b?.[k]) f[k] = f[k] || m;
  return f;
};
const EQ =
  "SELECT e.*,c.name client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id";
const vals = (b: any) =>
  pick(
    { ...b, status: b.status || "rascunho", uf: b.uf?.toUpperCase?.() ?? b.uf },
    EF,
  );
app.get("/api/events", (req, res) => {
  const { q, status, from, to } = req.query as any,
    w: string[] = [],
    a: any[] = [];
  if (q) {
    w.push(
      "(e.name LIKE ? OR c.name LIKE ? OR e.venue LIKE ? OR e.city LIKE ?)",
    );
    const l = `%${q}%`;
    a.push(l, l, l, l);
  }
  if (status) {
    w.push("e.status=?");
    a.push(status);
  }
  if (from) {
    w.push("e.date>=?");
    a.push(from);
  }
  if (to) {
    w.push("e.date<=?");
    a.push(to);
  }
  res.json(
    all(
      `${EQ}${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY e.date IS NULL,e.date,e.start_time`,
      ...a,
    ),
  );
});
app.get("/api/events/:id", (req, res) => {
  const x = one(`${EQ} WHERE e.id=?`, req.params.id);
  x ? res.json(x) : fail(res, 404, "Evento não encontrado.");
});
app.post("/api/events", (req, res) => {
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  const r = run(
    `INSERT INTO events(${EF.join(",")}) VALUES(${EF.map(() => "?").join(",")})`,
    ...vals(req.body),
  );
  res.status(201).json(one(`${EQ} WHERE e.id=?`, Number(r.lastInsertRowid)));
});
app.put("/api/events/:id", (req, res) => {
  if (!one("SELECT id FROM events WHERE id=?", req.params.id))
    return fail(res, 404, "Evento não encontrado.");
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  run(
    `UPDATE events SET ${EF.map((k) => k + "=?").join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ...vals(req.body),
    req.params.id,
  );
  res.json(one(`${EQ} WHERE e.id=?`, req.params.id));
});
app.patch("/api/events/:id/status", (req, res) => {
  const x = one("SELECT * FROM events WHERE id=?", req.params.id);
  if (!x) return fail(res, 404, "Evento não encontrado.");
  const f = evalid({ ...x, status: req.body?.status });
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  run(
    "UPDATE events SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    req.body.status,
    req.params.id,
  );
  res.json(one(`${EQ} WHERE e.id=?`, req.params.id));
});
app.delete("/api/events/:id", (req, res) => {
  run("DELETE FROM events WHERE id=?", req.params.id);
  res.json({ ok: true });
});

app.use("/api", (_q, res) => fail(res, 404, "Rota não encontrada."));
app.use(express.static("public"));
app.use((e: any, _q: any, res: any, _n: any) => {
  console.error(e);
  fail(
    res,
    e.status || 500,
    e.status ? "Requisição inválida." : "Erro interno.",
  );
});
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () =>
  console.log(`MWE Harmonize em http://localhost:${PORT}`),
);
