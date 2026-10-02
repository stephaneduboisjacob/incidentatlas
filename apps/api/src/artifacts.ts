import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getUserSession } from "./auth.js";
import { inTransaction } from "./database.js";
import { ArtifactStoreError, artifactDigest, readArtifact, storeArtifact } from "./artifact-store.js";
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
      const sha256 = artifactDigest(content);
      const artifactId = randomUUID();
      const result = await inTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`artifact:${sha256}`]);
        const existing = await client.query<{ id: string; sha256: string }>(
          "SELECT id, sha256 FROM artifacts WHERE organization_id = $1 AND sha256 = $2 FOR UPDATE",
          [collector.organization_id, sha256],
        );
        const stored = await storeArtifact(content);
        if (existing.rows[0]) {
          await client.query(
            "UPDATE artifacts SET purged_at = NULL, purge_reason = NULL, created_at = now() WHERE organization_id = $1 AND id = $2",
            [collector.organization_id, existing.rows[0].id],
          );
          return { id: existing.rows[0].id, deduplicated: true };
        }
        await client.query(
          `INSERT INTO artifacts (id, organization_id, sha256, object_key, mime_type, size_bytes, source, redaction_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [artifactId, collector.organization_id, stored.sha256, stored.objectKey, parsed.data.mime_type,
            stored.sizeBytes, `collector:${parsed.data.kind}`, parsed.data.redaction_status],
        );
        await client.query(
          `INSERT INTO audit_events (id, organization_id, action, target_type, target_id, attributes)
           VALUES ($1, $2, 'artifact.uploaded', 'artifact', $3, $4::jsonb)`,
          [newId(), collector.organization_id, artifactId, JSON.stringify({ collector_id: collector.id, sha256: stored.sha256, size_bytes: stored.sizeBytes })],
        );
        return { id: artifactId, deduplicated: false };
      });
      const stored = { sha256, sizeBytes: content.byteLength };
      return reply.code(201).send({ artifact_id: result.id, sha256: stored.sha256, size_bytes: stored.sizeBytes, deduplicated: result.deduplicated });
    } catch (caught) {
      request.log.error({ event: "artifact.upload.failed", collector_id: collector.id });
      return error(reply, 503, "artifact_storage_unavailable");
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/artifacts/:id", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) return error(reply, 400, "invalid_artifact_id");
    try {
      const outcome = await inTransaction(pool, async (client) => {
        const preview = await client.query<{ id: string; sha256: string; purged_at: Date | null }>(
          "SELECT id, sha256, purged_at FROM artifacts WHERE organization_id = $1 AND id = $2",
          [session.user.organizationId, id.data],
        );
        const first = preview.rows[0];
        if (!first) return { status: "missing" as const };
        if (first.purged_at) return { status: "expired" as const };
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`artifact:${first.sha256}`]);
        const locked = await client.query<{ id: string; sha256: string; object_key: string; size_bytes: string; purged_at: Date | null }>(
          `SELECT id, sha256, object_key, size_bytes, purged_at FROM artifacts
            WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
          [session.user.organizationId, id.data],
        );
        const artifact = locked.rows[0];
        if (!artifact) return { status: "missing" as const };
        if (artifact.purged_at) return { status: "expired" as const };
        const content = await readArtifact(artifact.object_key, artifact.sha256);
        if (content.length !== Number(artifact.size_bytes) || content.length > MAX_ARTIFACT_BYTES) {
          throw new ArtifactStoreError("integrity_failure");
        }
        await client.query(
          `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
           VALUES ($1, $2, $3, 'artifact.downloaded', 'artifact', $4, $5::jsonb)`,
          [newId(), session.user.organizationId, session.user.id, artifact.id, JSON.stringify({ sha256: artifact.sha256, size_bytes: content.length })],
        );
        return { status: "ready" as const, artifact, content };
      });
      if (outcome.status === "missing") return error(reply, 404, "artifact_not_found");
      if (outcome.status === "expired") return error(reply, 410, "artifact_expired");
      const { artifact, content } = outcome;
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
