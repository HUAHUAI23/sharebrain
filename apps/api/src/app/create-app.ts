import { apiHealthResponseSchema } from "@sharebrain/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";

import { isApiError } from "./api-error";
import {
  authMiddleware,
  createAppDependencies,
  createDependenciesMiddleware,
  type AppDependencies,
} from "./middleware";
import type { AppEnv } from "./types";
import { createAuthRoutes } from "../modules/auth/auth.routes";
import { createDocumentsRoutes } from "../modules/documents/documents.routes";
import { createMeRoutes } from "../modules/me/me.routes";
import { createMediaRoutes } from "../modules/media/media.routes";
import { createModulesRoutes } from "../modules/modules/modules.routes";
import { createProjectsRoutes } from "../modules/projects/projects.routes";
import { createSearchRoutes } from "../modules/search/search.routes";

type CreateAppOptions = {
  dependencies?: AppDependencies;
};

export function createApp(options: CreateAppOptions = {}) {
  const dependencies = options.dependencies ?? createAppDependencies();
  const app = new OpenAPIHono<AppEnv>();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin,
      credentials: true,
    }),
  );
  app.use("*", createDependenciesMiddleware(dependencies));

  app.get("/health", (context) => {
    const response = apiHealthResponseSchema.parse({
      ok: true,
      service: "api",
      version: "0.1.0",
    });

    return context.json(response);
  });

  app.get("/api/health", (context) => {
    const response = apiHealthResponseSchema.parse({
      ok: true,
      service: "api",
      version: "0.1.0",
    });

    return context.json(response);
  });

  app.route("/", createAuthRoutes());

  app.use("/api/*", authMiddleware);
  app.route("/", createMeRoutes());
  app.route("/", createProjectsRoutes());
  app.route("/", createModulesRoutes());
  app.route("/", createDocumentsRoutes());
  app.route("/", createSearchRoutes());
  app.route("/", createMediaRoutes());

  app.onError((error, context) => {
    if (isApiError(error)) {
      return context.json(
        {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        error.status,
      );
    }

    if (error instanceof z.ZodError) {
      return context.json(
        {
          code: "VALIDATION_FAILED",
          message: "请求参数不合法。",
          details: error.flatten(),
        },
        422,
      );
    }

    console.error(error);
    return context.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "服务内部错误。",
      },
      500,
    );
  });

  app.notFound((context) =>
    context.json(
      {
        code: "NOT_FOUND",
        message: "接口不存在或尚未实现。",
      },
      404,
    ),
  );

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
