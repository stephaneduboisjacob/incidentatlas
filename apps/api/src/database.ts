import { Pool, type PoolClient } from "pg";
import { requiredEnv } from "./env.js";

let singleton: Pool | undefined;

export function getPool(): Pool {
  singleton ??= new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    application_name: "incidentatlas-api",
    max: 12,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return singleton;
}

export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
