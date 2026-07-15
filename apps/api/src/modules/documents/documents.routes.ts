import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { DocumentsService } from "./documents.service";

export function createDocumentsRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/projects/:projectId/documents", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json({
      items: await service.listByProject(
        context.var.auth,
        context.req.param("projectId"),
        context.req.query("moduleId"),
        context.req.query("moduleRecordId"),
      ),
    });
  });

  app.post("/api/projects/:projectId/documents", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(await service.create(context.var.auth, context.req.param("projectId"), await context.req.json()), 201);
  });

  app.get("/api/documents/:documentId/discussions", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(await service.getDiscussions(context.var.auth, context.req.param("documentId")));
  });

  app.post("/api/documents/:documentId/discussions/read", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(
      await service.markDiscussionsRead(context.var.auth, context.req.param("documentId"), await context.req.json()),
    );
  });

  app.get("/api/documents/:documentId", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    const documentId = context.req.param("documentId");

    if (context.req.query("includeContent") === "false") {
      return context.json(await service.getMetadata(context.var.auth, documentId));
    }

    return context.json(await service.get(context.var.auth, documentId));
  });

  app.patch("/api/documents/:documentId", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(await service.update(context.var.auth, context.req.param("documentId"), await context.req.json()));
  });

  app.delete("/api/documents/:documentId", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(await service.softDelete(context.var.auth, context.req.param("documentId")));
  });

  app.post("/api/documents/:documentId/restore", async (context) => {
    const service = new DocumentsService(context.var.db, context.var.env);
    return context.json(await service.restore(context.var.auth, context.req.param("documentId")));
  });

  return app;
}
