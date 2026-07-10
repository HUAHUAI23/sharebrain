import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { ModulesService } from "./modules.service";

export function createModulesRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/module-templates", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json({ items: await service.listTemplates(context.var.auth) });
  });

  app.post("/api/module-templates", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.createTemplate(context.var.auth, await context.req.json()), 201);
  });

  app.patch("/api/module-templates/:templateId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.updateTemplate(context.var.auth, context.req.param("templateId"), await context.req.json()));
  });

  app.post("/api/module-templates/:templateId/fields", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.upsertTemplateField(context.var.auth, context.req.param("templateId"), await context.req.json()), 201);
  });

  app.delete("/api/module-templates/:templateId/fields/:fieldId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.softDeleteTemplateField(context.var.auth, context.req.param("templateId"), context.req.param("fieldId")));
  });

  app.delete("/api/module-templates/:templateId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.softDeleteTemplate(context.var.auth, context.req.param("templateId")));
  });

  app.get("/api/projects/:projectId/modules", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json({ items: await service.listProjectModules(context.var.auth, context.req.param("projectId")) });
  });

  app.post("/api/projects/:projectId/modules", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.createModule(context.var.auth, context.req.param("projectId"), await context.req.json()), 201);
  });

  app.patch("/api/projects/:projectId/modules/:moduleId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.updateModule(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()));
  });

  app.delete("/api/projects/:projectId/modules/:moduleId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.softDeleteModule(context.var.auth, context.req.param("projectId"), context.req.param("moduleId")));
  });

  app.post("/api/projects/:projectId/modules/:moduleId/fields", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.upsertField(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()), 201);
  });

  app.delete("/api/projects/:projectId/modules/:moduleId/fields/:fieldId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.softDeleteField(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), context.req.param("fieldId")));
  });

  app.get("/api/projects/:projectId/modules/:moduleId/records", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json({ items: await service.listRecords(context.var.auth, context.req.param("projectId"), context.req.param("moduleId")) });
  });

  app.post("/api/projects/:projectId/modules/:moduleId/records", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(
      await service.createRecord(context.var.auth, context.req.param("projectId"), context.req.param("moduleId"), await context.req.json()),
      201,
    );
  });

  app.patch("/api/module-records/:recordId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.updateRecord(context.var.auth, context.req.param("recordId"), await context.req.json()));
  });

  app.delete("/api/module-records/:recordId", async (context) => {
    const service = new ModulesService(context.var.db);
    return context.json(await service.softDeleteRecord(context.var.auth, context.req.param("recordId")));
  });

  return app;
}
