import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";

import { createApp } from "./app/create-app";

const env = loadServerEnv();
const app = createApp();

if (import.meta.main) {
  Bun.serve({
    fetch: app.fetch,
    port: env.API_PORT,
  });

  console.info(`ShareBrain API listening on http://localhost:${env.API_PORT}`);
}
