import { loadServerEnv } from "@sharebrain/config";
import { authContextSchema } from "@sharebrain/contracts";
import { createDatabaseClient } from "@sharebrain/db";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";

import type { AppEnv } from "./types";
import { AuthService } from "../modules/auth/auth.service";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";

export type AppDependencies = {
  env: ServerEnv;
  db: DatabaseClient;
};

export function createAppDependencies(env = loadServerEnv()): AppDependencies {
  return {
    env,
    db: createDatabaseClient(env.DATABASE_URL),
  };
}

export function createDependenciesMiddleware(dependencies: AppDependencies) {
  return createMiddleware<AppEnv>(async (context, next) => {
    context.set("env", dependencies.env);
    context.set("db", dependencies.db);
    await next();
  });
}

export const authMiddleware = createMiddleware<AppEnv>(async (context, next) => {
  const env = context.var.env;
  const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();

  const service = new AuthService(context.var.db, env);
  const session = await service.resolveSession(getCookie(context, env.AUTH_SESSION_COOKIE_NAME));
  if (session) {
    context.set("auth", { ...session, requestId });
    context.set("authProvider", "password");
    context.header("x-request-id", requestId);
    await next();
    return;
  }

  if (!env.AUTH_DEV_BYPASS_ENABLED) {
    return context.json(
      {
        code: "UNAUTHENTICATED",
        message: "请先登录。",
      },
      401,
    );
  }

  const parsed = authContextSchema.parse({
    userId: context.req.header("x-dev-user-id") ?? env.DEV_AUTH_USER_ID,
    tenantId: context.req.header("x-dev-tenant-id") ?? env.DEV_AUTH_TENANT_ID,
    role: context.req.header("x-dev-role") ?? env.DEV_AUTH_ROLE,
    requestId,
  });

  context.set("auth", parsed);
  context.set("authProvider", "dev");
  context.header("x-request-id", requestId);
  await next();
});
