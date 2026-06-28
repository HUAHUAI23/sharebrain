import { loadServerEnv } from "@sharebrain/config";
import { workerHealthResponseSchema } from "@sharebrain/contracts";

const env = loadServerEnv();

export function getWorkerHealth() {
  return workerHealthResponseSchema.parse({
    ok: true,
    service: "worker",
    version: "0.1.0",
  });
}

if (import.meta.main) {
  console.info(
    `ShareBrain worker started with concurrency=${env.WORKER_CONCURRENCY}. ${JSON.stringify(
      getWorkerHealth(),
    )}`,
  );

  await new Promise(() => {
    process.once("SIGTERM", () => process.exit(0));
    process.once("SIGINT", () => process.exit(0));
  });
}
