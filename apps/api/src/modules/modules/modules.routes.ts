import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { ModuleRecordsService } from "./module-records.service";
import { ModuleTemplatesService } from "./module-templates.service";
import { ProjectModulesService } from "./project-modules.service";

export function createModulesRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/module-templates", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json({ items: await service.list(context.var.auth) });
  });

  app.post("/api/module-templates", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.create(context.var.auth, await context.req.json()), 201);
  });

  app.patch("/api/module-templates/:templateId", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.update(context.var.auth, context.req.param("templateId"), await context.req.json()));
  });

  app.post("/api/module-templates/reorder", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.reorder(context.var.auth, await context.req.json()));
  });

  app.post("/api/module-templates/:templateId/fields/reorder", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(
      await service.reorderFields(
        context.var.auth,
        context.req.param("templateId"),
        await context.req.json(),
      ),
    );
  });

  app.post("/api/module-templates/:templateId/reset", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.resetSystem(context.var.auth, context.req.param("templateId")));
  });

  app.post("/api/module-templates/:templateId/fields", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.upsertField(context.var.auth, context.req.param("templateId"), await context.req.json()), 201);
  });

  app.delete("/api/module-templates/:templateId/fields/:fieldId", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.removeField(context.var.auth, context.req.param("templateId"), context.req.param("fieldId")));
  });

  app.delete("/api/module-templates/:templateId", async (context) => {
    const service = new ModuleTemplatesService(context.var.db);
    return context.json(await service.remove(context.var.auth, context.req.param("templateId")));
  });

  app.get("/api/projects/:projectId/modules", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json({ items: await service.list(context.var.auth, context.req.param("projectId")) });
  });

  app.post("/api/projects/:projectId/modules", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json(await service.create(context.var.auth, context.req.param("projectId"), await context.req.json()), 201);
  });

  app.patch("/api/projects/:projectId/modules/:moduleId", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json(await service.update(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()));
  });

  app.delete("/api/projects/:projectId/modules/:moduleId", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json(await service.remove(context.var.auth, context.req.param("projectId"), context.req.param("moduleId")));
  });

  app.post("/api/projects/:projectId/modules/:moduleId/fields", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json(await service.upsertField(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()), 201);
  });

  app.delete("/api/projects/:projectId/modules/:moduleId/fields/:fieldId", async (context) => {
    const service = new ProjectModulesService(context.var.db);
    return context.json(await service.removeField(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), context.req.param("fieldId")));
  });

  app.get("/api/projects/:projectId/modules/:moduleId/records", async (context) => {
    const service = new ModuleRecordsService(context.var.db);
    return context.json({ items: await service.list(context.var.auth, context.req.param("projectId"), context.req.param("moduleId")) });
  });

  app.post("/api/projects/:projectId/modules/:moduleId/records", async (context) => {
    const service = new ModuleRecordsService(context.var.db);
    return context.json(
      await service.create(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()),
      201,
    );
  });

  app.patch("/api/module-records/:recordId", async (context) => {
    const service = new ModuleRecordsService(context.var.db);
    return context.json(await service.update(context.var.auth, context.req.param("recordId"), await context.req.json()));
  });

  app.delete("/api/module-records/:recordId", async (context) => {
    const service = new ModuleRecordsService(context.var.db);
    return context.json(await service.remove(context.var.auth, context.req.param("recordId")));
  });

  return app;
}
