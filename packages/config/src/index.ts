import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const serverEnvSchema = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://sharebrain:sharebrain@127.0.0.1:5432/sharebrain"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  COLLAB_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  AI_MODEL_PROVIDER: z.string().default("openai-compatible"),
  AI_BASE_URL: z.string().url().optional().or(z.literal("")),
  AI_API_KEY: z.string().optional().or(z.literal("")),
} as const;

export const clientEnvSchema = {
  WEB_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:3001"),
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
