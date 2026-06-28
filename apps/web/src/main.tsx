import "@sharebrain/ui/globals.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少 React 根节点。");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
