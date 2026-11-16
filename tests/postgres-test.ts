import { randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
export const testDatabaseConfigured = Boolean(process.env.TEST_DATABASE_URL?.trim());
const schema = "mwe_test_" + randomBytes(8).toString("hex");
const baseUrl = process.env.TEST_DATABASE_URL?.trim();
if (baseUrl) {
  if (baseUrl === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
  process.env.MWE_TEST_SCHEMA = schema;
  const isolated = new URL(baseUrl);
  isolated.searchParams.set("options", "-c search_path=" + schema);
  process.env.MWE_TEST_DATABASE_URL = isolated.toString();
}
const adminPool = baseUrl ? new Pool({ connectionString: baseUrl, max: 2 }) : undefined;
export const testPool = process.env.MWE_TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.MWE_TEST_DATABASE_URL, max: 3 })
  : undefined;

export async function prepareTestDatabase() {
  if (!adminPool || !testPool) throw new Error("Configure TEST_DATABASE_URL com um PostgreSQL de teste dedicado.");
  await adminPool.query('CREATE SCHEMA "' + schema + '"');
}

export async function createAdditionalTestDatabase() {
  if (!adminPool || !baseUrl) throw new Error("Configure TEST_DATABASE_URL com um PostgreSQL de teste dedicado.");
  const extraSchema = "mwe_test_" + randomBytes(8).toString("hex");
  await adminPool.query('CREATE SCHEMA "' + extraSchema + '"');
  const isolated = new URL(baseUrl);
  isolated.searchParams.set("options", "-c search_path=" + extraSchema);
  return {
    url: isolated.toString(),
    async close() { await adminPool.query('DROP SCHEMA IF EXISTS "' + extraSchema + '" CASCADE'); },
  };
}

export async function queryTestDatabase(sql: string, ...params: unknown[]) {
  if (!testPool) throw new Error("TEST_DATABASE_URL não está configurada.");
  let index = 0;
  const statement = sql.replace(/\?/g, () => "$" + ++index);
  return testPool.query(statement, params);
}

export async function cleanTestDatabase() {
  if (testPool) await testPool.end();
  if (adminPool) {
    await adminPool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await adminPool.end();
  }
}
