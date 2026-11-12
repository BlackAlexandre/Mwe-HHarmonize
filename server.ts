import express from "express";
import nodemailer from "nodemailer";
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

// MigraÃ§Ã£o segura e aditiva: sÃ³ acrescenta colunas/tabelas que ainda nÃ£o existem.
const evCols = all("PRAGMA table_info(events)").map((c) => c.name);
for (const [c, t] of [
  ["end_time", "TEXT"],
  ["attire", "TEXT"],
  ["crew_arrival", "TEXT"],
  ["venue_contact", "TEXT"],
  ["critical_notes", "TEXT"],
  ["contract_value", "REAL"],
])
  if (!evCols.includes(c)) db.exec(`ALTER TABLE events ADD COLUMN ${c} ${t}`);
db.exec(`CREATE TABLE IF NOT EXISTS repertoire(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,moment TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL,performer TEXT,notes TEXT);
CREATE INDEX IF NOT EXISTS rep_event ON repertoire(event_id);`);
// Equipe: tabela nova e aditiva (nenhum dado existente Ã© alterado)
db.exec(
  `CREATE TABLE IF NOT EXISTS integrantes_equipe(id INTEGER PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ativo',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`,
);

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

// ---------- AutenticaÃ§Ã£o ----------
app.post("/api/auth/login", (req, res) => {
  const { email = "", password = "", remember } = req.body || {};
  if (limited(req.ip + email))
    return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const u = one(
    "SELECT * FROM users WHERE email=?",
    String(email).toLowerCase().trim(),
  );
  if (!u || !checkPw(String(password), u.hash))
    return fail(res, 401, "E-mail ou senha invÃ¡lidos.");
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
  if (!s || s.expires < now()) return fail(res, 401, "NÃ£o autenticado.");
  req.user = s;
  next();
};
app.get("/api/auth/me", auth, (req: any, res) => res.json(req.user));
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;
app.post("/api/auth/forgot", (req, res) => {
  const email = String(req.body?.email || "")
    .toLowerCase()
    .trim();
  const u = one("SELECT id FROM users WHERE email=?", email);
  if (u) {
    const t = randomBytes(32).toString("hex");
    run("INSERT INTO resets VALUES(?,?,?)", sha(t), u.id, now() + 36e5);
    const link = `${process.env.APP_URL || "http://localhost:3000"}/#/reset?token=${t}`;
    if (mailer)
      mailer
        .sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: "RecuperaÃ§Ã£o de acesso â€” Harmonize",
          text: `Para criar uma nova senha, acesse (vÃ¡lido por 1 hora):\n${link}`,
        })
        .catch((e: any) =>
          console.error("Falha ao enviar e-mail de recuperaÃ§Ã£o:", e.message),
        );
    else if (process.env.DEV_LOG_RESET_LINKS === "true" && !PROD)
      console.log("[DEV] link de recuperaÃ§Ã£o:", link);
    else
      console.warn(
        "SMTP nÃ£o configurado: e-mail de recuperaÃ§Ã£o NÃƒO foi enviado.",
      );
  }
  res.json({
    ok: true,
    message:
      "Se o e-mail estiver cadastrado, vocÃª receberÃ¡ as instruÃ§Ãµes de recuperaÃ§Ã£o.",
  });
});
app.post("/api/auth/reset", (req, res) => {
  const { token = "", password = "" } = req.body || {};
  if (String(password).length < 8)
    return fail(res, 400, "A senha deve ter ao menos 8 caracteres.");
  const r = one("SELECT * FROM resets WHERE token=?", sha(String(token)));
  if (!r || r.expires < now())
    return fail(res, 400, "Link invÃ¡lido ou expirado.");
  run("UPDATE users SET hash=? WHERE id=?", hashPw(password), r.user_id);
  run("DELETE FROM resets WHERE user_id=?", r.user_id);
  run("DELETE FROM sessions WHERE user_id=?", r.user_id);
  res.json({ ok: true });
});
app.use("/api/account", auth);
app.put("/api/account", (req: any, res) => {
  const name = String(req.body?.name || "").trim(),
    email = String(req.body?.email || "")
      .toLowerCase()
      .trim(),
    f: any = {};
  if (!name) f.name = "Informe o nome.";
  if (!/^\S+@\S+\.\S+$/.test(email)) f.email = "E-mail invÃ¡lido.";
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (one("SELECT id FROM users WHERE email=? AND id<>?", email, req.user.id))
    return fail(res, 409, "Este e-mail jÃ¡ estÃ¡ em uso.", {
      email: "Este e-mail jÃ¡ estÃ¡ em uso.",
    });
  run("UPDATE users SET name=?,email=? WHERE id=?", name, email, req.user.id);
  res.json({ id: req.user.id, name, email });
});
app.put("/api/account/password", (req: any, res) => {
  const { current = "", password = "", confirm = "" } = req.body || {},
    u = one("SELECT * FROM users WHERE id=?", req.user.id);
  if (!checkPw(String(current), u.hash))
    return fail(res, 403, "Senha atual incorreta.");
  if (String(password).length < 8)
    return fail(res, 422, "A nova senha deve ter ao menos 8 caracteres.");
  if (password !== confirm)
    return fail(res, 422, "A confirmaÃ§Ã£o nÃ£o confere com a nova senha.");
  run("UPDATE users SET hash=? WHERE id=?", hashPw(password), u.id);
  run(
    "DELETE FROM sessions WHERE user_id=? AND token<>?",
    u.id,
    sha(cookie(req, "sid")),
  );
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
  if (b?.email && !/^\S+@\S+\.\S+$/.test(b.email)) f.email = "E-mail invÃ¡lido.";
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
      `SELECT c.*,(SELECT COUNT(*) FROM events e WHERE e.client_id=c.id) n, (SELECT type FROM events e WHERE e.client_id=c.id ORDER BY e.date DESC LIMIT 1) ev_type, (SELECT status FROM events e WHERE e.client_id=c.id ORDER BY e.date DESC LIMIT 1) ev_status, (SELECT date FROM events e WHERE e.client_id=c.id ORDER BY e.date DESC LIMIT 1) ev_date, (SELECT venue FROM events e WHERE e.client_id=c.id ORDER BY e.date DESC LIMIT 1) ev_venue FROM clients c WHERE (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?) ${(req.query as any).status === "sem" ? "AND NOT EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id)" : STATUS.includes((req.query as any).status) ? "AND EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id AND e.status='" + (req.query as any).status + "')" : ""} ORDER BY ${sort}`,
      q,
      q,
      q,
    ),
  );
});
app.post("/api/clients", (req, res) => {
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
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
    return fail(res, 404, "Cliente nÃ£o encontrado.");
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
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
  "end_time",
  "attire",
  "crew_arrival",
  "venue_contact",
  "critical_notes",
  "contract_value",
];
const STATUS = [
  "rascunho",
  "pendente",
  "preparacao",
  "confirmado",
  "concluido",
  "cancelado",
];
const MOMENTS = ["entrada", "assinaturas", "saida", "coquetel", "outro"];
const evalid = (b: any) => {
  const f: any = {},
    st = b?.status || "rascunho";
  if (!b?.name?.trim()) f.name = "Informe o nome do evento.";
  if (!STATUS.includes(st)) f.status = "Status invÃ¡lido.";
  if (b?.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) f.date = "Data invÃ¡lida.";
  if (b?.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time))
    f.start_time = "HorÃ¡rio invÃ¡lido.";
  if (b?.client_id && !one("SELECT id FROM clients WHERE id=?", b.client_id))
    f.client_id = "Cliente inexistente.";
  if (b?.uf && !/^[A-Za-z]{2}$/.test(b.uf)) f.uf = "UF invÃ¡lida.";
  if (st !== "rascunho")
    for (const [k, m] of [
      ["date", "Informe a data."],
      ["start_time", "Informe o horÃ¡rio."],
      ["client_id", "Selecione o cliente."],
      ["venue", "Informe o local."],
    ])
      if (!b?.[k]) f[k] = f[k] || m;
  if (b?.end_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end_time))
    f.end_time = "HorÃ¡rio final invÃ¡lido.";
  if (
    b?.contract_value != null &&
    b.contract_value !== "" &&
    !(Number(b.contract_value) >= 0)
  )
    f.contract_value = "Valor invÃ¡lido.";
  if (
    b?.repertoire !== undefined &&
    (!Array.isArray(b.repertoire) ||
      b.repertoire.some(
        (r: any) => !r?.title?.trim() || !MOMENTS.includes(r.moment),
      ))
  )
    f.repertoire = "RepertÃ³rio invÃ¡lido: informe momento e mÃºsica.";
  return f;
};
const withRep = (x: any) => ({
  ...x,
  repertoire: all(
    "SELECT moment,title,performer,notes FROM repertoire WHERE event_id=? ORDER BY position,id",
    x.id,
  ),
});
const saveRep = (id: number, rep: any) => {
  if (!Array.isArray(rep)) return;
  db.exec("BEGIN");
  try {
    run("DELETE FROM repertoire WHERE event_id=?", id);
    rep.forEach((r: any, i: number) =>
      run(
        "INSERT INTO repertoire(event_id,moment,position,title,performer,notes) VALUES(?,?,?,?,?,?)",
        id,
        r.moment,
        i,
        r.title.trim(),
        r.performer?.trim() || null,
        r.notes?.trim() || null,
      ),
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};
const EQ =
  "SELECT e.*,c.name client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id";
const vals = (b: any) =>
  pick(
    { ...b, status: b.status || "rascunho", uf: b.uf?.toUpperCase?.() ?? b.uf },
    EF,
  );
app.use("/api/events", (req: any, res, next) => {
  const b = req.body;
  if (
    ["POST", "PUT"].includes(req.method) &&
    b?.name &&
    b?.date &&
    (b.status || "rascunho") !== "rascunho" &&
    !Object.keys(evalid(b)).length &&
    one(
      "SELECT id FROM events WHERE lower(name)=lower(?) AND date=? AND IFNULL(start_time,'')=? AND IFNULL(client_id,0)=? AND id<>?",
      String(b.name).trim(),
      b.date,
      b.start_time || "",
      Number(b.client_id) || 0,
      Number(req.path.slice(1)) || 0,
    )
  )
    return fail(
      res,
      409,
      "JÃ¡ existe um evento com o mesmo nome, data, horÃ¡rio e cliente.",
    );
  next();
});
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
  x ? res.json(withRep(x)) : fail(res, 404, "Evento nÃ£o encontrado.");
});
app.post("/api/events", (req, res) => {
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  const r = run(
    `INSERT INTO events(${EF.join(",")}) VALUES(${EF.map(() => "?").join(",")})`,
    ...vals(req.body),
  );
  const id = Number(r.lastInsertRowid);
  saveRep(id, req.body.repertoire);
  res.status(201).json(withRep(one(`${EQ} WHERE e.id=?`, id)));
});
app.put("/api/events/:id", (req, res) => {
  if (!one("SELECT id FROM events WHERE id=?", req.params.id))
    return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  run(
    `UPDATE events SET ${EF.map((k) => k + "=?").join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ...vals(req.body),
    req.params.id,
  );
  saveRep(Number(req.params.id), req.body.repertoire);
  res.json(withRep(one(`${EQ} WHERE e.id=?`, req.params.id)));
});
app.patch("/api/events/:id/status", (req, res) => {
  const x = one("SELECT * FROM events WHERE id=?", req.params.id);
  if (!x) return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = evalid({ ...x, status: req.body?.status });
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
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

app.get("/api/overview", auth, (_q, res) => {
  const d = new Date(),
    today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  res.json({
    events: one("SELECT COUNT(*) n FROM events").n,
    clients: one("SELECT COUNT(*) n FROM clients").n,
    byStatus: all("SELECT status,COUNT(*) n FROM events GROUP BY status"),
    upcoming: all(
      `${EQ} WHERE e.date>=? AND e.status NOT IN ('cancelado','rascunho') ORDER BY e.date,e.start_time LIMIT 5`,
      today,
    ),
  });
});
// ---------- Equipe (integraÃ§Ã£o das pÃ¡ginas do Wesley) ----------
const TEAM_ROLES = ["MÃºsico", "TÃ©cnico", "MÃ­dia", "Administrativo"];
const TQ =
  "SELECT id,name,role,phone,status,created_at FROM integrantes_equipe";
const tval = (b: any) => {
  const f: any = {};
  if (!String(b?.name ?? "").trim()) f.name = "Informe o nome completo.";
  if (!TEAM_ROLES.includes(b?.role)) f.role = "Selecione uma funÃ§Ã£o vÃ¡lida.";
  if (String(b?.phone ?? "").replace(/\D/g, "").length < 8)
    f.phone = "Informe um telefone vÃ¡lido.";
  if (b?.status !== undefined && !["ativo", "inativo"].includes(b.status))
    f.status = "Status invÃ¡lido.";
  return f;
};
const tdup = (b: any, id = 0) =>
  one(
    "SELECT id FROM integrantes_equipe WHERE lower(name)=lower(?) AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','')=? AND id<>?",
    String(b.name).trim(),
    String(b.phone).replace(/[\s\-()]/g, ""),
    id,
  );
app.use("/api/team", auth);
app.get("/api/team", (_q, res) =>
  res.json(all(`${TQ} ORDER BY name COLLATE NOCASE`)),
);
app.post("/api/team", (req, res) => {
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (tdup(req.body))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body,
    r = run(
      "INSERT INTO integrantes_equipe(name,role,phone,status) VALUES(?,?,?,?)",
      String(b.name).trim(),
      b.role,
      String(b.phone).trim(),
      b.status || "ativo",
    );
  res.status(201).json(one(`${TQ} WHERE id=?`, Number(r.lastInsertRowid)));
});
app.put("/api/team/:id", (req, res) => {
  if (!one("SELECT id FROM integrantes_equipe WHERE id=?", req.params.id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (tdup(req.body, Number(req.params.id)))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body;
  run(
    "UPDATE integrantes_equipe SET name=?,role=?,phone=?,status=? WHERE id=?",
    String(b.name).trim(),
    b.role,
    String(b.phone).trim(),
    b.status || "ativo",
    req.params.id,
  );
  res.json(one(`${TQ} WHERE id=?`, req.params.id));
});
app.delete("/api/team/:id", (req, res) => {
  if (!one("SELECT id FROM integrantes_equipe WHERE id=?", req.params.id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  run("DELETE FROM integrantes_equipe WHERE id=?", req.params.id);
  res.json({ ok: true });
});

app.use("/api", (_q, res) => fail(res, 404, "Rota nÃ£o encontrada."));
app.get("/", (_req, res) => { res.sendFile("index.html", { root: "public" }); });
app.use(express.static("public"));
app.use((e: any, _q: any, res: any, _n: any) => {
  console.error(e);
  fail(
    res,
    e.status || 500,
    e.status ? "RequisiÃ§Ã£o invÃ¡lida." : "Erro interno.",
  );
});
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () =>
  console.log(`MWE Harmonize em http://localhost:${PORT}`),
);


