import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, inTransaction } from "./database.js";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
const migrationDirectory = resolve(projectRoot, "db/migrations");
const pool = getPool();

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  for (const name of names) {
    const sql = await readFile(resolve(migrationDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await inTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(498736241)");
      const existing = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE version = $1", [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has changed`);
        return;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [name, checksum]);
    });
  }
  console.info(JSON.stringify({ event: "database.migrations.complete", count: names.length }));
} finally {
  await pool.end();
}
