import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";

import { createApp } from "./app/create-app";
import { createAppDependencies } from "./app/middleware";
import { AiChatService } from "./modules/ai/ai-chat.service";

const env = loadServerEnv();

if (import.meta.main) {
  const dependencies = createAppDependencies(env);
  const app = createApp({ dependencies });
  const server = Bun.serve({
    fetch: app.fetch,
    port: env.API_PORT,
  });
  const recoveryService = new AiChatService(dependencies.db, env);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeRecovery: Promise<void> | undefined;
  const scheduleRecovery = () => {
    timer = setTimeout(() => {
      activeRecovery = recoveryService.recoverRuns()
        .then((result) => {
          if (result.claimed > 0) console.info(`aiRunRecovery=${JSON.stringify(result)}`);
        })
        .catch((error) => {
          console.error(JSON.stringify({
            event: "ai.run_recovery_cycle_failed",
            errorType: error instanceof Error ? error.name : "UnknownError",
          }));
        })
        .finally(() => {
          activeRecovery = undefined;
          if (!stopped) scheduleRecovery();
        });
    }, env.AI_RUN_RECOVERY_INTERVAL_SECONDS * 1000);
  };

  console.info(`ShareBrain API listening on http://localhost:${env.API_PORT}`);
  scheduleRecovery();

  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  stopped = true;
  if (timer) clearTimeout(timer);
  await activeRecovery;
  server.stop(true);
  await dependencies.db.$client.end({ timeout: 5 });
}
