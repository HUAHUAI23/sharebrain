import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { MeService } from "./me.service";

export function createMeRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/me", async (context) => {
    const service = new MeService(context.var.db);
    return context.json({
      ...(await service.getCurrent(context.var.auth)),
      authProvider: context.var.authProvider,
    });
  });

  app.get("/api/members", async (context) => {
    const service = new MeService(context.var.db);
    return context.json({ items: await service.listMembers(context.var.auth) });
  });

  return app;
}
