import { apiHealthResponseSchema } from "@sharebrain/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export function createApp() {
  const app = new OpenAPIHono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin,
      credentials: true,
    }),
  );

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
