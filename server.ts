import express from "express";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { emailIsConfigured, emailLink, logEmailConfiguration, logEmailFailure, sendEmail } from "./email-service.js";
logEmailConfiguration();

declare global {
  namespace Express {
    interface Request { user?: any }
  }
}

const dbPath = resolve(process.env.DB_FILE || "harmonize.db");
const db = new DatabaseSync(dbPath);
const hasOrganizationSchema = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organizations'").get();
const legacyUsersExist = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
if (existsSync(dbPath) && legacyUsersExist && !hasOrganizationSchema) {
  const users = Number((db.prepare("SELECT COUNT(*) n FROM users").get() as any).n);
  if (users > 1) throw new Error("Migração organizacional interrompida antes de alterar o banco: há mais de um usuário legado, portanto não é possível definir um administrador e uma organização sem uma decisão manual.");
  if (users === 0) {
    const populated = ["clients","events","finances","integrantes_equipe","team_members","event_members","payments","repertoire","repertoire_durations","repertoire_approvals","company_settings"]
      .some((table) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
        && Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n) > 0);
    if (populated) throw new Error("Migração organizacional interrompida antes de alterar o banco: existem dados sem um usuário administrador identificável.");
  }
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length) throw new Error(`Migração organizacional interrompida antes de alterar o banco: foram encontradas ${foreignKeyViolations.length} violação(ões) de chave estrangeira legado.`);
}
if (existsSync(dbPath) && !hasOrganizationSchema && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()) {
  const backupPath = join(dirname(dbPath), `${basename(dbPath)}.pre-org-${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const integrity = backup.prepare("PRAGMA integrity_check").get() as any;
  backup.close();
  if (integrity?.integrity_check !== "ok") throw new Error("Backup do SQLite não passou na verificação de integridade.");
}
db.exec(`PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY,actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id INTEGER,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT,phone TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT,date TEXT,start_time TEXT,client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,contact TEXT,venue TEXT,city TEXT,uf TEXT,lineup TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'rascunho',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ev_date ON events(date);`);
db.exec(`CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS resets_user_expiry ON resets(user_id,expires);
DELETE FROM sessions WHERE expires<=${Date.now()};
DELETE FROM resets WHERE expires<=${Date.now()};`);
db.exec("CREATE INDEX IF NOT EXISTS audit_actor_date ON security_audit(actor_user_id,created_at DESC)");

// Financeiro: tabela e índices adicionados sem alterar as tabelas existentes.
db.exec(`CREATE TABLE IF NOT EXISTS finances(
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  paid_date TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  installment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fin_event ON finances(event_id);
CREATE INDEX IF NOT EXISTS fin_due ON finances(due_date);
CREATE INDEX IF NOT EXISTS fin_status ON finances(status);`);
db.exec("UPDATE finances SET status='atrasado' WHERE status='pendente' AND due_date < date('now', 'localtime')");

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
const recordAudit = (actor: number | null, action: string, targetType = "user", targetId: number | null = actor) =>
  run("INSERT INTO security_audit(actor_user_id,organization_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?,?)", actor, actor ? one("SELECT organization_id FROM organization_members WHERE user_id=?", actor)?.organization_id ?? null : null, action, targetType, targetId, now());

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
const repCols = all("PRAGMA table_info(repertoire)").map((c) => c.name);
for (const [c, t] of [
  ["artist", "TEXT"],
  ["composer", "TEXT"],
  ["instrumentation", "TEXT"],
  ["reference_url", "TEXT"],
  ["owner_user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"],
])
  if (!repCols.includes(c)) db.exec(`ALTER TABLE repertoire ADD COLUMN ${c} ${t}`);
db.exec(`CREATE INDEX IF NOT EXISTS rep_owner_event ON repertoire(owner_user_id,event_id);
CREATE TABLE IF NOT EXISTS repertoire_durations(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  moment TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
  PRIMARY KEY(user_id,event_id,moment)
);
CREATE TABLE IF NOT EXISTS repertoire_approvals(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pendente','aprovado')),
  PRIMARY KEY(user_id,event_id)
);`);
db.exec(`CREATE TABLE IF NOT EXISTS company_settings(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  exibicao TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT NOT NULL,
  idioma TEXT NOT NULL DEFAULT 'pt-BR',
  moeda TEXT NOT NULL DEFAULT 'BRL',
  formato TEXT NOT NULL DEFAULT 'dd/mm/aaaa',
  fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  novosEventos INTEGER NOT NULL DEFAULT 1,
  vencimentos INTEGER NOT NULL DEFAULT 1,
  escalas INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
// Equipe: tabela nova e aditiva (nenhum dado existente Ã© alterado)
db.exec(
  `CREATE TABLE IF NOT EXISTS integrantes_equipe(id INTEGER PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ativo',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`,
);

if (!one("SELECT id FROM users") && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.length > 1024)
    throw new Error("ADMIN_PASSWORD deve conter entre 12 e 1024 caracteres na inicialização.");
  run(
    "INSERT INTO users(email,name,hash) VALUES(?,?,?)",
    process.env.ADMIN_EMAIL.toLowerCase(),
    process.env.ADMIN_NAME || "Administrador",
    hashPw(process.env.ADMIN_PASSWORD),
  );
}

// Tenant/RBAC migration. Existing data is assigned only when ownership is unambiguous.
const orgSchemaExists = !!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organizations'");
if (!orgSchemaExists) {
  const existingUsers = all("SELECT id FROM users ORDER BY id");
  if (existingUsers.length !== 1)
    throw new Error("Migração organizacional interrompida: é necessário exatamente um usuário legado para associar os dados. Nenhuma associação automática foi feita.");
  const ownerUserId = Number(existingUsers[0].id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE organization_members(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('admin','collaborator')),status TEXT NOT NULL CHECK(status IN ('active','pending','disabled','blocked')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_login_at INTEGER);
      CREATE TABLE permissions(name TEXT PRIMARY KEY,description TEXT NOT NULL);
      CREATE TABLE role_permissions(role TEXT NOT NULL CHECK(role IN ('admin','collaborator')),permission TEXT NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,PRIMARY KEY(role,permission));
      CREATE TABLE member_permissions(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,permission TEXT NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,granted INTEGER NOT NULL CHECK(granted IN (0,1)),PRIMARY KEY(user_id,permission));
      CREATE TABLE invitations(id INTEGER PRIMARY KEY,organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,email TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role='collaborator'),target_role TEXT NOT NULL DEFAULT 'collaborator' CHECK(target_role IN ('admin','collaborator')),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),accepted_at INTEGER,created_at INTEGER NOT NULL);
      CREATE INDEX organization_members_org ON organization_members(organization_id,status);
      CREATE INDEX invitations_org_expiry ON invitations(organization_id,expires_at);`);
    const orgResult = run("INSERT INTO organizations(name) VALUES(?)", `${process.env.ADMIN_NAME || "Administrador"} — Organização`);
    const organizationId = Number(orgResult.lastInsertRowid);
    run("INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(?,?,?,?)", ownerUserId, organizationId, "admin", "active");
    const permissionNames = ["users.view","users.create","users.edit","users.disable","users.delete","events.view","events.create","events.edit","events.delete","clients.view","clients.create","clients.edit","clients.delete","finance.view","finance.create","finance.edit","finance.delete","team.view","team.create","team.edit","team.delete","reports.view","repertoire.view","repertoire.edit","settings.view","settings.edit","audit.view"];
    const descriptions: Record<string,string> = {
      "users.view":"Listar colaboradores","users.create":"Convidar colaboradores","users.edit":"Editar colaboradores","users.disable":"Desativar colaboradores","users.delete":"Remover colaboradores",
      "events.view":"Consultar eventos","events.create":"Criar eventos","events.edit":"Editar eventos","events.delete":"Excluir eventos",
      "clients.view":"Consultar clientes","clients.create":"Criar clientes","clients.edit":"Editar clientes","clients.delete":"Excluir clientes",
      "finance.view":"Consultar financeiro","finance.create":"Criar lançamentos","finance.edit":"Editar lançamentos","finance.delete":"Excluir lançamentos",
      "team.view":"Consultar equipe","team.create":"Adicionar equipe","team.edit":"Editar equipe","team.delete":"Remover equipe",
      "reports.view":"Consultar relatórios","repertoire.view":"Consultar repertório","repertoire.edit":"Editar repertório","settings.view":"Consultar configurações","settings.edit":"Editar configurações","audit.view":"Consultar auditoria",
    };
    const insertPermission = db.prepare("INSERT INTO permissions(name,description) VALUES(?,?)");
    const insertRolePermission = db.prepare("INSERT INTO role_permissions(role,permission) VALUES(?,?)");
    for (const permission of permissionNames) {
      insertPermission.run(permission, descriptions[permission]);
      insertRolePermission.run("admin", permission);
    }
    for (const permission of ["events.view","events.create","events.edit","clients.view","clients.create","clients.edit","team.view","team.create","team.edit","finance.view","reports.view","repertoire.view","settings.view"])
      insertRolePermission.run("collaborator", permission);

    const addOrgColumn = (table: string) => {
      const columns = all(`PRAGMA table_info(${table})`).map((column) => column.name);
      if (!columns.includes("organization_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER REFERENCES organizations(id)`);
    };
    const tenantTables = ["clients","events","finances","integrantes_equipe","team_members","event_members","payments","repertoire","repertoire_durations","repertoire_approvals","company_settings"]
      .filter((table) => !!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table));
    for (const table of tenantTables) addOrgColumn(table);
    const auditCols = all("PRAGMA table_info(security_audit)").map((column) => column.name);
    if (!auditCols.includes("organization_id")) db.exec("ALTER TABLE security_audit ADD COLUMN organization_id INTEGER REFERENCES organizations(id)");
    for (const table of tenantTables) run(`UPDATE ${table} SET organization_id=? WHERE organization_id IS NULL`, organizationId);
    run("UPDATE security_audit SET organization_id=? WHERE organization_id IS NULL", organizationId);
    for (const table of tenantTables) {
      const missing = Number(one(`SELECT COUNT(*) n FROM ${table} WHERE organization_id IS NULL`).n);
      if (missing) throw new Error(`Migração interrompida: ${missing} registro(s) sem organização em ${table}.`);
      db.exec(`CREATE INDEX IF NOT EXISTS ${table}_org_id ON ${table}(organization_id)`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_organization_required_insert BEFORE INSERT ON ${table} WHEN NEW.organization_id IS NULL BEGIN SELECT RAISE(ABORT,'organization_id obrigatório'); END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_organization_required_update BEFORE UPDATE OF organization_id ON ${table} WHEN NEW.organization_id IS NULL BEGIN SELECT RAISE(ABORT,'organization_id obrigatório'); END`);
    }
    db.exec(`CREATE UNIQUE INDEX company_settings_org ON company_settings(organization_id);
      CREATE INDEX audit_org_date ON security_audit(organization_id,created_at DESC);
      CREATE TRIGGER events_client_same_org_insert BEFORE INSERT ON events WHEN NEW.client_id IS NOT NULL AND (SELECT organization_id FROM clients WHERE id=NEW.client_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'cliente pertence a outra organização'); END;
      CREATE TRIGGER events_client_same_org_update BEFORE UPDATE OF client_id,organization_id ON events WHEN NEW.client_id IS NOT NULL AND (SELECT organization_id FROM clients WHERE id=NEW.client_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'cliente pertence a outra organização'); END;
      CREATE TRIGGER finances_event_same_org_insert BEFORE INSERT ON finances WHEN NEW.event_id IS NOT NULL AND (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER finances_event_same_org_update BEFORE UPDATE OF event_id,organization_id ON finances WHEN NEW.event_id IS NOT NULL AND (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER repertoire_event_same_org_insert BEFORE INSERT ON repertoire WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER repertoire_event_same_org_update BEFORE UPDATE OF event_id,organization_id ON repertoire WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER duration_event_same_org_insert BEFORE INSERT ON repertoire_durations WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER approval_event_same_org_insert BEFORE INSERT ON repertoire_approvals WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;`);
    if (tenantTables.includes("payments")) db.exec(`CREATE TRIGGER payments_event_same_org_insert BEFORE INSERT ON payments WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;
      CREATE TRIGGER payments_event_same_org_update BEFORE UPDATE OF event_id,organization_id ON payments WHEN (SELECT organization_id FROM events WHERE id=NEW.event_id)<>NEW.organization_id BEGIN SELECT RAISE(ABORT,'evento pertence a outra organização'); END;`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Upgrade aditivo: convites legados continuam como colaboradores; novos convites podem salvar um dos perfis suportados.
const invitationColumns = all("PRAGMA table_info(invitations)").map((column) => column.name);
if (!invitationColumns.includes("target_role"))
  db.exec("ALTER TABLE invitations ADD COLUMN target_role TEXT NOT NULL DEFAULT 'collaborator' CHECK(target_role IN ('admin','collaborator'))");

const PROD = process.env.NODE_ENV === "production";
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({ limit: "100kb" }));
const fail = (res: any, c: number, error: string, fields?: any) =>
  res.status(c).json({ error, fields });
const cookie = (req: any, k: string) =>
  (req.headers.cookie || "")
    .split(/;\s*/)
    .map((c: string) => c.split("="))
    .find((p: string[]) => p[0] === k)?.[1];
const attempts = new Map<string, number[]>();
const limited = (key: string, maximum = 10, windowMs = 9e5) => {
  const current = now();
  if (attempts.size > 10000) {
    for (const [storedKey, times] of attempts)
      if (!times.some((time) => time > current - windowMs)) attempts.delete(storedKey);
    while (attempts.size > 10000) attempts.delete(attempts.keys().next().value!);
  }
  const recent = (attempts.get(key) || []).filter((time) => time > current - windowMs);
  if (recent.length >= maximum) { attempts.set(key, recent); return true; }
  recent.push(current);
  attempts.set(key, recent);
  return false;
};
const clearAttempts = (key: string) => attempts.delete(key);
const guardOrigin = (req: any, res: any, next: any) => {
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    if (new URL(origin).origin !== new URL(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).origin)
      return fail(res, 403, "Origem da requisição não permitida.");
  } catch { return fail(res, 403, "Origem da requisição inválida."); }
  next();
};
app.use("/api", (req: any, res: any, next: any) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return guardOrigin(req, res, next);
  next();
});

// ---------- AutenticaÃ§Ã£o ----------
app.post("/api/auth/login", (req, res) => {
  const { email = "", password = "", remember } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  const ipKey = `login:ip:${req.ip}`;
  const attemptKey = `login:pair:${req.ip}:${sha(normalizedEmail)}`;
  if (normalizedEmail.length > 254 || String(password).length > 1024 || limited(ipKey, 20) || limited(attemptKey, 10))
    return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const u = one(`SELECT u.*,m.organization_id,m.role,m.status membership_status
    FROM users u JOIN organization_members m ON m.user_id=u.id
    WHERE u.email=? AND m.status='active'`, normalizedEmail);
  let passwordMatches = false;
  try { if (u) passwordMatches = checkPw(String(password), u.hash); } catch { passwordMatches = false; }
  if (!u || !passwordMatches)
    return fail(res, 401, "E-mail ou senha invÃ¡lidos.");
  clearAttempts(ipKey);
  clearAttempts(attemptKey);
  db.prepare("DELETE FROM sessions WHERE expires<=?").run(now());
  const t = randomBytes(32).toString("hex"),
    ttl = remember === true ? 30 * 864e5 : 12 * 36e5;
  run("INSERT INTO sessions VALUES(?,?,?)", sha(t), u.id, now() + ttl);
  run("UPDATE organization_members SET last_login_at=? WHERE user_id=?", now(), u.id);
  recordAudit(u.id, "login.success");
  res.setHeader(
    "Set-Cookie",
    `sid=${t}; HttpOnly; SameSite=Lax; Path=/${PROD ? "; Secure" : ""}${remember ? `; Max-Age=${ttl / 1000}` : ""}`,
  );
  res.json({ id: u.id, name: u.name, email: u.email });
});
app.post("/api/auth/logout", (req, res) => {
  const t = cookie(req, "sid");
  if (t) {
    const session = one("SELECT user_id FROM sessions WHERE token=?", sha(t));
    if (session) recordAudit(session.user_id, "logout");
    run("DELETE FROM sessions WHERE token=?", sha(t));
  }
  res.setHeader("Set-Cookie", `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD ? "; Secure" : ""}`);
  res.json({ ok: true });
});
const auth = (req: any, res: any, next: any) => {
  res.setHeader("Cache-Control", "no-store");
  const t = cookie(req, "sid");
  const s =
    t &&
    one(
      `SELECT u.id,u.name,u.email,s.expires,m.organization_id,m.role,m.status
       FROM sessions s JOIN users u ON u.id=s.user_id
       JOIN organization_members m ON m.user_id=u.id
       WHERE s.token=? AND m.status='active'`,
      sha(t),
    );
  if (!s || s.expires <= now()) {
    if (t) run("DELETE FROM sessions WHERE token=?", sha(t));
    return fail(res, 401, "NÃ£o autenticado.");
  }
  req.user = s;
  next();
};
const requirePermission = (permission: string) => (req: any, res: any, next: any) => {
  if (req.user.role === "admin") return next();
  const override = one("SELECT granted FROM member_permissions WHERE user_id=? AND permission=?", req.user.id, permission);
  const granted = override ? Number(override.granted) === 1 : !!one("SELECT 1 FROM role_permissions WHERE role=? AND permission=?", req.user.role, permission);
  if (!granted) {
    recordAudit(req.user.id, "access.denied", "permission", null);
    return fail(res, 403, "Permissão insuficiente.");
  }
  next();
};
const modulePermissions = (module: string) => (req: any, res: any, next: any) => {
  const action = req.method === "GET" ? "view" : req.method === "POST" ? "create" : ["PUT","PATCH"].includes(req.method) ? "edit" : req.method === "DELETE" ? "delete" : "view";
  return requirePermission(`${module}.${action}`)(req, res, next);
};
app.use("/api", (req: any, res: any, next: any) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path.startsWith("/auth/") || req.path.startsWith("/account")) return next();
  res.once("finish", () => {
    if (!req.user || res.statusCode >= 400) return;
    const parts = req.path.split("/").filter(Boolean);
    const type = parts[0] || "resource";
    const possibleId = Number(parts[1]);
    try {
      recordAudit(req.user.id, `${req.method.toLowerCase()}.${type}`, type, Number.isSafeInteger(possibleId) && possibleId > 0 ? possibleId : null);
    } catch {
      console.error("Falha ao registrar auditoria da requisição.");
    }
  });
  next();
});
app.get("/api/auth/me", auth, (req: any, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email, organization_id: req.user.organization_id, role: req.user.role }));
const emailHtmlEscape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const recoveryMessage = "Se o endereço corresponder a uma conta, enviaremos as instruções quando o serviço de e-mail aceitar o envio. Se não receber o link, tente novamente em alguns minutos.";
app.post("/api/auth/forgot", async (req, res) => {
  if (!emailIsConfigured())
    return fail(res, 503, "A recuperação por e-mail está temporariamente indisponível. Tente novamente mais tarde.");
  if (limited(`forgot:ip:${req.ip}`, 5))
    return res.json({ message: recoveryMessage });
  const email = String(req.body?.email || "").slice(0, 254)
    .toLowerCase()
    .trim();
  const u = one("SELECT id FROM users WHERE email=?", email);
  if (u) {
    const t = randomBytes(32).toString("hex");
    run("DELETE FROM resets WHERE user_id=?", u.id);
    const tokenHash = sha(t);
    run("INSERT INTO resets VALUES(?,?,?)", tokenHash, u.id, now() + 36e5);
    try {
      await sendEmail({
        to: email,
        subject: "Recuperação de acesso — MWE Harmonize",
        htmlContent: `<p>Para criar uma nova senha, acesse o link abaixo. Ele é válido por 1 hora.</p><p><a href="${emailHtmlEscape(emailLink("reset", t))}">Redefinir senha</a></p>`,
      }, "password-recovery");
    } catch (error) {
      run("DELETE FROM resets WHERE token=?", tokenHash);
      logEmailFailure("password-recovery", error);
    }
  }
  res.json({ message: recoveryMessage });
});
app.post("/api/auth/reset", (req, res) => {
  const { token = "", password = "" } = req.body || {};
  if (limited(`reset:ip:${req.ip}`, 10)) return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  if (String(password).length < 12 || String(password).length > 1024)
    return fail(res, 400, "A senha deve ter ao menos 12 caracteres.");
  const r = one("SELECT * FROM resets WHERE token=?", sha(String(token)));
  if (!r || r.expires <= now())
    return fail(res, 400, "Link invÃ¡lido ou expirado.");
  run("UPDATE users SET hash=? WHERE id=?", hashPw(password), r.user_id);
  recordAudit(r.user_id, "password.reset");
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
  recordAudit(req.user.id, "account.updated");
  res.json({ id: req.user.id, name, email });
});
app.put("/api/account/password", (req: any, res) => {
  const { current = "", password = "", confirm = "" } = req.body || {},
    u = one("SELECT * FROM users WHERE id=?", req.user.id);
  if (!checkPw(String(current), u.hash))
    return fail(res, 403, "Senha atual incorreta.");
  if (String(password).length < 12)
    return fail(res, 422, "A nova senha deve ter ao menos 12 caracteres.");
  if (password !== confirm)
    return fail(res, 422, "A confirmaÃ§Ã£o nÃ£o confere com a nova senha.");
  run("UPDATE users SET hash=? WHERE id=?", hashPw(password), u.id);
  recordAudit(u.id, "password.changed");
  run("DELETE FROM resets WHERE user_id=?", u.id);
  run(
    "DELETE FROM sessions WHERE user_id=? AND token<>?",
    u.id,
    sha(cookie(req, "sid")),
  );
  res.json({ ok: true });
});
app.use("/api/clients", auth, modulePermissions("clients"));
app.use("/api/events", auth, modulePermissions("events"));
app.use("/api/finances", auth, modulePermissions("finance"));
app.use("/api/reports", auth, requirePermission("reports.view"));

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
      `SELECT c.*,(SELECT COUNT(*) FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id) n, (SELECT type FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_type, (SELECT status FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_status, (SELECT date FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_date, (SELECT venue FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_venue FROM clients c WHERE c.organization_id=? AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?) ${(req.query as any).status === "sem" ? "AND NOT EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id)" : STATUS.includes((req.query as any).status) ? "AND EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id AND e.status='" + (req.query as any).status + "')" : ""} ORDER BY ${sort}`,
      req.user.organization_id,
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
    "INSERT INTO clients(name,email,phone,notes,organization_id) VALUES(?,?,?,?,?)",
    ...pick(req.body, CF),
    req.user.organization_id,
  );
  res
    .status(201)
    .json(one("SELECT * FROM clients WHERE id=? AND organization_id=?", Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/clients/:id", (req, res) => {
  if (!one("SELECT id FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Cliente nÃ£o encontrado.");
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  run(
    "UPDATE clients SET name=?,email=?,phone=?,notes=? WHERE id=? AND organization_id=?",
    ...pick(req.body, CF),
    req.params.id,
    req.user.organization_id,
  );
  res.json(one("SELECT * FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id));
});
app.delete("/api/clients/:id", (req, res) => {
  const n = one(
    "SELECT COUNT(*) n FROM events WHERE client_id=? AND organization_id=?",
    req.params.id,
    req.user.organization_id,
  ).n;
  if (!one("SELECT id FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id)) return fail(res, 404, "Cliente não encontrado.");
  if (n)
    return fail(
      res,
      409,
      `Cliente possui ${n} evento(s) vinculado(s). Exclua ou reatribua os eventos antes.`,
    );
  run("DELETE FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
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
const MOMENTS = [
  "entrada",
  "assinaturas",
  "saida",
  "coquetel",
  "outro",
  "recepcao",
  "noiva",
  "noivo",
  "padrinhos",
  "assinatura",
];
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
    "SELECT moment,title,performer,notes FROM repertoire WHERE event_id=? AND organization_id=? AND owner_user_id IS NULL ORDER BY position,id",
    x.id,
    x.organization_id,
  ),
});
const saveRep = (id: number, organizationId: number, rep: any) => {
  if (!Array.isArray(rep)) return;
  db.exec("BEGIN");
  try {
    // The event wizard owns only legacy rows; richer module rows remain intact.
    run("DELETE FROM repertoire WHERE event_id=? AND organization_id=? AND owner_user_id IS NULL", id, organizationId);
    rep.forEach((r: any, i: number) =>
      run(
        "INSERT INTO repertoire(event_id,moment,position,title,performer,notes,organization_id) VALUES(?,?,?,?,?,?,?)",
        id,
        r.moment,
        i,
        r.title.trim(),
        r.performer?.trim() || null,
        r.notes?.trim() || null,
        organizationId,
      ),
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};
const EQ =
  "SELECT e.*,c.name client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id";
const vals = (b: any) =>
  pick(
    { ...b, status: b.status || "rascunho", uf: b.uf?.toUpperCase?.() ?? b.uf },
    EF,
  );
app.use("/api/events", (req: any, res, next) => {
  const b = req.body;
  if (["POST", "PUT"].includes(req.method) && b?.client_id && !one("SELECT id FROM clients WHERE id=? AND organization_id=?", b.client_id, req.user.organization_id))
    return fail(res, 422, "Cliente inexistente ou sem acesso.");
  if (
    ["POST", "PUT"].includes(req.method) &&
    b?.name &&
    b?.date &&
    (b.status || "rascunho") !== "rascunho" &&
    !Object.keys(evalid(b)).length &&
    one(
      "SELECT id FROM events WHERE organization_id=? AND lower(name)=lower(?) AND date=? AND IFNULL(start_time,'')=? AND IFNULL(client_id,0)=? AND id<>?",
      req.user.organization_id,
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
    w: string[] = ["e.organization_id=?"],
    a: any[] = [req.user.organization_id];
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
  const x = one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id);
  x ? res.json(withRep(x)) : fail(res, 404, "Evento nÃ£o encontrado.");
});
app.post("/api/events", (req, res) => {
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  const r = run(
    `INSERT INTO events(${[...EF,"organization_id"].join(",")}) VALUES(${EF.map(() => "?").concat("?").join(",")})`,
    ...vals(req.body), req.user.organization_id,
  );
  const id = Number(r.lastInsertRowid);
  saveRep(id, req.user.organization_id, req.body.repertoire);
  res.status(201).json(withRep(one(`${EQ} WHERE e.id=? AND e.organization_id=?`, id, req.user.organization_id)));
});
app.put("/api/events/:id", (req, res) => {
  if (!one("SELECT id FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  run(
    `UPDATE events SET ${EF.map((k) => k + "=?").join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`,
    ...vals(req.body),
    req.params.id,
    req.user.organization_id,
  );
  saveRep(Number(req.params.id), req.user.organization_id, req.body.repertoire);
  res.json(withRep(one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id)));
});
app.patch("/api/events/:id/status", (req, res) => {
  const x = one("SELECT * FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  if (!x) return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = evalid({ ...x, status: req.body?.status });
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  run(
    "UPDATE events SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?",
    req.body.status,
    req.params.id,
    req.user.organization_id,
  );
  res.json(one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id));
});
app.delete("/api/events/:id", (req, res) => {
  const result = run("DELETE FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  if (!result.changes) return fail(res, 404, "Evento não encontrado.");
  res.json({ ok: true });
});

// ---------- Financeiro ----------
const FINANCE_FIELDS = [
  "event_id",
  "description",
  "amount",
  "due_date",
  "paid_date",
  "status",
  "installment",
];
const FINANCE_STATUSES = ["pendente", "pago", "atrasado", "cancelado"];
const validDate = (value: any) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const financeFields = (b: any) => {
  const f: any = {};
  if (!String(b?.description ?? "").trim()) f.description = "Informe a descrição.";
  if (!Number.isFinite(Number(b?.amount)) || Number(b.amount) <= 0)
    f.amount = "Informe um valor maior que zero.";
  if (!validDate(b?.due_date)) f.due_date = "Data de vencimento inválida.";
  if (b?.paid_date && !validDate(b.paid_date)) f.paid_date = "Data de pagamento inválida.";
  if (!FINANCE_STATUSES.includes(b?.status || "pendente"))
    f.status = "Status financeiro inválido.";
  if ((b?.status || "pendente") === "pago" && !validDate(b?.paid_date))
    f.paid_date = "Informe uma data de pagamento válida.";
  if (b?.event_id !== undefined && b.event_id !== null && b.event_id !== "" &&
      !one("SELECT id FROM events WHERE id=?", Number(b.event_id)))
    f.event_id = "Evento inexistente.";
  return f;
};
const financeValues = (b: any) => {
  const values = pick({
    ...b,
    event_id: b.event_id === "" || b.event_id == null ? null : Number(b.event_id),
    description: String(b.description ?? "").trim(),
    amount: Number(b.amount),
    status: b.status || "pendente",
    installment: String(b.installment ?? "").trim() || null,
  }, FINANCE_FIELDS);
  return values;
};
const financeKpis = (organizationId: number) => one(`SELECT
  COALESCE(SUM(CASE WHEN status='pago' THEN amount ELSE 0 END),0) received,
  COALESCE(SUM(CASE WHEN status IN ('pendente','atrasado') THEN amount ELSE 0 END),0) to_receive,
  COALESCE(SUM(CASE WHEN status='atrasado' THEN amount ELSE 0 END),0) overdue
  FROM finances WHERE organization_id=?`, organizationId);

app.get("/api/finances", (req, res) => {
  const { q, status, from, to, event_id } = req.query as any;
  const where: string[] = ["f.organization_id=?"], values: any[] = [req.user.organization_id];
  if (q) {
    where.push("(f.description LIKE ? OR e.name LIKE ?)");
    values.push(`%${q}%`, `%${q}%`);
  }
  if (status && FINANCE_STATUSES.includes(status)) {
    where.push("f.status=?");
    values.push(status);
  }
  if (from && validDate(from)) { where.push("f.due_date>=?"); values.push(from); }
  if (to && validDate(to)) { where.push("f.due_date<=?"); values.push(to); }
  if (event_id && Number.isInteger(Number(event_id))) {
    where.push("f.event_id=?"); values.push(Number(event_id));
  }
  const items = all(`SELECT f.*,e.name event_name,c.name client_name
    FROM finances f LEFT JOIN events e ON e.id=f.event_id AND e.organization_id=f.organization_id
    LEFT JOIN clients c ON c.id=e.client_id AND c.organization_id=f.organization_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY f.due_date DESC,f.id DESC`, ...values);
  res.json({ items, kpi: financeKpis(req.user.organization_id) });
});
app.post("/api/finances", (req, res) => {
  const f = financeFields(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  if (req.body?.event_id && !one("SELECT id FROM events WHERE id=? AND organization_id=?", Number(req.body.event_id), req.user.organization_id)) return fail(res, 422, "Evento inexistente ou sem acesso.");
  const r = run(`INSERT INTO finances(${[...FINANCE_FIELDS,"organization_id"].join(",")}) VALUES(${FINANCE_FIELDS.map(() => "?").concat("?").join(",")})`, ...financeValues(req.body), req.user.organization_id);
  res.status(201).json(one("SELECT * FROM finances WHERE id=? AND organization_id=?", Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/finances/:id", (req, res) => {
  if (!one("SELECT id FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Lançamento não encontrado.");
  const f = financeFields(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  if (req.body?.event_id && !one("SELECT id FROM events WHERE id=? AND organization_id=?", Number(req.body.event_id), req.user.organization_id)) return fail(res, 422, "Evento inexistente ou sem acesso.");
  run(`UPDATE finances SET ${FINANCE_FIELDS.map((k) => k + "=?").join(",")} WHERE id=? AND organization_id=?`, ...financeValues(req.body), req.params.id, req.user.organization_id);
  res.json(one("SELECT * FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id));
});
app.delete("/api/finances/:id", (req, res) => {
  if (!one("SELECT id FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Lançamento não encontrado.");
  run("DELETE FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  res.json({ ok: true });
});

// ---------- Relatórios e exportação ----------
app.get("/api/reports/kpis", requirePermission("events.view"), requirePermission("finance.view"), (req: any, res) => {
  const byStatus = all("SELECT status,COUNT(*) count FROM events WHERE organization_id=? GROUP BY status ORDER BY status", req.user.organization_id);
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const confirmed = byStatus
    .filter((row) => ["confirmado", "concluido"].includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const finances = financeKpis(req.user.organization_id);
  res.json({
    events: { total, confirmed, rate: total ? Math.round(confirmed / total * 100) : 0, by_status: byStatus },
    finances,
  });
});
const csvCell = (value: any) => {
  let cell = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
};
app.get("/api/reports/:type/export", (req: any, res, next) =>
  requirePermission(req.params.type === "financial" ? "finance.view" : "events.view")(req, res, next),
  (req, res) => {
  const type = req.params.type;
  let rows: any[];
  if (type === "financial") {
    rows = all(`SELECT f.id ID,e.name Evento,f.description Descricao,f.installment Parcela,
      f.amount Valor,f.due_date Vencimento,f.paid_date Pagamento,UPPER(f.status) Status
      FROM finances f LEFT JOIN events e ON e.id=f.event_id AND e.organization_id=f.organization_id WHERE f.organization_id=? ORDER BY f.due_date DESC,f.id DESC`, req.user.organization_id);
  } else if (type === "events") {
    rows = all(`SELECT e.id ID,e.name Evento,c.name Cliente,e.date Data,UPPER(e.status) Status,
      IFNULL(e.contract_value,0) Valor_Contrato FROM events e
      LEFT JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id WHERE e.organization_id=? ORDER BY e.date DESC,e.id DESC`, req.user.organization_id);
  } else {
    return fail(res, 404, "Tipo de relatório não encontrado.");
  }
  if (!rows.length) return fail(res, 404, "Nenhum dado encontrado para exportação.");
  const headers = Object.keys(rows[0]);
  const csv = "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=relatorio_${type}.csv`);
  res.send(csv);
});

app.get("/api/overview", auth, requirePermission("events.view"), requirePermission("clients.view"), (req: any, res) => {
  const d = new Date(),
    today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  res.json({
    events: one("SELECT COUNT(*) n FROM events WHERE organization_id=?", req.user.organization_id).n,
    clients: one("SELECT COUNT(*) n FROM clients WHERE organization_id=?", req.user.organization_id).n,
    byStatus: all("SELECT status,COUNT(*) n FROM events WHERE organization_id=? GROUP BY status", req.user.organization_id),
    upcoming: all(
      `${EQ} WHERE e.organization_id=? AND e.date>=? AND e.status NOT IN ('cancelado','rascunho') ORDER BY e.date,e.start_time LIMIT 5`,
      req.user.organization_id,
      today,
    ),
  });
});
// ---------- Equipe (integraÃ§Ã£o das pÃ¡ginas do Wesley) ----------
const TEAM_ROLES = ["Músico", "Técnico", "Mídia", "Administrativo"];
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
const tdup = (b: any, organizationId: number, id = 0) =>
  one(
    "SELECT id FROM integrantes_equipe WHERE organization_id=? AND lower(name)=lower(?) AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','')=? AND id<>?",
    organizationId,
    String(b.name).trim(),
    String(b.phone).replace(/[\s\-()]/g, ""),
    id,
  );
app.use("/api/team", auth, modulePermissions("team"));
app.get("/api/team", (req: any, res) =>
  res.json(all(`${TQ} WHERE organization_id=? ORDER BY name COLLATE NOCASE`, req.user.organization_id)),
);
app.post("/api/team", (req, res) => {
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (tdup(req.body, req.user.organization_id))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body,
    r = run(
      "INSERT INTO integrantes_equipe(name,role,phone,status,organization_id) VALUES(?,?,?,?,?)",
      String(b.name).trim(),
      b.role,
      String(b.phone).trim(),
      b.status || "ativo",
      req.user.organization_id,
    );
  res.status(201).json(one(`${TQ} WHERE id=? AND organization_id=?`, Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/team/:id", (req, res) => {
  if (!one("SELECT id FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (tdup(req.body, req.user.organization_id, Number(req.params.id)))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body;
  run(
    "UPDATE integrantes_equipe SET name=?,role=?,phone=?,status=? WHERE id=? AND organization_id=?",
    String(b.name).trim(),
    b.role,
    String(b.phone).trim(),
    b.status || "ativo",
    req.params.id,
    req.user.organization_id,
  );
  res.json(one(`${TQ} WHERE id=? AND organization_id=?`, req.params.id, req.user.organization_id));
});
app.delete("/api/team/:id", (req, res) => {
  if (!one("SELECT id FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  run("DELETE FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  res.json({ ok: true });
});

// ---------- Configurações por conta ----------
const CONFIG_FIELDS = [
  "nome", "exibicao", "email", "telefone", "idioma", "moeda", "formato", "fuso",
  "novosEventos", "vencimentos", "escalas",
];
const CONFIG_MONEY = ["BRL", "USD", "EUR"];
const CONFIG_DATE_FORMATS = ["dd/mm/aaaa", "mm/dd/aaaa", "aaaa-mm-dd"];
const CONFIG_TIMEZONES = [
  "America/Sao_Paulo", "America/Manaus", "America/Rio_Branco", "America/Noronha",
];
const configValues = (body: any) => {
  const f: any = {};
  const text = (key: string, max: number) => {
    const value = body?.[key];
    if (typeof value !== "string" || !value.trim()) f[key] = "Campo obrigatório.";
    else if (value.trim().length > max) f[key] = `Máximo de ${max} caracteres.`;
  };
  text("nome", 120);
  text("exibicao", 120);
  text("email", 254);
  text("telefone", 30);
  const email = String(body?.email ?? "").trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) f.email = "E-mail corporativo inválido.";
  const phone = String(body?.telefone ?? "").replace(/\D/g, "");
  if (phone && ![10, 11].includes(phone.length)) f.telefone = "Informe DDD e telefone com 10 ou 11 dígitos.";
  if (body?.idioma !== "pt-BR") f.idioma = "Idioma não suportado.";
  if (!CONFIG_MONEY.includes(body?.moeda)) f.moeda = "Moeda inválida.";
  if (!CONFIG_DATE_FORMATS.includes(body?.formato)) f.formato = "Formato de data inválido.";
  if (!CONFIG_TIMEZONES.includes(body?.fuso)) f.fuso = "Fuso horário inválido.";
  for (const key of ["novosEventos", "vencimentos", "escalas"])
    if (typeof body?.[key] !== "boolean") f[key] = "Informe uma preferência válida.";
  if (Object.keys(f).length) return { fields: f };
  return {
    value: {
      nome: body.nome.trim(),
      exibicao: body.exibicao.trim(),
      email,
      telefone: phone,
      idioma: body.idioma,
      moeda: body.moeda,
      formato: body.formato,
      fuso: body.fuso,
      novosEventos: body.novosEventos,
      vencimentos: body.vencimentos,
      escalas: body.escalas,
    },
  };
};
app.use("/api/configuracoes", auth, modulePermissions("settings"));
app.get("/api/configuracoes", (req: any, res) => {
  const row = one("SELECT * FROM company_settings WHERE organization_id=?", req.user.organization_id);
  if (!row) return res.json({});
  const { user_id, organization_id, updated_at, ...settings } = row;
  res.json({
    ...settings,
    novosEventos: !!settings.novosEventos,
    vencimentos: !!settings.vencimentos,
    escalas: !!settings.escalas,
  });
});
app.put("/api/configuracoes", (req: any, res) => {
  const parsed = configValues(req.body);
  if (parsed.fields) return fail(res, 422, "Configurações inválidas.", parsed.fields);
  const s = parsed.value;
  run(`INSERT INTO company_settings(${["user_id","organization_id", ...CONFIG_FIELDS].join(",")})
    VALUES(${new Array(CONFIG_FIELDS.length + 2).fill("?").join(",")})
    ON CONFLICT(organization_id) DO UPDATE SET user_id=excluded.user_id,
    ${CONFIG_FIELDS.map((key) => `${key}=excluded.${key}`).join(",")},updated_at=CURRENT_TIMESTAMP`,
    req.user.id, req.user.organization_id, ...CONFIG_FIELDS.map((key) => typeof s[key] === "boolean" ? Number(s[key]) : s[key]));
  res.json(s);
});

// Administração restrita à organização atual. Tokens de convite são armazenados somente como hash.
app.use("/api/admin", auth);
app.get("/api/admin/users", requirePermission("users.view"), (req: any, res) => {
  const users = all(`SELECT u.id,u.name,u.email,m.role,m.status,m.created_at,m.last_login_at
    FROM organization_members m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY m.created_at DESC`, req.user.organization_id).map((user) => {
      const effective = user.role === "admin"
        ? all("SELECT permission name FROM role_permissions WHERE role='collaborator'")
        : all(`SELECT p.name,COALESCE(mp.granted,rp.permission IS NOT NULL) granted
        FROM permissions p LEFT JOIN member_permissions mp ON mp.permission=p.name AND mp.user_id=?
        LEFT JOIN role_permissions rp ON rp.permission=p.name AND rp.role=?`, user.id, user.role).filter((permission) => Number(permission.granted) === 1);
      return { ...user, permissions: effective.map((permission) => permission.name) };
    });
  const invitations = all(`SELECT id,name,email,target_role role,expires_at,created_at FROM invitations
    WHERE organization_id=? AND accepted_at IS NULL AND expires_at>? ORDER BY created_at DESC`, req.user.organization_id, now());
  res.json({ users, permissions: all("SELECT name,description FROM permissions ORDER BY name"), invitations });
});
app.post("/api/admin/invitations", requirePermission("users.create"), async (req: any, res) => {
  if (req.user.role !== "admin") return fail(res, 403, "Somente um administrador pode convidar usuários ou definir seus perfis.");
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").toLowerCase().trim();
  const role = req.body?.role;
  if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !["admin", "collaborator"].includes(role))
    return fail(res, 422, "Informe nome, e-mail válido e um perfil disponível.");
  if (one("SELECT id FROM users WHERE email=?", email) || one("SELECT id FROM invitations WHERE email=? AND organization_id=? AND accepted_at IS NULL AND expires_at>?", email, req.user.organization_id, now()))
    return fail(res, 409, "Já existe um usuário ou convite ativo para este e-mail.");
  if (!emailIsConfigured()) return fail(res, 503, "O envio de convites está temporariamente indisponível. Tente novamente mais tarde.");
  const token = randomBytes(32).toString("hex");
  const result = run("INSERT INTO invitations(organization_id,email,name,role,target_role,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)", req.user.organization_id, email, name, "collaborator", role, sha(token), now() + 48 * 36e5, req.user.id, now());
  recordAudit(req.user.id, "invitation.created", "invitation", Number(result.lastInsertRowid));
  try {
    await sendEmail({ to: email, subject: "Convite para a MWE Harmonize", htmlContent: `<p>Olá ${emailHtmlEscape(name)},</p><p>Use o link abaixo em até 48 horas para definir sua senha e ativar o acesso.</p><p><a href="${emailHtmlEscape(emailLink("invite", token))}">Aceitar convite</a></p>` }, "collaborator-invite");
  } catch (error) {
    run("DELETE FROM invitations WHERE id=? AND organization_id=?", Number(result.lastInsertRowid), req.user.organization_id);
    logEmailFailure("collaborator-invite", error);
    return fail(res, 503, "Não foi possível enviar o convite agora. Tente novamente mais tarde.");
  }
  res.status(201).json({ ok: true, role, expires_at: now() + 48 * 36e5 });
});
app.patch("/api/admin/users/:id", (req: any, res: any, next: any) => {
  if (req.body?.role !== undefined && req.user.role !== "admin") return fail(res, 403, "Somente um administrador pode alterar perfis.");
  requirePermission("users.edit")(req, res, (error?: any) => {
    if (error) return next(error);
    if (req.body?.status === undefined) return next();
    return requirePermission("users.disable")(req, res, next);
  });
}, (req: any, res) => {
  const target = one(`SELECT u.id,u.email,m.role,m.status FROM users u JOIN organization_members m ON m.user_id=u.id
    WHERE u.id=? AND m.organization_id=?`, req.params.id, req.user.organization_id);
  if (!target) return fail(res, 404, "Colaborador não encontrado.");
  if (Number(target.id) === Number(req.user.id)) return fail(res, 403, "Não é permitido alterar o próprio acesso administrativo.");
  const name = req.body?.name === undefined ? null : String(req.body.name).trim();
  const email = req.body?.email === undefined ? null : String(req.body.email).toLowerCase().trim();
  const role = req.body?.role;
  const status = req.body?.status;
  const f: any = {};
  if (name !== null && (!name || name.length > 120)) f.name = "Nome inválido.";
  if (email !== null && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)) f.email = "E-mail inválido.";
  if (role !== undefined && !["admin","collaborator"].includes(role)) f.role = "Perfil inválido.";
  if (status !== undefined && !["active","disabled","blocked"].includes(status)) f.status = "Status inválido.";
  if (email && one("SELECT id FROM users WHERE email=? AND id<>?", email, target.id)) f.email = "E-mail já está em uso.";
  const permissions = req.body?.permissions;
  if (permissions !== undefined && (!Array.isArray(permissions) || permissions.some((p: any) => !one("SELECT name FROM permissions WHERE name=?", p)))) f.permissions = "Lista de permissões inválida.";
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  const nextRole = role ?? target.role, nextStatus = status ?? target.status;
  if (target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
    const activeAdmins = Number(one("SELECT COUNT(*) n FROM organization_members WHERE organization_id=? AND role='admin' AND status='active'", req.user.organization_id).n);
    if (activeAdmins <= 1) return fail(res, 409, "A organização precisa manter ao menos um administrador ativo.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (name !== null) run("UPDATE users SET name=? WHERE id=?", name, target.id);
    if (email !== null) run("UPDATE users SET email=? WHERE id=?", email, target.id);
    if (role !== undefined) run("UPDATE organization_members SET role=? WHERE user_id=? AND organization_id=?", role, target.id, req.user.organization_id);
    if (status !== undefined) run("UPDATE organization_members SET status=? WHERE user_id=? AND organization_id=?", status, target.id, req.user.organization_id);
    if (permissions !== undefined && nextRole !== "admin") {
      run("DELETE FROM member_permissions WHERE user_id=?", target.id);
      for (const row of all("SELECT name FROM permissions")) run("INSERT INTO member_permissions(user_id,permission,granted) VALUES(?,?,?)", target.id, row.name, Number(permissions.includes(row.name)));
    } else if (role === "admin") run("DELETE FROM member_permissions WHERE user_id=?", target.id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  if (["disabled","blocked"].includes(status) || permissions !== undefined || email !== null || role !== undefined) run("DELETE FROM sessions WHERE user_id=?", target.id);
  recordAudit(req.user.id, role !== undefined ? "user.role_changed" : permissions !== undefined ? "user.permissions_changed" : status !== undefined ? `user.${status}` : "user.updated", "user", target.id);
  res.json(one(`SELECT u.id,u.name,u.email,m.role,m.status,m.created_at,m.last_login_at FROM users u JOIN organization_members m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?`, target.id, req.user.organization_id));
});
app.delete("/api/admin/users/:id", requirePermission("users.delete"), (req: any, res) => {
  const target = one("SELECT user_id,role FROM organization_members WHERE user_id=? AND organization_id=?", req.params.id, req.user.organization_id);
  if (!target) return fail(res, 404, "Colaborador não encontrado.");
  if (target.role === "admin" || Number(target.user_id) === Number(req.user.id)) return fail(res, 403, "Não é permitido remover o administrador atual.");
  run("UPDATE organization_members SET status='disabled' WHERE user_id=? AND organization_id=?", target.user_id, req.user.organization_id);
  run("DELETE FROM sessions WHERE user_id=?", target.user_id);
  recordAudit(req.user.id, "user.disabled", "user", Number(target.user_id));
  res.json({ ok: true });
});
app.get("/api/admin/audit", requirePermission("audit.view"), (req: any, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json(all(`SELECT id,actor_user_id,action,target_type,target_id,created_at FROM security_audit
    WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT ?`, req.user.organization_id, limit));
});
app.post("/api/invitations/accept", (req, res) => {
  if (limited(`invite:ip:${req.ip}`, 10)) return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");
  if (password.length < 12 || password.length > 1024) return fail(res, 422, "A senha deve ter entre 12 e 1024 caracteres.");
  const invite = one("SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?", sha(token), now());
  if (!invite) return fail(res, 400, "Convite inválido ou expirado.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = run("INSERT INTO users(email,name,hash) VALUES(?,?,?)", invite.email, invite.name, hashPw(password));
    const role = invite.target_role || invite.role;
    run("INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(?,?,?,?)", Number(user.lastInsertRowid), invite.organization_id, role, "active");
    run("UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL", now(), invite.id);
    db.exec("COMMIT");
    recordAudit(Number(user.lastInsertRowid), "invitation.accepted", "invitation", Number(invite.id));
  } catch (error) { db.exec("ROLLBACK"); return fail(res, 409, "O convite não pôde ser aceito."); }
  res.json({ ok: true });
});

// ---------- Repertório completo por conta ----------
const REP_MOMENTS = ["entrada", "assinaturas", "saida", "coquetel", "outro", "recepcao", "noiva", "noivo", "padrinhos", "assinatura"];
const repSnapshot = (organizationId: number) => {
  const musicas = all(`SELECT id,event_id,moment,position,title,artist,performer,composer,
    instrumentation,notes,reference_url,owner_user_id FROM repertoire r
    WHERE organization_id=? ORDER BY event_id,moment,position,id`, organizationId)
    .map((row) => ({
      id: row.id,
      evento: String(row.event_id),
      momento: row.moment,
      ordem: row.position,
      music: row.title,
      art: row.artist || row.performer || "",
      compo: row.composer || "",
      instru: row.instrumentation || "",
      obs: row.notes || "",
      link: row.reference_url || "",
      legacy: row.owner_user_id == null,
    }));
  const duracoes: Record<string, number> = {};
  for (const row of all("SELECT event_id,moment,duration_minutes FROM repertoire_durations WHERE organization_id=?", organizationId))
    duracoes[`${row.event_id}|${row.moment}`] = row.duration_minutes;
  const statusEventos: Record<string, string> = {};
  for (const row of all("SELECT event_id,status FROM repertoire_approvals WHERE organization_id=?", organizationId))
    statusEventos[String(row.event_id)] = row.status;
  return { musicas, duracoes, statusEventos };
};
const validReference = (value: string) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};
const repPayload = (body: any, organizationId: number) => {
  const fields: any = {};
  if (!body || !Array.isArray(body.musicas) || !body.duracoes || typeof body.duracoes !== "object" || Array.isArray(body.duracoes) ||
      !body.statusEventos || typeof body.statusEventos !== "object" || Array.isArray(body.statusEventos))
    return { fields: { repertorio: "Informe músicas, durações e status válidos." } };
  const ids = new Set<number>();
  const songs = body.musicas.map((song: any, index: number) => {
    const key = `musicas.${index}`;
    const id = song?.id == null || song.id === "" ? null : Number(song.id);
    const eventId = Number(song?.evento);
    if (id !== null && (!Number.isInteger(id) || id <= 0 || ids.has(id))) fields[key] = "ID de música inválido ou duplicado.";
    if (id !== null) ids.add(id);
    if (!Number.isInteger(eventId) || eventId <= 0 || !one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId)) fields[key + ".evento"] = "Evento inexistente ou sem acesso.";
    if (!REP_MOMENTS.includes(song?.momento)) fields[key + ".momento"] = "Momento inválido.";
    if (!Number.isInteger(Number(song?.ordem)) || Number(song.ordem) < 1) fields[key + ".ordem"] = "A ordem deve ser um inteiro positivo.";
    for (const [field, max] of [["music", 180], ["art", 180], ["compo", 180], ["instru", 240]] as [string, number][]) {
      const required = field === "music";
      if (typeof song?.[field] !== "string" || (required && !song[field].trim())) fields[key + "." + field] = required ? "Informe a música." : "Campo inválido.";
      else if (song[field].trim().length > max) fields[key + "." + field] = `Máximo de ${max} caracteres.`;
    }
    if (typeof (song?.obs ?? "") !== "string" || String(song?.obs ?? "").length > 2000) fields[key + ".obs"] = "Observações inválidas.";
    if (typeof (song?.link ?? "") !== "string" || String(song?.link ?? "").length > 2000 || !validReference(String(song?.link ?? "")))
      fields[key + ".link"] = "Use um link HTTP ou HTTPS válido.";
    return { id, eventId, moment: song?.momento, position: Number(song?.ordem), title: String(song?.music ?? "").trim(), artist: String(song?.art ?? "").trim(), composer: String(song?.compo ?? "").trim(), instrumentation: String(song?.instru ?? "").trim(), notes: String(song?.obs ?? "").trim(), url: String(song?.link ?? "").trim(), legacy: song?.legacy === true };
  });
  const durations: Array<{ eventId: number; moment: string; value: number }> = [];
  for (const [key, value] of Object.entries(body.duracoes)) {
    const [event, moment, ...rest] = key.split("|");
    const eventId = Number(event);
    if (rest.length || !Number.isInteger(eventId) || !one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId) || !REP_MOMENTS.includes(moment) || !Number.isInteger(value) || Number(value) < 1)
      fields[`duracoes.${key}`] = "Duração inválida.";
    else durations.push({ eventId, moment, value: Number(value) });
  }
  const approvals: Array<{ eventId: number; status: string }> = [];
  for (const [event, status] of Object.entries(body.statusEventos)) {
    const eventId = Number(event);
    if (!Number.isInteger(eventId) || !one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId) || !["pendente", "aprovado"].includes(String(status)))
      fields[`statusEventos.${event}`] = "Status de repertório inválido.";
    else approvals.push({ eventId, status: String(status) });
  }
  return Object.keys(fields).length ? { fields } : { songs, durations, approvals };
};
app.use("/api/repertorios", auth, modulePermissions("repertoire"));
app.get("/api/repertorios", (req: any, res) => res.json(repSnapshot(req.user.organization_id)));
app.put("/api/repertorios", (req: any, res) => {
  const parsed = repPayload(req.body, req.user.organization_id);
  if (parsed.fields) return fail(res, 422, "Repertório inválido.", parsed.fields);
  const { songs, durations, approvals } = parsed as any;
  const existing = all("SELECT id FROM repertoire WHERE organization_id=? AND owner_user_id IS NOT NULL", req.user.organization_id).map((x) => Number(x.id));
  const existingSet = new Set(existing);
  const keep = new Set<number>();
  for (const song of songs) {
    if (song.legacy) continue;
    if (song.id !== null && !existingSet.has(song.id)) {
      const other = one("SELECT owner_user_id,organization_id FROM repertoire WHERE id=?", song.id);
      if (other) return fail(res, 403, "Esta música não pertence à conta atual.");
      return fail(res, 422, "ID de música desconhecido.");
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const song of songs) {
      if (song.legacy) continue;
      if (song.id !== null) {
        run(`UPDATE repertoire SET event_id=?,moment=?,position=?,title=?,artist=?,composer=?,instrumentation=?,notes=?,reference_url=?
          WHERE id=? AND organization_id=? AND owner_user_id IS NOT NULL`, song.eventId, song.moment, song.position, song.title, song.artist, song.composer, song.instrumentation, song.notes || null, song.url || null, song.id, req.user.organization_id);
        keep.add(song.id);
      } else {
        const result = run(`INSERT INTO repertoire(event_id,moment,position,title,artist,composer,instrumentation,notes,reference_url,owner_user_id,organization_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`, song.eventId, song.moment, song.position, song.title, song.artist, song.composer, song.instrumentation, song.notes || null, song.url || null, req.user.id, req.user.organization_id);
        keep.add(Number(result.lastInsertRowid));
      }
    }
    for (const id of existing) if (!keep.has(id)) run("DELETE FROM repertoire WHERE id=? AND organization_id=? AND owner_user_id IS NOT NULL", id, req.user.organization_id);
    run("DELETE FROM repertoire_durations WHERE organization_id=?", req.user.organization_id);
    for (const item of durations) run("INSERT INTO repertoire_durations(user_id,event_id,moment,duration_minutes,organization_id) VALUES(?,?,?,?,?)", req.user.id, item.eventId, item.moment, item.value, req.user.organization_id);
    run("DELETE FROM repertoire_approvals WHERE organization_id=?", req.user.organization_id);
    for (const item of approvals) run("INSERT INTO repertoire_approvals(user_id,event_id,status,organization_id) VALUES(?,?,?,?)", req.user.id, item.eventId, item.status, req.user.organization_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json(repSnapshot(req.user.organization_id));
});

app.use("/api", (_q, res) => fail(res, 404, "Rota nÃ£o encontrada."));
app.get("/", (_req, res) => { res.sendFile("index.html", { root: "public" }); });
app.use(express.static("public"));
app.use((e: any, _q: any, res: any, _n: any) => {
    console.error("Falha de requisição no servidor", { status: e.status || 500 });
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


