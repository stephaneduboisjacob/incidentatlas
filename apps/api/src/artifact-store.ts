import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const ARTIFACT_ROOT = process.env.INCIDENTATLAS_ARTIFACT_PATH ?? "/var/lib/incidentatlas/artifacts";

export interface StoredArtifact {
  sha256: string;
  objectKey: string;
  sizeBytes: number;
}

export class ArtifactStoreError extends Error {
  constructor(readonly code: "invalid_store" | "integrity_failure" | "storage_failed") {
    super(code);
  }
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function privateRoot(): Promise<string> {
  if (!isAbsolute(ARTIFACT_ROOT)) throw new ArtifactStoreError("invalid_store");
  await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
  const metadata = await lstat(ARTIFACT_ROOT);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ArtifactStoreError("invalid_store");
  return realpath(ARTIFACT_ROOT);
}

function objectPath(root: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ArtifactStoreError("invalid_store");
  return resolve(root, sha256.slice(0, 2), sha256);
}

export async function storeArtifact(content: Buffer): Promise<StoredArtifact> {
  const sha256 = digest(content);
  const root = await privateRoot();
  const target = objectPath(root, sha256);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(target));
  if (!directory.isDirectory() || directory.isSymbolicLink() || !(await realpath(dirname(target))).startsWith(`${root}${sep}`)) {
    throw new ArtifactStoreError("invalid_store");
  }
  const tempPath = join(dirname(target), `.tmp-${createHash("sha256").update(`${process.pid}:${Date.now()}:${sha256}`).digest("hex")}`);
  try {
    const file = await open(tempPath, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(tempPath, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await unlink(tempPath).catch(() => undefined);
    }
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ArtifactStoreError("integrity_failure");
    const existing = await readFile(target);
    if (digest(existing) !== sha256) throw new ArtifactStoreError("integrity_failure");
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError("storage_failed");
  }
  return { sha256, objectKey: sha256, sizeBytes: content.byteLength };
}

export async function readArtifact(objectKey: string, expectedSha256: string): Promise<Buffer> {
  if (objectKey !== expectedSha256 || !/^[a-f0-9]{64}$/.test(objectKey)) throw new ArtifactStoreError("invalid_store");
  const root = await privateRoot();
  const target = objectPath(root, objectKey);
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ArtifactStoreError("integrity_failure");
    const resolved = await realpath(target);
    if (!resolved.startsWith(`${root}${sep}`)) throw new ArtifactStoreError("invalid_store");
    const content = await readFile(target);
    if (digest(content) !== expectedSha256) throw new ArtifactStoreError("integrity_failure");
    return content;
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError("storage_failed");
  }
}
