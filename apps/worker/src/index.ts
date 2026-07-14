import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import { workerHealthResponseSchema } from "@sharebrain/contracts";
import { createDatabaseClient } from "@sharebrain/db";

import { runDocumentVersionIdleSeal } from "./jobs/document-version-idle-seal";
import { runDocumentActivityIdleSeal } from "./jobs/document-activity-idle-seal";
import { runMediaGarbageCollection } from "./jobs/media-gc";
import { runDocumentVersionRetention } from "./jobs/document-version-retention";

const env = loadServerEnv();

export function getWorkerHealth() {
  return workerHealthResponseSchema.parse({
    ok: true,
    service: "worker",
    version: "0.1.0",
  });
}

function createRecurringTask<T>(input: {
  intervalMs: number;
  name: string;
  run: () => Promise<T>;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeRun: Promise<void> | undefined;

  const execute = async () => {
    try {
      const result = await input.run();
      console.info(`${input.name}=${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`${input.name} failed`, error);
    }
  };
  const schedule = () => {
    timer = setTimeout(() => {
      activeRun = execute().finally(() => {
        activeRun = undefined;
        if (!stopped) schedule();
      });
    }, input.intervalMs);
  };

  return {
    runNow: execute,
    start: schedule,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await activeRun;
    },
  };
}

if (import.meta.main) {
  const db = createDatabaseClient(env.DATABASE_URL);
  const gcTask = createRecurringTask({
    intervalMs: env.MEDIA_GC_INTERVAL_SECONDS * 1000,
    name: "mediaGc",
    run: () => runMediaGarbageCollection(db, env),
  });
  const idleSealTask = createRecurringTask({
    intervalMs: env.DOCUMENT_VERSION_IDLE_SEAL_INTERVAL_SECONDS * 1000,
    name: "documentVersionIdleSeal",
    run: () => runDocumentVersionIdleSeal(db, env),
  });
  const activityIdleSealTask = createRecurringTask({
    intervalMs: env.DOCUMENT_ACTIVITY_IDLE_SEAL_INTERVAL_SECONDS * 1000,
    name: "documentActivityIdleSeal",
    run: () => runDocumentActivityIdleSeal(db, env),
  });
  const retentionTask = createRecurringTask({
    intervalMs: env.DOCUMENT_VERSION_RETENTION_INTERVAL_SECONDS * 1000,
    name: "documentVersionRetention",
    run: () => runDocumentVersionRetention(db, env),
  });
  await Promise.all([
    gcTask.runNow(),
    idleSealTask.runNow(),
    activityIdleSealTask.runNow(),
    retentionTask.runNow(),
  ]);
  console.info(
    `ShareBrain worker started with concurrency=${env.WORKER_CONCURRENCY}. ${JSON.stringify(getWorkerHealth())}`,
  );
  gcTask.start();
  if (env.DOCUMENT_VERSION_IDLE_SEAL_SECONDS > 0) idleSealTask.start();
  if (
    env.DOCUMENT_ACTIVITY_HISTORY_ENABLED &&
    env.DOCUMENT_ACTIVITY_IDLE_SEAL_SECONDS > 0
  ) {
    activityIdleSealTask.start();
  }
  retentionTask.start();

  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  await Promise.all([
    gcTask.stop(),
    idleSealTask.stop(),
    activityIdleSealTask.stop(),
    retentionTask.stop(),
  ]);
  await db.$client.end({ timeout: 5 });
}
