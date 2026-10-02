import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { publicOrigin } from "./env.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCollectorRoutes } from "./collectors.js";
import { registerEventRoutes } from "./events.js";
import { registerIncidentRoutes } from "./incidents.js";
import { registerArtifactRoutes } from "./artifacts.js";
import { registerPostmortemRoutes } from "./postmortems.js";
import { registerRetentionRoutes } from "./retention.js";

const webDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../apps/web/dist");

export async function createApp(pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 2_097_152,
    logger: {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-csrf-token",
          "req.body.password",
          "req.body.setup_token",
          "req.body.enrollment_token",
          "req.body.credential",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  await app.register(helmet, {
    hsts: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xFrameOptions: { action: "deny" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 1_200, timeWindow: "1 minute" });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  registerAuthRoutes(app, pool);
  registerCollectorRoutes(app, pool);
  registerArtifactRoutes(app, pool);
  registerEventRoutes(app, pool);
  registerIncidentRoutes(app, pool);
  registerPostmortemRoutes(app, pool);
  registerRetentionRoutes(app, pool);

  if (existsSync(resolve(webDirectory, "index.html"))) {
    await app.register(fastifyStatic, { root: webDirectory, prefix: "/", wildcard: false, index: ["index.html"] });
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "not_found" } }));
  } else {
    app.get("/", async () => ({ name: "IncidentAtlas", status: "web assets not built" }));
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "not_found" } }));
  }

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    request.log.error({ event: "request.failed", status_code: statusCode });
    const status = statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    return reply.code(status).send({ error: { code: status === 413 ? "payload_too_large" : "request_failed" } });
  });
  return app;
}

export function getPublicOrigin(): string {
  return publicOrigin();
}
