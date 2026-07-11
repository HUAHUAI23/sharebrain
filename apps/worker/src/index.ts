import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import { workerHealthResponseSchema } from "@sharebrain/contracts";
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
  const runGc = async () => runMediaGarbageCollection(db, env);
  const gc = await runGc();
  console.info(
    `ShareBrain worker started with concurrency=${env.WORKER_CONCURRENCY}. ${JSON.stringify(
      getWorkerHealth(),
    )}. mediaGc=${JSON.stringify(gc)}`,
  );

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeRun: Promise<void> | undefined;
  const schedule = () => {
    timer = setTimeout(() => {
      activeRun = runGc()
        .then((result) => console.info(`mediaGc=${JSON.stringify(result)}`))
        .catch(console.error)
        .finally(() => {
          activeRun = undefined;
          if (!stopped) schedule();
        });
    }, env.MEDIA_GC_INTERVAL_SECONDS * 1000);
  };
  schedule();

  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  stopped = true;
  if (timer) clearTimeout(timer);
  await activeRun;
  await db.$client.end({ timeout: 5 });
}
