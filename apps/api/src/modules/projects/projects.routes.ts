import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { ProjectsService } from "./projects.service";

export function createProjectsRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/me/recents", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json({ items: await service.listRecents(context.var.auth) });
  });

  app.get("/api/projects", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json({ items: await service.list(context.var.auth) });
  });

  app.post("/api/projects", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json(await service.create(context.var.auth, await context.req.json()), 201);
  });

  app.get("/api/projects/:projectId", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json(await service.get(context.var.auth, context.req.param("projectId")));
  });

  app.patch("/api/projects/:projectId", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json(await service.update(context.var.auth, context.req.param("projectId"), await context.req.json()));
  });

  app.delete("/api/projects/:projectId", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json(await service.softDelete(context.var.auth, context.req.param("projectId")));
  });

  app.post("/api/projects/:projectId/restore", async (context) => {
    const service = new ProjectsService(context.var.db);
    return context.json(await service.restore(context.var.auth, context.req.param("projectId")));
  });

  return app;
}
