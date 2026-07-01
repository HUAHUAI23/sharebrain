import { createHash, randomBytes } from "node:crypto";

import type { ServerEnv } from "@sharebrain/config";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiresAt(env: ServerEnv) {
  return new Date(Date.now() + env.AUTH_SESSION_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}
