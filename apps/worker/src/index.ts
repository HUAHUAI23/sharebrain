import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import { authContextSchema, workerHealthResponseSchema } from "@sharebrain/contracts";
import { createDatabaseClient } from "@sharebrain/db";

import { runMediaGarbageCollection } from "./jobs/media-gc";

const env = loadServerEnv();

export function getWorkerHealth() {
  return workerHealthResponseSchema.parse({
    ok: true,
    service: "worker",
    version: "0.1.0",
  });
}

if (import.meta.main) {
  const db = createDatabaseClient(env.DATABASE_URL);
  const auth = authContextSchema.parse({
    userId: env.DEV_AUTH_USER_ID,
    tenantId: env.DEV_AUTH_TENANT_ID,
    role: env.DEV_AUTH_ROLE,
    requestId: "worker-startup",
  });
  const gc = await runMediaGarbageCollection(db, auth);
  console.info(
    `ShareBrain worker started with concurrency=${env.WORKER_CONCURRENCY}. ${JSON.stringify(
      getWorkerHealth(),
    )}. mediaGc=${JSON.stringify(gc)}`,
  );

  await new Promise(() => {
    process.once("SIGTERM", () => process.exit(0));
    process.once("SIGINT", () => process.exit(0));
  });
}
