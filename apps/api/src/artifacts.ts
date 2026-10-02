import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getUserSession } from "./auth.js";
import { inTransaction } from "./database.js";
import { ArtifactStoreError, readArtifact, storeArtifact } from "./artifact-store.js";
import { getCollectorIdentity } from "./collectors.js";
import { newId } from "./security.js";

const MAX_ARTIFACT_BYTES = 1_048_576;
const ArtifactUploadSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  mime_type: z.enum(["application/json", "text/plain", "text/x-diff", "application/octet-stream"]),
  content_base64: z.string().min(4).max(1_400_000),
  redaction_status: z.enum(["redacted", "not_applicable"]),
}).strict();

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

export function registerArtifactRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/v1/collector/artifacts", { bodyLimit: 2_097_152 }, async (request, reply) => {
    const collector = await getCollectorIdentity(pool, request);
    if (!collector) return error(reply, 401, "collector_authentication_failed");
    const parsed = ArtifactUploadSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_artifact");
    const content = Buffer.from(parsed.data.content_base64, "base64");
    if (content.length === 0 || content.length > MAX_ARTIFACT_BYTES || content.toString("base64") !== parsed.data.content_base64) {
      return error(reply, 400, "invalid_artifact_content");
    }

    try {
      const stored = await storeArtifact(content);
      const artifactId = randomUUID();
      const result = await inTransaction(pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO artifacts (id, organization_id, sha256, object_key, mime_type, size_bytes, source, redaction_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING RETURNING id`,
          [artifactId, collector.organization_id, stored.sha256, stored.objectKey, parsed.data.mime_type,
            stored.sizeBytes, `collector:${parsed.data.kind}`, parsed.data.redaction_status],
        );
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO audit_events (id, organization_id, action, target_type, target_id, attributes)
             VALUES ($1, $2, 'artifact.uploaded', 'artifact', $3, $4::jsonb)`,
            [newId(), collector.organization_id, artifactId, JSON.stringify({ collector_id: collector.id, sha256: stored.sha256, size_bytes: stored.sizeBytes })],
          );
          return { id: artifactId, deduplicated: false };
        }
        const existing = await client.query<{ id: string; sha256: string }>(
          `SELECT id, sha256 FROM artifacts
            WHERE organization_id = $1 AND (id = $2 OR sha256 = $3)
            LIMIT 1`,
          [collector.organization_id, artifactId, stored.sha256],
        );
        if (existing.rows[0]?.sha256 === stored.sha256) return { id: existing.rows[0].id, deduplicated: true };
        throw new Error("artifact_id_conflict");
      });
      return reply.code(201).send({ artifact_id: result.id, sha256: stored.sha256, size_bytes: stored.sizeBytes, deduplicated: result.deduplicated });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "artifact_id_conflict") return error(reply, 409, "artifact_conflict");
      request.log.error({ event: "artifact.upload.failed", collector_id: collector.id });
      return error(reply, 503, "artifact_storage_unavailable");
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/artifacts/:id", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) return error(reply, 400, "invalid_artifact_id");
    const result = await pool.query<{ id: string; sha256: string; object_key: string; mime_type: string; size_bytes: string }>(
      `SELECT id, sha256, object_key, mime_type, size_bytes
         FROM artifacts WHERE organization_id = $1 AND id = $2`,
      [session.user.organizationId, id.data],
    );
    const artifact = result.rows[0];
    if (!artifact) return error(reply, 404, "artifact_not_found");
    try {
      const content = await readArtifact(artifact.object_key, artifact.sha256);
      if (content.length !== Number(artifact.size_bytes) || content.length > MAX_ARTIFACT_BYTES) return error(reply, 503, "artifact_integrity_failure");
      await pool.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
         VALUES ($1, $2, $3, 'artifact.downloaded', 'artifact', $4, $5::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, artifact.id, JSON.stringify({ sha256: artifact.sha256, size_bytes: content.length })],
      );
      return reply
        .type("application/octet-stream")
        .header("content-disposition", `attachment; filename="evidence-${artifact.id}"`)
        .header("content-length", content.length)
        .header("cache-control", "no-store")
        .header("x-artifact-sha256", artifact.sha256)
        .send(content);
    } catch (caught) {
      const code = caught instanceof ArtifactStoreError && caught.code === "integrity_failure" ? "artifact_integrity_failure" : "artifact_unavailable";
      return error(reply, 503, code);
    }
  });
}
