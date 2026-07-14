import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

export const serverEnvSchema = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://sharebrain:sharebrain@127.0.0.1:5432/sharebrain"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  COLLAB_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  DEV_AUTH_USER_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  DEV_AUTH_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000101"),
  DEV_AUTH_ROLE: z.enum(["viewer", "editor", "admin", "auditor"]).default("admin"),
  AUTH_PASSWORD_REGISTRATION_ENABLED: envBoolean.default(true),
  AUTH_DEV_BYPASS_ENABLED: envBoolean.default(true),
  AUTH_SESSION_COOKIE_NAME: z.string().min(1).default("sharebrain_session"),
  AUTH_SESSION_EXPIRES_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),
  S3_BUCKET: z.string().default("sharebrain-dev"),
  S3_FORCE_PATH_STYLE: envBoolean.default(true),
  MEDIA_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).default(25 * 1024 * 1024),
  MEDIA_AVATAR_MAX_BYTES: z.coerce.number().int().min(1).default(5 * 1024 * 1024),
  MEDIA_UPLOAD_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  MEDIA_READ_URL_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  MEDIA_GC_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  MEDIA_GC_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  MEDIA_GC_PROCESSING_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(300),
  DOCUMENT_VERSION_HISTORY_ENABLED: envBoolean.default(true),
  DOCUMENT_VERSION_RESTORE_ENABLED: envBoolean.default(false),
  DOCUMENT_VERSION_IDLE_SEAL_SECONDS: z.coerce.number().int().min(0).max(86400).default(120),
  DOCUMENT_VERSION_IDLE_SEAL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),
  DOCUMENT_VERSION_IDLE_SEAL_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  DOCUMENT_VERSION_RETENTION_DAYS: z.coerce.number().int().min(0).max(36500).default(90),
  DOCUMENT_VERSION_RETENTION_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(86400),
  DOCUMENT_VERSION_RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  DOCUMENT_VERSION_RETENTION_DRY_RUN: envBoolean.default(true),
  DOCUMENT_VERSION_OPERATION_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  DOCUMENT_ACTIVITY_HISTORY_ENABLED: envBoolean.default(true),
  DOCUMENT_ACTIVITY_IDLE_SEAL_SECONDS: z.coerce.number().int().min(0).max(86400).default(120),
  DOCUMENT_ACTIVITY_IDLE_SEAL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),
  DOCUMENT_ACTIVITY_IDLE_SEAL_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  COLLAB_REPLICA_COUNT: z.coerce.number().int().min(1).default(1),
  COLLAB_SHARED_SYNC_ENABLED: envBoolean.default(false),
  AI_MODEL_PROVIDER: z.string().default("openai-compatible"),
  AI_BASE_URL: z.string().url().optional().or(z.literal("")),
  AI_API_KEY: z.string().optional().or(z.literal("")),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32768).default(4096),
} as const;

export const clientEnvSchema = {
  WEB_PUBLIC_API_BASE_URL: z.string().url().optional().or(z.literal("")).default(""),
  WEB_PUBLIC_COLLAB_WS_URL: z.string().url().default("ws://localhost:3002"),
} as const;

export function loadServerEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    server: serverEnvSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export function loadClientEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    clientPrefix: "WEB_PUBLIC_",
    client: clientEnvSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type ServerEnv = ReturnType<typeof loadServerEnv>;
export type ClientEnv = ReturnType<typeof loadClientEnv>;
