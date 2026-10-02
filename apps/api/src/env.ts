import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(moduleDirectory, "../../../");

dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required configuration ${name} is missing`);
  return value;
}

export function publicOrigin(): string {
  const value = process.env.INCIDENTATLAS_PUBLIC_ORIGIN ?? "http://localhost:5173";
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.origin !== value) {
    throw new Error("INCIDENTATLAS_PUBLIC_ORIGIN must be an HTTP(S) origin without a path");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("INCIDENTATLAS_PUBLIC_ORIGIN must use HTTPS in production");
  }
  return value;
}

export function validateProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;
  for (const name of [
    "INCIDENTATLAS_SETUP_TOKEN",
    "INCIDENTATLAS_ENROLLMENT_TOKEN",
    "INCIDENTATLAS_SESSION_SECRET",
  ]) {
    if (requiredEnv(name).length < 32) throw new Error(`${name} must contain at least 32 characters in production`);
  }
  publicOrigin();
  requiredEnv("DATABASE_URL");
}
