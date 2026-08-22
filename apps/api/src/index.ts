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
    // 默认 10 秒对流式回答远远不够：推理模型的首字延迟经常超过它，
    // 连接会被服务器自己掐断，表现成"回答一直没动静然后失败"。
    idleTimeout: env.API_IDLE_TIMEOUT_SECONDS,
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
