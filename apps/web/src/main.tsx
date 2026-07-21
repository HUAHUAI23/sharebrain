// 在业务模块渲染前完成公开运行时配置初始化。
import "@sharebrain/ui/globals.css";
import "./styles/app.css";

import { m } from "@sharebrain/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import { initializeRuntimeEnv } from "./lib/runtime-env";

const root = document.getElementById("root");

if (!root) {
  throw new Error(m.error_render_details());
}

async function start(container: HTMLElement) {
  await initializeRuntimeEnv();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start(root).catch((error: unknown) => {
  console.error("ShareBrain runtime configuration failed", error);
  root.textContent = m.error_render_details();
});
