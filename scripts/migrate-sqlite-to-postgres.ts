import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { initializePostgres, pool } from "../database.js";

const sourcePath = resolve(process.argv[2] || "harmonize.db");
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL antes da migração.");
if (!existsSync(sourcePath)) throw new Error("Arquivo SQLite não encontrado: " + basename(sourcePath) + ".");
if (existsSync(sourcePath + "-wal")) throw new Error("Feche o servidor e checkpoint o WAL antes da migração; nenhum dado foi alterado.");

const backupPath = resolve(dirname(sourcePath), basename(sourcePath) + ".backup-" + new Date().toISOString().replace(/[:.]/g, "-"));
copyFileSync(sourcePath, backupPath, 1);
const source = new DatabaseSync(backupPath, { readOnly: true });
const integrity = source.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
if (integrity.integrity_check !== "ok") { source.close(); throw new Error("O backup SQLite não passou no integrity_check; migração cancelada."); }
const foreignKeyProblems = source.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyProblems.length) { source.close(); throw new Error("SQLite contém " + foreignKeyProblems.length + " inconsistência(s) de chave estrangeira; migração cancelada."); }

const tables = [
  "users", "organizations", "permissions", "organization_members", "role_permissions", "member_permissions",
  "sessions", "resets", "security_audit", "clients", "events", "finances", "integrantes_equipe",
  "team_members", "event_members", "repertoire", "repertoire_durations", "repertoire_approvals",
  "company_settings", "invitations", "payments",
];
const existingSourceTables = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name));
const unrecognizedTables = [...existingSourceTables].filter((table) => !tables.includes(table));
if (unrecognizedTables.length) { source.close(); throw new Error("Tabelas SQLite sem mapeamento: " + unrecognizedTables.join(", ") + ". Migração cancelada para evitar perda de dados."); }
const requiredTables = ["users", "organizations", "organization_members", "permissions", "role_permissions", "clients", "events", "finances", "integrantes_equipe", "repertoire"];
const missingRequiredTables = requiredTables.filter((table) => !existingSourceTables.has(table));
if (missingRequiredTables.length) { source.close(); throw new Error("Tabelas obrigatórias ausentes no SQLite: " + missingRequiredTables.join(", ") + ". Migração cancelada."); }
const requiredOrganizationTables = ["clients", "events", "finances", "integrantes_equipe", "repertoire"];
const sourceTablesMissingRequiredOrganization = requiredOrganizationTables.filter((table) =>
  existingSourceTables.has(table) && !(source.prepare("PRAGMA table_info('" + table + "')").all() as { name: string }[]).some((column) => column.name === "organization_id"),
);
if (sourceTablesMissingRequiredOrganization.length) {
  source.close();
  throw new Error("O SQLite não possui organization_id em: " + sourceTablesMissingRequiredOrganization.join(", ") + ". Faça a migração de organização anterior antes desta etapa.");
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
try {
  await initializePostgres((value) => sha(value), { bootstrap: false });
} catch (error) {
  source.close();
  await pool.end();
  throw error;
}
const client = await pool.connect();
let imported: Record<string, number> = {};
try {
  await client.query("BEGIN");
  for (const table of tables) {
    const result = await client.query("SELECT COUNT(*)::int AS count FROM " + table);
    if (result.rows[0].count !== 0) throw new Error("A tabela " + table + " do PostgreSQL já contém dados; use um banco de destino vazio.");
  }

  const order = tables.filter((table) => existingSourceTables.has(table));
  for (const table of order) {
    const sourceColumns = (source.prepare("PRAGMA table_info('" + table + "')").all() as { name: string }[]).map((column) => column.name);
    const targetColumnsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position", [table]);
    const targetColumns = new Set<string>(targetColumnsResult.rows.map((column) => column.column_name));
    const targetByLowercase = new Map<string, string>([...targetColumns].map((column) => [column.toLowerCase(), column]));
    const columnMap = sourceColumns.map((column) => ({ source: column, target: targetColumns.has(column) ? column : targetByLowercase.get(column.toLowerCase()) }));
    const unmappedColumns = columnMap.filter((column) => !column.target).map((column) => column.source);
    if (unmappedColumns.length) throw new Error("Colunas SQLite sem destino em " + table + ": " + unmappedColumns.join(", ") + ". Migração cancelada para evitar perda de dados.");
    const mapped = columnMap as { source: string; target: string }[];
    const rows = source.prepare("SELECT " + mapped.map((column) => '"' + column.source + '" AS "' + column.target + '"').join(",") + ' FROM "' + table + '"').all() as Record<string, unknown>[];
    const columns = mapped.map((column) => column.target);
    for (let start = 0; start < rows.length; start += 300) {
      const batch = rows.slice(start, start + 300);
      const params: unknown[] = [];
      const valueSql = batch.map((row) => "(" + columns.map((column) => {
        params.push(row[column] ?? null);
        return "$" + params.length;
      }).join(",") + ")").join(",");
      await client.query('INSERT INTO "' + table + '" (' + columns.map((column) => '"' + column + '"').join(",") + ") VALUES " + valueSql, params);
    }
    imported[table] = rows.length;
  }

  for (const table of tables) {
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1", [table]);
    if (columns.rows.some((column) => column.column_name === "id")) {
      const sequenceUpdate = "SELECT setval(pg_get_serial_sequence('" + table + "', 'id'), COALESCE((SELECT MAX(id) FROM \"" + table + "\"), 1), EXISTS(SELECT 1 FROM \"" + table + "\"))";
      await client.query(sequenceUpdate);
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  source.close();
  await pool.end();
}

console.log("Migração concluída. O banco SQLite original foi preservado.");
console.log("Backup verificado: " + basename(backupPath));
console.log("Registros importados por tabela:", imported);
