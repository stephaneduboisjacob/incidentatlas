import { getPool } from "./database.js";
import { validateProductionSecrets } from "./env.js";
import { createApp } from "./app.js";

validateProductionSecrets();
const pool = getPool();
const app = await createApp(pool);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3080);

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");

await app.listen({ host, port });
app.log.info({ event: "api.started", host, port });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ event: "api.shutdown", signal });
  await app.close();
  await pool.end();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
