import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { testDatabaseConfigured, createAdditionalTestDatabase } from "./postgres-test.js";

const test = (name: string, fn: (...args: any[]) => any) => nodeTest(name, { skip: !testDatabaseConfigured }, fn as any);
const { Pool } = pg;

test("migração SQLite preserva dados e relacionamentos no PostgreSQL e deixa backup", async () => {
  const target = await createAdditionalTestDatabase();
  const folder = mkdtempSync(join(tmpdir(), "mwe-sqlite-migration-"));
  const sourcePath = join(folder, "source.db");
  const sqlite = new DatabaseSync(sourcePath);
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,hash TEXT NOT NULL,role TEXT);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT);
    CREATE TABLE organization_members(user_id INTEGER PRIMARY KEY REFERENCES users(id),organization_id INTEGER NOT NULL REFERENCES organizations(id),role TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT,last_login_at INTEGER,UNIQUE(user_id,organization_id));
    CREATE TABLE permissions(name TEXT PRIMARY KEY,description TEXT NOT NULL);
    CREATE TABLE role_permissions(role TEXT NOT NULL,permission TEXT NOT NULL REFERENCES permissions(name),PRIMARY KEY(role,permission));
    CREATE TABLE member_permissions(user_id INTEGER NOT NULL REFERENCES users(id),permission TEXT NOT NULL REFERENCES permissions(name),granted INTEGER NOT NULL,PRIMARY KEY(user_id,permission));
    CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT,phone TEXT,notes TEXT,created_at TEXT,organization_id INTEGER NOT NULL REFERENCES organizations(id));
    CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT,date TEXT,start_time TEXT,client_id INTEGER REFERENCES clients(id),contact TEXT,venue TEXT,city TEXT,uf TEXT,lineup TEXT,notes TEXT,status TEXT NOT NULL,created_at TEXT,updated_at TEXT,end_time TEXT,attire TEXT,crew_arrival TEXT,venue_contact TEXT,critical_notes TEXT,contract_value REAL,organization_id INTEGER NOT NULL REFERENCES organizations(id));
    CREATE TABLE finances(id INTEGER PRIMARY KEY,event_id INTEGER REFERENCES events(id),description TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,paid_date TEXT,status TEXT NOT NULL,installment TEXT,created_at TEXT,organization_id INTEGER NOT NULL REFERENCES organizations(id));
    CREATE TABLE integrantes_equipe(id INTEGER PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT,organization_id INTEGER NOT NULL REFERENCES organizations(id));
    CREATE TABLE repertoire(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),moment TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,performer TEXT,notes TEXT,artist TEXT,composer TEXT,instrumentation TEXT,reference_url TEXT,owner_user_id INTEGER REFERENCES users(id),organization_id INTEGER NOT NULL REFERENCES organizations(id));
    CREATE TABLE company_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id),nome TEXT NOT NULL,exibicao TEXT NOT NULL,email TEXT NOT NULL,telefone TEXT NOT NULL,idioma TEXT,moeda TEXT,formato TEXT,fuso TEXT,novosEventos INTEGER,vencimentos INTEGER,escalas INTEGER,updated_at TEXT,organization_id INTEGER NOT NULL REFERENCES organizations(id));
    INSERT INTO organizations(id,name,created_at) VALUES(3,'Organização de teste','2026-01-01');
    INSERT INTO users(id,email,name,hash,role) VALUES(7,'migrado@example.test','Usuário migrado','salt:hash','admin');
    INSERT INTO organization_members(user_id,organization_id,role,status) VALUES(7,3,'admin','active');
    INSERT INTO permissions(name,description) VALUES('events.view','Consultar eventos');
    INSERT INTO role_permissions(role,permission) VALUES('admin','events.view');
    INSERT INTO clients(id,name,organization_id) VALUES(11,'Cliente migrado',3);
    INSERT INTO events(id,name,date,client_id,status,organization_id) VALUES(13,'Evento migrado','2027-04-03',11,'confirmado',3);
    INSERT INTO finances(id,event_id,description,amount,due_date,status,organization_id) VALUES(17,13,'Sinal migrado',200,'2027-03-01','pendente',3);
    INSERT INTO integrantes_equipe(id,name,role,phone,status,organization_id) VALUES(19,'Equipe migrada','Músico','41999990000','ativo',3);
    INSERT INTO repertoire(id,event_id,moment,position,title,organization_id) VALUES(23,13,'entrada',1,'Canção migrada',3);
    INSERT INTO company_settings(user_id,nome,exibicao,email,telefone,novosEventos,vencimentos,escalas,organization_id) VALUES(7,'Empresa','Empresa','empresa@example.test','41999990000',1,0,1,3);
  `);
  sqlite.close();

  try {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/migrate-sqlite-to-postgres.ts", sourcePath], {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: target.url, ADMIN_EMAIL: "", ADMIN_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    const exitCode = await new Promise<number>((resolveExit) => child.once("close", (code) => resolveExit(code ?? 1)));
    assert.equal(exitCode, 0, stderr);
    assert.equal(stdout.includes(target.url), false, "não imprime a URL de conexão");
    assert.equal(existsSync(sourcePath), true, "preserva o SQLite de origem");
    assert.ok(readdirSync(folder).some((file) => file.startsWith("source.db.backup-")), "cria backup SQLite");

    const pgPool = new Pool({ connectionString: target.url, max: 1 });
    try {
      assert.equal((await pgPool.query("SELECT e.name,c.name AS client_name,f.description,r.title FROM events e JOIN clients c ON c.id=e.client_id JOIN finances f ON f.event_id=e.id JOIN repertoire r ON r.event_id=e.id WHERE e.id=13")).rows[0].client_name, "Cliente migrado");
      assert.equal((await pgPool.query("SELECT role FROM organization_members WHERE user_id=7")).rows[0].role, "admin");
      assert.equal((await pgPool.query("SELECT novosEventos,vencimentos FROM company_settings WHERE user_id=7")).rows[0].novoseventos, 1);
      const next = await pgPool.query("INSERT INTO clients(name,organization_id) VALUES('Após migração',3) RETURNING id");
      assert.ok(Number(next.rows[0].id) > 11, "sequence continua acima dos IDs importados");
    } finally { await pgPool.end(); }
  } finally {
    await target.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
