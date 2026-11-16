import express from "express";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { all, one, run, transaction, initializePostgres, closeDatabase } from "./database.js";
import { emailIsConfigured, emailLink, logEmailConfiguration, logEmailFailure, sendEmail } from "./email-service.js";

logEmailConfiguration();

declare global {
  namespace Express {
    interface Request { user?: any }
  }
}

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
const recordAudit = async (actor: number | null, action: string, targetType = "user", targetId: number | null = actor) =>
  run("INSERT INTO security_audit(actor_user_id,organization_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?,?)", actor, actor ? (await one("SELECT organization_id FROM organization_members WHERE user_id=?", actor))?.organization_id ?? null : null, action, targetType, targetId, now());

await initializePostgres(hashPw);
const PROD = process.env.NODE_ENV === "production";
const app = express();
app.disable("x-powered-by");
const asyncHandler = (handler: any) => {
  if (handler.length === 4) return handler;
  return (req: any, res: any, next: any) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === "function") result.catch(next);
      return result;
    } catch (error) {
      return next(error);
    }
  };
};
for (const method of ["use", "get", "post", "put", "patch", "delete"]) {
  const original = (app as any)[method].bind(app);
  (app as any)[method] = (...args: any[]) => {
    if (method === "get" && args.length === 1 && typeof args[0] === "string") return original(...args);
    return original(...args.map((arg) => typeof arg === "function" ? asyncHandler(arg) : arg));
  };
}
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
app.post("/api/auth/login", async (req, res) => {
  const { email = "", password = "", remember } = req.body || {};
  const normalizedEmail = String(email).toLowerCase().trim();
  const ipKey = `login:ip:${req.ip}`;
  const attemptKey = `login:pair:${req.ip}:${sha(normalizedEmail)}`;
  if (normalizedEmail.length > 254 || String(password).length > 1024 || limited(ipKey, 20) || limited(attemptKey, 10))
    return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const u = await one(`SELECT u.*,m.organization_id,m.role,m.status membership_status
    FROM users u JOIN organization_members m ON m.user_id=u.id
    WHERE u.email=? AND m.status='active'`, normalizedEmail);
  let passwordMatches = false;
  try { if (u) passwordMatches = checkPw(String(password), u.hash); } catch { passwordMatches = false; }
  if (!u || !passwordMatches)
    return fail(res, 401, "E-mail ou senha invÃ¡lidos.");
  clearAttempts(ipKey);
  clearAttempts(attemptKey);
  await run("DELETE FROM sessions WHERE expires<=?", now());
  const t = randomBytes(32).toString("hex"),
    ttl = remember === true ? 30 * 864e5 : 12 * 36e5;
  await run("INSERT INTO sessions VALUES(?,?,?)", sha(t), u.id, now() + ttl);
  await run("UPDATE organization_members SET last_login_at=? WHERE user_id=?", now(), u.id);
  await recordAudit(u.id, "login.success");
  res.setHeader(
    "Set-Cookie",
    `sid=${t}; HttpOnly; SameSite=Lax; Path=/${PROD ? "; Secure" : ""}${remember ? `; Max-Age=${ttl / 1000}` : ""}`,
  );
  res.json({ id: u.id, name: u.name, email: u.email });
});
app.post("/api/auth/logout", async (req, res) => {
  const t = cookie(req, "sid");
  if (t) {
    const session = await one("SELECT user_id FROM sessions WHERE token=?", sha(t));
    if (session) await recordAudit(session.user_id, "logout");
    await run("DELETE FROM sessions WHERE token=?", sha(t));
  }
  res.setHeader("Set-Cookie", `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD ? "; Secure" : ""}`);
  res.json({ ok: true });
});
const auth = async (req: any, res: any, next: any) => {
  res.setHeader("Cache-Control", "no-store");
  const t = cookie(req, "sid");
  const s =
    t &&
    await one(
      `SELECT u.id,u.name,u.email,s.expires,m.organization_id,m.role,m.status
       FROM sessions s JOIN users u ON u.id=s.user_id
       JOIN organization_members m ON m.user_id=u.id
       WHERE s.token=? AND m.status='active'`,
      sha(t),
    );
  if (!s || s.expires <= now()) {
    if (t) await run("DELETE FROM sessions WHERE token=?", sha(t));
    return fail(res, 401, "NÃ£o autenticado.");
  }
  req.user = s;
  next();
};
const requirePermission = (permission: string) => async (req: any, res: any, next: any) => {
  if (req.user.role === "admin") return next();
  const override = await one("SELECT granted FROM member_permissions WHERE user_id=? AND permission=?", req.user.id, permission);
  const granted = override ? Number(override.granted) === 1 : !!(await one("SELECT 1 FROM role_permissions WHERE role=? AND permission=?", req.user.role, permission));
  if (!granted) {
    await recordAudit(req.user.id, "access.denied", "permission", null);
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
      void recordAudit(req.user.id, `${req.method.toLowerCase()}.${type}`, type, Number.isSafeInteger(possibleId) && possibleId > 0 ? possibleId : null).catch(() => console.error("Falha ao registrar auditoria da requisição."));
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
  const u = await one("SELECT id FROM users WHERE email=?", email);
  if (u) {
    const t = randomBytes(32).toString("hex");
    await run("DELETE FROM resets WHERE user_id=?", u.id);
    const tokenHash = sha(t);
    await run("INSERT INTO resets VALUES(?,?,?)", tokenHash, u.id, now() + 36e5);
    try {
      await sendEmail({
        to: email,
        subject: "Recuperação de acesso — MWE Harmonize",
        htmlContent: `<p>Para criar uma nova senha, acesse o link abaixo. Ele é válido por 1 hora.</p><p><a href="${emailHtmlEscape(emailLink("reset", t))}">Redefinir senha</a></p>`,
      }, "password-recovery");
    } catch (error) {
      await run("DELETE FROM resets WHERE token=?", tokenHash);
      logEmailFailure("password-recovery", error);
    }
  }
  res.json({ message: recoveryMessage });
});
app.post("/api/auth/reset", async (req, res) => {
  const { token = "", password = "" } = req.body || {};
  if (limited(`reset:ip:${req.ip}`, 10)) return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  if (String(password).length < 12 || String(password).length > 1024)
    return fail(res, 400, "A senha deve ter ao menos 12 caracteres.");
  const userId = await transaction(async () => {
    const consumed = await one("DELETE FROM resets WHERE token=? AND expires>? RETURNING user_id", sha(String(token)), now());
    if (!consumed) return null;
    await run("UPDATE users SET hash=? WHERE id=?", hashPw(password), consumed.user_id);
    await run("DELETE FROM sessions WHERE user_id=?", consumed.user_id);
    return Number(consumed.user_id);
  });
  if (!userId)
    return fail(res, 400, "Link invÃ¡lido ou expirado.");
  await recordAudit(userId, "password.reset");
  res.json({ ok: true });
});
app.use("/api/account", auth);
app.put("/api/account", async (req: any, res) => {
  const name = String(req.body?.name || "").trim(),
    email = String(req.body?.email || "")
      .toLowerCase()
      .trim(),
    f: any = {};
  if (!name) f.name = "Informe o nome.";
  if (!/^\S+@\S+\.\S+$/.test(email)) f.email = "E-mail invÃ¡lido.";
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (await one("SELECT id FROM users WHERE email=? AND id<>?", email, req.user.id))
    return fail(res, 409, "Este e-mail jÃ¡ estÃ¡ em uso.", {
      email: "Este e-mail jÃ¡ estÃ¡ em uso.",
    });
  await run("UPDATE users SET name=?,email=? WHERE id=?", name, email, req.user.id);
  await recordAudit(req.user.id, "account.updated");
  res.json({ id: req.user.id, name, email });
});
app.put("/api/account/password", async (req: any, res) => {
  const { current = "", password = "", confirm = "" } = req.body || {},
    u = await one("SELECT * FROM users WHERE id=?", req.user.id);
  if (!checkPw(String(current), u.hash))
    return fail(res, 403, "Senha atual incorreta.");
  if (String(password).length < 12)
    return fail(res, 422, "A nova senha deve ter ao menos 12 caracteres.");
  if (password !== confirm)
    return fail(res, 422, "A confirmaÃ§Ã£o nÃ£o confere com a nova senha.");
  await run("UPDATE users SET hash=? WHERE id=?", hashPw(password), u.id);
  await recordAudit(u.id, "password.changed");
  await run("DELETE FROM resets WHERE user_id=?", u.id);
  await run(
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
app.get("/api/clients", async (req, res) => {
  const q = `%${req.query.q || ""}%`,
    sort =
      ({ name: "c.name", recent: "c.id DESC", events: "n DESC" } as any)[
        req.query.sort as string
      ] || "c.name";
  res.json(
    await all(
      `SELECT c.*,(SELECT COUNT(*) FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id) n, (SELECT type FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_type, (SELECT status FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_status, (SELECT date FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_date, (SELECT venue FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id ORDER BY e.date DESC LIMIT 1) ev_venue FROM clients c WHERE c.organization_id=? AND (c.name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ?) ${(req.query as any).status === "sem" ? "AND NOT EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id)" : STATUS.includes((req.query as any).status) ? "AND EXISTS (SELECT 1 FROM events e WHERE e.client_id=c.id AND e.organization_id=c.organization_id AND e.status='" + (req.query as any).status + "')" : ""} ORDER BY ${sort}`,
      req.user.organization_id,
      q,
      q,
      q,
    ),
  );
});
app.post("/api/clients", async (req, res) => {
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  const r = await run(
    "INSERT INTO clients(name,email,phone,notes,organization_id) VALUES(?,?,?,?,?) RETURNING id",
    ...pick(req.body, CF),
    req.user.organization_id,
  );
  res
    .status(201)
    .json(await one("SELECT * FROM clients WHERE id=? AND organization_id=?", Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/clients/:id", async (req, res) => {
  if (!await one("SELECT id FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Cliente nÃ£o encontrado.");
  const f = cval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  await run(
    "UPDATE clients SET name=?,email=?,phone=?,notes=? WHERE id=? AND organization_id=?",
    ...pick(req.body, CF),
    req.params.id,
    req.user.organization_id,
  );
  res.json(await one("SELECT * FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id));
});
app.delete("/api/clients/:id", async (req, res) => {
  const n = (await one(
    "SELECT COUNT(*) n FROM events WHERE client_id=? AND organization_id=?",
    req.params.id,
    req.user.organization_id,
  )).n;
  if (!await one("SELECT id FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id)) return fail(res, 404, "Cliente não encontrado.");
  if (n)
    return fail(
      res,
      409,
      `Cliente possui ${n} evento(s) vinculado(s). Exclua ou reatribua os eventos antes.`,
    );
  await run("DELETE FROM clients WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
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
const evalid = async (b: any) => {
  const f: any = {},
    st = b?.status || "rascunho";
  if (!b?.name?.trim()) f.name = "Informe o nome do evento.";
  if (!STATUS.includes(st)) f.status = "Status invÃ¡lido.";
  if (b?.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) f.date = "Data invÃ¡lida.";
  if (b?.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time))
    f.start_time = "HorÃ¡rio invÃ¡lido.";
  if (b?.client_id && !await one("SELECT id FROM clients WHERE id=?", b.client_id))
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
const withRep = async (x: any) => ({
  ...x,
  repertoire: await all(
    "SELECT moment,title,performer,notes FROM repertoire WHERE event_id=? AND organization_id=? AND owner_user_id IS NULL ORDER BY position,id",
    x.id,
    x.organization_id,
  ),
});
const saveRep = async (id: number, organizationId: number, rep: any) => {
  if (!Array.isArray(rep)) return;
  await transaction(async () => {
    // The event wizard owns only legacy rows; richer module rows remain intact.
    await run("DELETE FROM repertoire WHERE event_id=? AND organization_id=? AND owner_user_id IS NULL", id, organizationId);
    for (const [i, r] of rep.entries()) await run(
        "INSERT INTO repertoire(event_id,moment,position,title,performer,notes,organization_id) VALUES(?,?,?,?,?,?,?)",
        id,
        r.moment,
        i,
        r.title.trim(),
        r.performer?.trim() || null,
        r.notes?.trim() || null,
        organizationId,
      );
  });
};
const EQ =
  "SELECT e.*,c.name client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id AND c.organization_id=e.organization_id";
const vals = (b: any) =>
  pick(
    { ...b, status: b.status || "rascunho", uf: b.uf?.toUpperCase?.() ?? b.uf },
    EF,
  );
app.use("/api/events", async (req: any, res, next) => {
  const b = req.body;
  if (["POST", "PUT"].includes(req.method) && b?.client_id && !await one("SELECT id FROM clients WHERE id=? AND organization_id=?", b.client_id, req.user.organization_id))
    return fail(res, 422, "Cliente inexistente ou sem acesso.");
  if (
    ["POST", "PUT"].includes(req.method) &&
    b?.name &&
    b?.date &&
    (b.status || "rascunho") !== "rascunho" &&
    !Object.keys(await evalid(b)).length &&
    await one(
      "SELECT id FROM events WHERE organization_id=? AND lower(name)=lower(?) AND date=? AND COALESCE(start_time,'')=? AND COALESCE(client_id,0)=? AND id<>?",
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
app.get("/api/events", async (req, res) => {
  const { q, status, from, to } = req.query as any,
    w: string[] = ["e.organization_id=?"],
    a: any[] = [req.user.organization_id];
  if (q) {
    w.push(
      "(e.name ILIKE ? OR c.name ILIKE ? OR e.venue ILIKE ? OR e.city ILIKE ?)",
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
    await all(
      `${EQ}${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY e.date IS NULL,e.date,e.start_time`,
      ...a,
    ),
  );
});
app.get("/api/events/:id", async (req, res) => {
  const x = await one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id);
  x ? res.json(await withRep(x)) : fail(res, 404, "Evento nÃ£o encontrado.");
});
app.post("/api/events", async (req, res) => {
  const f = await evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  const id = await transaction(async () => {
    const r = await run(
      `INSERT INTO events(${[...EF,"organization_id"].join(",")}) VALUES(${EF.map(() => "?").concat("?").join(",")}) RETURNING id`,
      ...vals(req.body), req.user.organization_id,
    );
    const eventId = Number(r.lastInsertRowid);
    await saveRep(eventId, req.user.organization_id, req.body.repertoire);
    return eventId;
  });
  res.status(201).json(await withRep(await one(`${EQ} WHERE e.id=? AND e.organization_id=?`, id, req.user.organization_id)));
});
app.put("/api/events/:id", async (req, res) => {
  if (!await one("SELECT id FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = await evalid(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  await transaction(async () => {
    await run(
      `UPDATE events SET ${EF.map((k) => k + "=?").join(",")},updated_at=CURRENT_TIMESTAMP::text WHERE id=? AND organization_id=?`,
      ...vals(req.body), req.params.id, req.user.organization_id,
    );
    await saveRep(Number(req.params.id), req.user.organization_id, req.body.repertoire);
  });
  res.json(await withRep(await one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id)));
});
app.patch("/api/events/:id/status", async (req, res) => {
  const x = await one("SELECT * FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  if (!x) return fail(res, 404, "Evento nÃ£o encontrado.");
  const f = await evalid({ ...x, status: req.body?.status });
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  await run(
    "UPDATE events SET status=?,updated_at=CURRENT_TIMESTAMP::text WHERE id=? AND organization_id=?",
    req.body.status,
    req.params.id,
    req.user.organization_id,
  );
  res.json(await one(`${EQ} WHERE e.id=? AND e.organization_id=?`, req.params.id, req.user.organization_id));
});
app.delete("/api/events/:id", async (req, res) => {
  const result = await run("DELETE FROM events WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
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
const financeKpis = async (organizationId: number) => await one(`SELECT
  COALESCE(SUM(CASE WHEN status='pago' THEN amount ELSE 0 END),0) received,
  COALESCE(SUM(CASE WHEN status IN ('pendente','atrasado') THEN amount ELSE 0 END),0) to_receive,
  COALESCE(SUM(CASE WHEN status='atrasado' THEN amount ELSE 0 END),0) overdue
  FROM finances WHERE organization_id=?`, organizationId);

app.get("/api/finances", async (req, res) => {
  const { q, status, from, to, event_id } = req.query as any;
  const where: string[] = ["f.organization_id=?"], values: any[] = [req.user.organization_id];
  if (q) {
    where.push("(f.description ILIKE ? OR e.name ILIKE ?)");
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
  const items = await all(`SELECT f.*,e.name event_name,c.name client_name
    FROM finances f LEFT JOIN events e ON e.id=f.event_id AND e.organization_id=f.organization_id
    LEFT JOIN clients c ON c.id=e.client_id AND c.organization_id=f.organization_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY f.due_date DESC,f.id DESC`, ...values);
  res.json({ items, kpi: await financeKpis(req.user.organization_id) });
});
app.post("/api/finances", async (req, res) => {
  const f = financeFields(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  if (req.body?.event_id && !await one("SELECT id FROM events WHERE id=? AND organization_id=?", Number(req.body.event_id), req.user.organization_id)) return fail(res, 422, "Evento inexistente ou sem acesso.");
  const r = await run(`INSERT INTO finances(${[...FINANCE_FIELDS,"organization_id"].join(",")}) VALUES(${FINANCE_FIELDS.map(() => "?").concat("?").join(",")}) RETURNING id`, ...financeValues(req.body), req.user.organization_id);
  res.status(201).json(await one("SELECT * FROM finances WHERE id=? AND organization_id=?", Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/finances/:id", async (req, res) => {
  if (!await one("SELECT id FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Lançamento não encontrado.");
  const f = financeFields(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  if (req.body?.event_id && !await one("SELECT id FROM events WHERE id=? AND organization_id=?", Number(req.body.event_id), req.user.organization_id)) return fail(res, 422, "Evento inexistente ou sem acesso.");
  await run(`UPDATE finances SET ${FINANCE_FIELDS.map((k) => k + "=?").join(",")} WHERE id=? AND organization_id=?`, ...financeValues(req.body), req.params.id, req.user.organization_id);
  res.json(await one("SELECT * FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id));
});
app.delete("/api/finances/:id", async (req, res) => {
  if (!await one("SELECT id FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Lançamento não encontrado.");
  await run("DELETE FROM finances WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
  res.json({ ok: true });
});

// ---------- Relatórios e exportação ----------
app.get("/api/reports/kpis", requirePermission("events.view"), requirePermission("finance.view"), async (req: any, res) => {
  const byStatus = await all("SELECT status,COUNT(*) count FROM events WHERE organization_id=? GROUP BY status ORDER BY status", req.user.organization_id);
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const confirmed = byStatus
    .filter((row) => ["confirmado", "concluido"].includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const finances = await financeKpis(req.user.organization_id);
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
  async (req, res) => {
  const type = req.params.type;
  let rows: any[];
  if (type === "financial") {
    rows = await all(`SELECT f.id AS "ID",e.name AS "Evento",f.description AS "Descricao",f.installment AS "Parcela",
      f.amount AS "Valor",f.due_date AS "Vencimento",f.paid_date AS "Pagamento",UPPER(f.status) AS "Status"
      FROM finances f LEFT JOIN events e ON e.id=f.event_id AND e.organization_id=f.organization_id WHERE f.organization_id=? ORDER BY f.due_date DESC,f.id DESC`, req.user.organization_id);
  } else if (type === "events") {
    rows = await all(`SELECT e.id AS "ID",e.name AS "Evento",c.name AS "Cliente",e.date AS "Data",UPPER(e.status) AS "Status",
      COALESCE(e.contract_value,0) AS "Valor_Contrato" FROM events e
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

app.get("/api/overview", auth, requirePermission("events.view"), requirePermission("clients.view"), async (req: any, res) => {
  const d = new Date(),
    today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  res.json({
    events: (await one("SELECT COUNT(*) n FROM events WHERE organization_id=?", req.user.organization_id)).n,
    clients: (await one("SELECT COUNT(*) n FROM clients WHERE organization_id=?", req.user.organization_id)).n,
    byStatus: await all("SELECT status,COUNT(*) n FROM events WHERE organization_id=? GROUP BY status", req.user.organization_id),
    upcoming: await all(
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
app.get("/api/team", async (req: any, res) =>
  res.json(await all(`${TQ} WHERE organization_id=? ORDER BY lower(name),name`, req.user.organization_id)),
);
app.post("/api/team", async (req, res) => {
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (await tdup(req.body, req.user.organization_id))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body,
    r = await run(
      "INSERT INTO integrantes_equipe(name,role,phone,status,organization_id) VALUES(?,?,?,?,?) RETURNING id",
      String(b.name).trim(),
      b.role,
      String(b.phone).trim(),
      b.status || "ativo",
      req.user.organization_id,
    );
  res.status(201).json(await one(`${TQ} WHERE id=? AND organization_id=?`, Number(r.lastInsertRowid), req.user.organization_id));
});
app.put("/api/team/:id", async (req, res) => {
  if (!await one("SELECT id FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  const f = tval(req.body);
  if (Object.keys(f).length) return fail(res, 422, "Dados invÃ¡lidos.", f);
  if (await tdup(req.body, req.user.organization_id, Number(req.params.id)))
    return fail(res, 409, "Este integrante jÃ¡ estÃ¡ cadastrado.");
  const b = req.body;
  await run(
    "UPDATE integrantes_equipe SET name=?,role=?,phone=?,status=? WHERE id=? AND organization_id=?",
    String(b.name).trim(),
    b.role,
    String(b.phone).trim(),
    b.status || "ativo",
    req.params.id,
    req.user.organization_id,
  );
  res.json(await one(`${TQ} WHERE id=? AND organization_id=?`, req.params.id, req.user.organization_id));
});
app.delete("/api/team/:id", async (req, res) => {
  if (!await one("SELECT id FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id))
    return fail(res, 404, "Integrante nÃ£o encontrado.");
  await run("DELETE FROM integrantes_equipe WHERE id=? AND organization_id=?", req.params.id, req.user.organization_id);
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
app.get("/api/configuracoes", async (req: any, res) => {
  const row = await one("SELECT * FROM company_settings WHERE organization_id=?", req.user.organization_id);
  if (!row) return res.json({});
  const { user_id, organization_id, updated_at, ...settings } = row;
  res.json({
    ...settings,
    novosEventos: !!settings.novosEventos,
    vencimentos: !!settings.vencimentos,
    escalas: !!settings.escalas,
  });
});
app.put("/api/configuracoes", async (req: any, res) => {
  const parsed = configValues(req.body);
  if (parsed.fields) return fail(res, 422, "Configurações inválidas.", parsed.fields);
  const s = parsed.value;
  await run(`INSERT INTO company_settings(${["user_id","organization_id", ...CONFIG_FIELDS].join(",")})
    VALUES(${new Array(CONFIG_FIELDS.length + 2).fill("?").join(",")})
    ON CONFLICT(organization_id) DO UPDATE SET user_id=excluded.user_id,
    ${CONFIG_FIELDS.map((key) => `${key}=excluded.${key}`).join(",")},updated_at=CURRENT_TIMESTAMP::text`,
    req.user.id, req.user.organization_id, ...CONFIG_FIELDS.map((key) => typeof s[key] === "boolean" ? Number(s[key]) : s[key]));
  res.json(s);
});

// Administração restrita à organização atual. Tokens de convite são armazenados somente como hash.
app.use("/api/admin", auth);
app.get("/api/admin/users", requirePermission("users.view"), async (req: any, res) => {
  const users = await all(`SELECT u.id,u.name,u.email,m.role,m.status,m.created_at,m.last_login_at
    FROM organization_members m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY m.created_at DESC`, req.user.organization_id);
  const withPermissions = await Promise.all(users.map(async (user) => {
      const effective = user.role === "admin"
        ? await all("SELECT permission name FROM role_permissions WHERE role='collaborator'")
        : (await all(`SELECT p.name,COALESCE(mp.granted=1,rp.permission IS NOT NULL) granted
        FROM permissions p LEFT JOIN member_permissions mp ON mp.permission=p.name AND mp.user_id=?
        LEFT JOIN role_permissions rp ON rp.permission=p.name AND rp.role=?`, user.id, user.role)).filter((permission) => Number(permission.granted) === 1);
      return { ...user, permissions: effective.map((permission) => permission.name) };
    }));
  const invitations = await all(`SELECT id,name,email,target_role role,expires_at,created_at FROM invitations
    WHERE organization_id=? AND accepted_at IS NULL AND expires_at>? ORDER BY created_at DESC`, req.user.organization_id, now());
  res.json({ users: withPermissions, permissions: await all("SELECT name,description FROM permissions ORDER BY name"), invitations });
});
app.post("/api/admin/invitations", requirePermission("users.create"), async (req: any, res) => {
  if (req.user.role !== "admin") return fail(res, 403, "Somente um administrador pode convidar usuários ou definir seus perfis.");
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").toLowerCase().trim();
  const role = req.body?.role;
  if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !["admin", "collaborator"].includes(role))
    return fail(res, 422, "Informe nome, e-mail válido e um perfil disponível.");
  if (await one("SELECT id FROM users WHERE email=?", email) || await one("SELECT id FROM invitations WHERE email=? AND organization_id=? AND accepted_at IS NULL AND expires_at>?", email, req.user.organization_id, now()))
    return fail(res, 409, "Já existe um usuário ou convite ativo para este e-mail.");
  if (!emailIsConfigured()) return fail(res, 503, "O envio de convites está temporariamente indisponível. Tente novamente mais tarde.");
  const token = randomBytes(32).toString("hex");
  const result = await run("INSERT INTO invitations(organization_id,email,name,role,target_role,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id", req.user.organization_id, email, name, "collaborator", role, sha(token), now() + 48 * 36e5, req.user.id, now());
  await recordAudit(req.user.id, "invitation.created", "invitation", Number(result.lastInsertRowid));
  try {
    await sendEmail({ to: email, subject: "Convite para a MWE Harmonize", htmlContent: `<p>Olá ${emailHtmlEscape(name)},</p><p>Use o link abaixo em até 48 horas para definir sua senha e ativar o acesso.</p><p><a href="${emailHtmlEscape(emailLink("invite", token))}">Aceitar convite</a></p>` }, "collaborator-invite");
  } catch (error) {
    await run("DELETE FROM invitations WHERE id=? AND organization_id=?", Number(result.lastInsertRowid), req.user.organization_id);
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
}, async (req: any, res) => {
  const target = await one(`SELECT u.id,u.email,m.role,m.status FROM users u JOIN organization_members m ON m.user_id=u.id
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
  if (email && await one("SELECT id FROM users WHERE email=? AND id<>?", email, target.id)) f.email = "E-mail já está em uso.";
  const permissions = req.body?.permissions;
  if (permissions !== undefined && (!Array.isArray(permissions) || (await Promise.all(permissions.map((p: any) => one("SELECT name FROM permissions WHERE name=?", p)))).some((row) => !row))) f.permissions = "Lista de permissões inválida.";
  if (Object.keys(f).length) return fail(res, 422, "Dados inválidos.", f);
  const nextRole = role ?? target.role, nextStatus = status ?? target.status;
  if (target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
    const activeAdmins = Number((await one("SELECT COUNT(*) n FROM organization_members WHERE organization_id=? AND role='admin' AND status='active'", req.user.organization_id)).n);
    if (activeAdmins <= 1) return fail(res, 409, "A organização precisa manter ao menos um administrador ativo.");
  }
  await transaction(async () => {
    if (name !== null) await run("UPDATE users SET name=? WHERE id=?", name, target.id);
    if (email !== null) await run("UPDATE users SET email=? WHERE id=?", email, target.id);
    if (role !== undefined) await run("UPDATE organization_members SET role=? WHERE user_id=? AND organization_id=?", role, target.id, req.user.organization_id);
    if (status !== undefined) await run("UPDATE organization_members SET status=? WHERE user_id=? AND organization_id=?", status, target.id, req.user.organization_id);
    if (permissions !== undefined && nextRole !== "admin") {
      await run("DELETE FROM member_permissions WHERE user_id=?", target.id);
      for (const row of await all("SELECT name FROM permissions")) await run("INSERT INTO member_permissions(user_id,permission,granted) VALUES(?,?,?)", target.id, row.name, Number(permissions.includes(row.name)));
    } else if (role === "admin") await run("DELETE FROM member_permissions WHERE user_id=?", target.id);
    if (["disabled","blocked"].includes(status) || permissions !== undefined || email !== null || role !== undefined) await run("DELETE FROM sessions WHERE user_id=?", target.id);
  });
  await recordAudit(req.user.id, role !== undefined ? "user.role_changed" : permissions !== undefined ? "user.permissions_changed" : status !== undefined ? `user.${status}` : "user.updated", "user", target.id);
  res.json(await one(`SELECT u.id,u.name,u.email,m.role,m.status,m.created_at,m.last_login_at FROM users u JOIN organization_members m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?`, target.id, req.user.organization_id));
});
app.delete("/api/admin/users/:id", requirePermission("users.delete"), async (req: any, res) => {
  const target = await one("SELECT user_id,role FROM organization_members WHERE user_id=? AND organization_id=?", req.params.id, req.user.organization_id);
  if (!target) return fail(res, 404, "Colaborador não encontrado.");
  if (target.role === "admin" || Number(target.user_id) === Number(req.user.id)) return fail(res, 403, "Não é permitido remover o administrador atual.");
  await run("UPDATE organization_members SET status='disabled' WHERE user_id=? AND organization_id=?", target.user_id, req.user.organization_id);
  await run("DELETE FROM sessions WHERE user_id=?", target.user_id);
  await recordAudit(req.user.id, "user.disabled", "user", Number(target.user_id));
  res.json({ ok: true });
});
app.get("/api/admin/audit", requirePermission("audit.view"), async (req: any, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json(await all(`SELECT id,actor_user_id,action,target_type,target_id,created_at FROM security_audit
    WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT ?`, req.user.organization_id, limit));
});
app.post("/api/invitations/accept", async (req, res) => {
  if (limited(`invite:ip:${req.ip}`, 10)) return fail(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");
  if (password.length < 12 || password.length > 1024) return fail(res, 422, "A senha deve ter entre 12 e 1024 caracteres.");
  const invite = await one("SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?", sha(token), now());
  if (!invite) return fail(res, 400, "Convite inválido ou expirado.");
  let userId: number;
  try {
    userId = await transaction(async () => {
      const currentInvite = await one("SELECT * FROM invitations WHERE id=? AND accepted_at IS NULL AND expires_at>? FOR UPDATE", invite.id, now());
      if (!currentInvite) throw new Error("invite-expired");
      const user = await run("INSERT INTO users(email,name,hash) VALUES(?,?,?) RETURNING id", invite.email, invite.name, hashPw(password));
      const role = invite.target_role || invite.role;
      await run("INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(?,?,?,?)", Number(user.lastInsertRowid), invite.organization_id, role, "active");
      const updated = await run("UPDATE invitations SET accepted_at=? WHERE id=? AND accepted_at IS NULL", now(), invite.id);
      if (!updated.changes) throw new Error("invite-used");
      return Number(user.lastInsertRowid);
    });
    await recordAudit(userId, "invitation.accepted", "invitation", Number(invite.id));
  } catch { return fail(res, 409, "O convite não pôde ser aceito."); }
  res.json({ ok: true });
});

// ---------- Repertório completo por conta ----------
const REP_MOMENTS = ["entrada", "assinaturas", "saida", "coquetel", "outro", "recepcao", "noiva", "noivo", "padrinhos", "assinatura"];
const repSnapshot = async (organizationId: number) => {
  const musicas = (await all(`SELECT id,event_id,moment,position,title,artist,performer,composer,
    instrumentation,notes,reference_url,owner_user_id FROM repertoire r
    WHERE organization_id=? ORDER BY event_id,moment,position,id`, organizationId))
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
  for (const row of await all("SELECT event_id,moment,duration_minutes FROM repertoire_durations WHERE organization_id=?", organizationId))
    duracoes[`${row.event_id}|${row.moment}`] = row.duration_minutes;
  const statusEventos: Record<string, string> = {};
  for (const row of await all("SELECT event_id,status FROM repertoire_approvals WHERE organization_id=?", organizationId))
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
const repPayload = async (body: any, organizationId: number) => {
  const fields: any = {};
  if (!body || !Array.isArray(body.musicas) || !body.duracoes || typeof body.duracoes !== "object" || Array.isArray(body.duracoes) ||
      !body.statusEventos || typeof body.statusEventos !== "object" || Array.isArray(body.statusEventos))
    return { fields: { repertorio: "Informe músicas, durações e status válidos." } };
  const ids = new Set<number>();
  const songs = await Promise.all(body.musicas.map(async (song: any, index: number) => {
    const key = `musicas.${index}`;
    const id = song?.id == null || song.id === "" ? null : Number(song.id);
    const eventId = Number(song?.evento);
    if (id !== null && (!Number.isInteger(id) || id <= 0 || ids.has(id))) fields[key] = "ID de música inválido ou duplicado.";
    if (id !== null) ids.add(id);
    if (!Number.isInteger(eventId) || eventId <= 0 || !await one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId)) fields[key + ".evento"] = "Evento inexistente ou sem acesso.";
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
  }));
  const durations: Array<{ eventId: number; moment: string; value: number }> = [];
  for (const [key, value] of Object.entries(body.duracoes)) {
    const [event, moment, ...rest] = key.split("|");
    const eventId = Number(event);
    if (rest.length || !Number.isInteger(eventId) || !REP_MOMENTS.includes(moment) || !Number.isInteger(value) || Number(value) < 1 || !await one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId))
      fields[`duracoes.${key}`] = "Duração inválida.";
    else durations.push({ eventId, moment, value: Number(value) });
  }
  const approvals: Array<{ eventId: number; status: string }> = [];
  for (const [event, status] of Object.entries(body.statusEventos)) {
    const eventId = Number(event);
    if (!Number.isInteger(eventId) || !["pendente", "aprovado"].includes(String(status)) || !await one("SELECT id FROM events WHERE id=? AND organization_id=?", eventId, organizationId))
      fields[`statusEventos.${event}`] = "Status de repertório inválido.";
    else approvals.push({ eventId, status: String(status) });
  }
  return Object.keys(fields).length ? { fields } : { songs, durations, approvals };
};
app.use("/api/repertorios", auth, modulePermissions("repertoire"));
app.get("/api/repertorios", async (req: any, res) => res.json(await repSnapshot(req.user.organization_id)));
app.put("/api/repertorios", async (req: any, res) => {
  const parsed = await repPayload(req.body, req.user.organization_id);
  if (parsed.fields) return fail(res, 422, "Repertório inválido.", parsed.fields);
  const { songs, durations, approvals } = parsed as any;
  const existing = (await all("SELECT id FROM repertoire WHERE organization_id=? AND owner_user_id IS NOT NULL", req.user.organization_id)).map((x) => Number(x.id));
  const existingSet = new Set(existing);
  const keep = new Set<number>();
  for (const song of songs) {
    if (song.legacy) continue;
    if (song.id !== null && !existingSet.has(song.id)) {
      const other = await one("SELECT owner_user_id,organization_id FROM repertoire WHERE id=?", song.id);
      if (other) return fail(res, 403, "Esta música não pertence à conta atual.");
      return fail(res, 422, "ID de música desconhecido.");
    }
  }
  await transaction(async () => {
    for (const song of songs) {
      if (song.legacy) continue;
      if (song.id !== null) {
        await run(`UPDATE repertoire SET event_id=?,moment=?,position=?,title=?,artist=?,composer=?,instrumentation=?,notes=?,reference_url=?
          WHERE id=? AND organization_id=? AND owner_user_id IS NOT NULL`, song.eventId, song.moment, song.position, song.title, song.artist, song.composer, song.instrumentation, song.notes || null, song.url || null, song.id, req.user.organization_id);
        keep.add(song.id);
      } else {
        const result = await run(`INSERT INTO repertoire(event_id,moment,position,title,artist,composer,instrumentation,notes,reference_url,owner_user_id,organization_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, song.eventId, song.moment, song.position, song.title, song.artist, song.composer, song.instrumentation, song.notes || null, song.url || null, req.user.id, req.user.organization_id);
        keep.add(Number(result.lastInsertRowid));
      }
    }
    for (const id of existing) if (!keep.has(id)) await run("DELETE FROM repertoire WHERE id=? AND organization_id=? AND owner_user_id IS NOT NULL", id, req.user.organization_id);
    await run("DELETE FROM repertoire_durations WHERE organization_id=?", req.user.organization_id);
    for (const item of durations) await run("INSERT INTO repertoire_durations(user_id,event_id,moment,duration_minutes,organization_id) VALUES(?,?,?,?,?)", req.user.id, item.eventId, item.moment, item.value, req.user.organization_id);
    await run("DELETE FROM repertoire_approvals WHERE organization_id=?", req.user.organization_id);
    for (const item of approvals) await run("INSERT INTO repertoire_approvals(user_id,event_id,status,organization_id) VALUES(?,?,?,?)", req.user.id, item.eventId, item.status, req.user.organization_id);
  });
  res.json(await repSnapshot(req.user.organization_id));
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


