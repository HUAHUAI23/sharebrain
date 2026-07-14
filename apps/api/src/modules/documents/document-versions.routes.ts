// 注册正文版本历史的只读列表和详情 HTTP 接口。
import {
  createDocumentVersionRestoreOperationSchema,
  documentVersionListQuerySchema,
  uuidSchema,
} from "@sharebrain/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../app/types";
import { parseJson } from "../../app/validation";
import { DocumentVersionsService } from "./document-versions.service";

export function createDocumentVersionsRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/documents/:documentId/versions", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const query = parseJson(documentVersionListQuerySchema, context.req.query());
    const service = new DocumentVersionsService(context.var.db, context.var.env);
    return context.json(await service.list(context.var.auth, documentId, query));
  });

  app.get("/api/documents/:documentId/versions/:versionId", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const versionId = parseJson(uuidSchema, context.req.param("versionId"));
    const service = new DocumentVersionsService(context.var.db, context.var.env);
    const detail = await service.detail(context.var.auth, documentId, versionId);
    const etag = `"${detail.contentHash}"`;
    context.header("etag", etag);
    context.header("cache-control", "private, max-age=31536000, immutable");
    if (context.req.header("if-none-match") === etag) return context.body(null, 304);
    return context.json(detail);
  });

  app.post("/api/documents/:documentId/versions/:versionId/restore-operations", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const versionId = parseJson(uuidSchema, context.req.param("versionId"));
    const body = parseJson(createDocumentVersionRestoreOperationSchema, await context.req.json());
    const service = new DocumentVersionsService(context.var.db, context.var.env);
    return context.json(
      await service.createRestoreOperation(context.var.auth, documentId, versionId, body),
      202,
    );
  });

  app.get("/api/documents/:documentId/version-operations/:operationId", async (context) => {
    const documentId = parseJson(uuidSchema, context.req.param("documentId"));
    const operationId = parseJson(uuidSchema, context.req.param("operationId"));
    const service = new DocumentVersionsService(context.var.db, context.var.env);
    return context.json(await service.getOperation(context.var.auth, documentId, operationId));
  });

  return app;
}
