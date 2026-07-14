// 注册文档活动时间线的只读分页接口。
import {
  createDocumentVersionRestoreOperationSchema,
  documentActivityListQuerySchema,
  uuidSchema,
} from "@sharebrain/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { parseJson } from "../../app/validation";
import { DocumentActivitiesService } from "./document-activities.service";

export function createDocumentActivitiesRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/documents/:documentId/activities", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const query = parseJson(documentActivityListQuerySchema, context.req.query());
    const service = new DocumentActivitiesService(context.var.db, context.var.env);
    return context.json(await service.list(context.var.auth, documentId, query));
  });

  app.get("/api/documents/:documentId/activities/:activityId", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const activityId = parseJson(uuidSchema, context.req.param("activityId"));
    const service = new DocumentActivitiesService(context.var.db, context.var.env);
    const detail = await service.detail(context.var.auth, documentId, activityId);
    if (detail.status === "sealed" && detail.afterContentHash) {
      const etag = `"${detail.afterContentHash}"`;
      context.header("etag", etag);
      context.header("cache-control", "private, max-age=31536000, immutable");
      if (context.req.header("if-none-match") === etag) return context.body(null, 304);
    } else {
      context.header("cache-control", "private, no-store");
    }
    return context.json(detail);
  });

  app.post(
    "/api/documents/:documentId/activities/:activityId/restore-operations",
    async (context) => {
      const documentId = parseJson(uuidSchema, context.req.param("documentId"));
      const activityId = parseJson(uuidSchema, context.req.param("activityId"));
      const body = parseJson(
        createDocumentVersionRestoreOperationSchema,
        await context.req.json(),
      );
      const service = new DocumentActivitiesService(context.var.db, context.var.env);
      return context.json(
        await service.createRestoreOperation(
          context.var.auth,
          documentId,
          activityId,
          body,
        ),
        202,
      );
    },
  );

  return app;
}
