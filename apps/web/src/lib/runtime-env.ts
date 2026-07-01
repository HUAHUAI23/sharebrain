import { loadClientEnv } from "@sharebrain/config";

export const runtimeEnv = loadClientEnv({
  WEB_PUBLIC_API_BASE_URL:
    import.meta.env.WEB_PUBLIC_API_BASE_URL ?? "",
  WEB_PUBLIC_COLLAB_WS_URL:
    import.meta.env.WEB_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:3002",
});
