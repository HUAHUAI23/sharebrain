import "@sharebrain/config/dotenv";

import { createApp } from "../app/create-app";
import type { AppDependencies } from "../app/middleware";

import { loadServerEnv, type ServerEnv } from "@sharebrain/config";
import { createDatabaseClient, type DatabaseClient } from "@sharebrain/db";

type TestApp = {
  app: ReturnType<typeof createApp>;
  db: DatabaseClient;
  env: ServerEnv;
  close: () => Promise<void>;
};

export function createTestApp(runtimeEnv: Record<string, string | undefined> = process.env): TestApp {
  const env = loadServerEnv(runtimeEnv);
  const db = createDatabaseClient(env.DATABASE_URL);
  const dependencies: AppDependencies = { env, db };
  const app = createApp({ dependencies });

  return {
    app,
    db,
    env,
    close: () => db.$client.end({ timeout: 1 }),
  };
}
