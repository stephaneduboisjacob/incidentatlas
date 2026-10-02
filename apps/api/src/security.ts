import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { publicOrigin } from "./env.js";

const SESSION_COOKIE = "ia_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

export function safeEqual(left: string | Buffer, right: string | Buffer): boolean {
  const a = sha256(left);
  const b = sha256(right);
  return timingSafeEqual(a, b);
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfToken(sessionToken: string): string {
  const key = process.env.INCIDENTATLAS_SESSION_SECRET ?? "development-only-session-secret";
  return createHmac("sha256", key).update(`incidentatlas-csrf:v1:${sessionToken}`).digest("base64url");
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readSessionCookie(request: FastifyRequest): string | undefined {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === SESSION_COOKIE) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
    }
  }
  return undefined;
}

export function assertRequestOrigin(request: FastifyRequest): void {
  if (request.headers.origin !== publicOrigin()) throw new Error("origin_mismatch");
}

export function assertCsrf(request: FastifyRequest, token: string): void {
  const supplied = request.headers["x-csrf-token"];
  if (typeof supplied !== "string" || !safeEqual(supplied, csrfToken(token))) throw new Error("csrf_invalid");
  assertRequestOrigin(request);
}

export function newId(): string {
  return randomUUID();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, keyHex] = encoded.split("$");
  if (algorithm !== "scrypt" || n !== "32768" || r !== "8" || p !== "1" || !saltText || !keyHex || !/^[0-9a-f]{128}$/.test(keyHex)) {
    return false;
  }
  const key = await derivePasswordKey(password, Buffer.from(saltText, "base64url"));
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}
