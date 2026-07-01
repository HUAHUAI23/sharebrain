import "@sharebrain/ui/globals.css";
import "./styles/app.css";

import { m } from "@sharebrain/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";

const root = document.getElementById("root");

if (!root) {
  throw new Error(m.error_render_details());
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
