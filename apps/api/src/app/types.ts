import type { ServerEnv } from "@sharebrain/config";
import type { AuthContext } from "@sharebrain/contracts";
import type { DatabaseClient } from "@sharebrain/db";

export type AppVariables = {
  auth: AuthContext;
  authProvider: "password" | "feishu" | "admin_managed" | "dev" | null;
  db: DatabaseClient;
  env: ServerEnv;
};

export type AppEnv = {
  Variables: AppVariables;
};
