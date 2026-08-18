// 暴露知识治理与图谱查询 API，并在路由边界完成统一契约校验。
import { OpenAPIHono } from "@hono/zod-openapi";
import { zValidator } from "@hono/zod-validator";
import {
  knowledgeConceptMergeSchema,
  knowledgeConceptUpdateSchema,
  knowledgeEdgeUpdateSchema,
  knowledgeProposalBatchSchema,
  knowledgeReindexSchema,
  knowledgeSourceTypeSchema,
  knowledgeSourceScoreUpdateSchema,
} from "@sharebrain/contracts";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { parseJson } from "../../app/validation";
import { KnowledgeService } from "./knowledge.service";

const conceptQuerySchema = z.object({
  status: z.enum(["proposed", "active", "rejected", "merged"]).optional(),
  sort: z.enum(["project_spread", "mention_count"]).default("project_spread"),
  q: z.string().trim().min(1).max(64).optional(),
});
const proposalQuerySchema = z.object({
  kind: z.enum(["concept", "relation", "merge"]).default("concept"),
});
const graphQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  depth: z.coerce.number().int().min(1).max(2).default(1).transform((value) => value as 1 | 2),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const sourceQuerySchema = z.object({
  type: z.enum(["document", "project", "concept"]).default("document"),
  q: z.string().trim().min(1).max(80).optional(),
});

export function createKnowledgeRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/api/knowledge/concepts", async (context) => {
    const query = parseJson(conceptQuerySchema, context.req.query());
    const service = new KnowledgeService(context.var.db);
    return context.json({
      items: await service.listConcepts(context.var.auth, {
        sort: query.sort,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { query: query.q } : {}),
      }),
    });
  });

  app.get("/api/knowledge/concepts/:conceptId", async (context) => {
    const conceptId = parseJson(z.string().uuid(), context.req.param("conceptId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(await service.conceptDetail(context.var.auth, conceptId));
  });

  app.patch("/api/knowledge/concepts/:conceptId", zValidator("json", knowledgeConceptUpdateSchema), async (context) => {
    const conceptId = parseJson(z.string().uuid(), context.req.param("conceptId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(
      await service.updateConcept(context.var.auth, conceptId, context.req.valid("json")),
    );
  });

  app.post("/api/knowledge/concepts/:conceptId/merge", zValidator("json", knowledgeConceptMergeSchema), async (context) => {
    const conceptId = parseJson(z.string().uuid(), context.req.param("conceptId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(
      await service.mergeConcept(
        context.var.auth,
        conceptId,
        context.req.valid("json").targetConceptId,
      ),
    );
  });

  app.get("/api/knowledge/proposals", async (context) => {
    const query = parseJson(proposalQuerySchema, context.req.query());
    const service = new KnowledgeService(context.var.db);
    return context.json({ items: await service.listProposals(context.var.auth, query.kind) });
  });

  app.post("/api/knowledge/proposals/batch", zValidator("json", knowledgeProposalBatchSchema), async (context) => {
    const service = new KnowledgeService(context.var.db);
    return context.json(
      await service.decideProposalBatch(context.var.auth, context.req.valid("json")),
    );
  });

  app.patch("/api/knowledge/edges/:edgeId", zValidator("json", knowledgeEdgeUpdateSchema), async (context) => {
    const edgeId = parseJson(z.string().uuid(), context.req.param("edgeId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(
      await service.updateEdge(context.var.auth, edgeId, context.req.valid("json").status),
    );
  });

  app.get("/api/knowledge/graph", async (context) => {
    const query = parseJson(graphQuerySchema, context.req.query());
    const service = new KnowledgeService(context.var.db);
    return context.json(await service.graph(context.var.auth, {
      depth: query.depth,
      limit: query.limit,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.conceptId ? { conceptId: query.conceptId } : {}),
    }));
  });

  app.get("/api/knowledge/sources/:sourceType/:sourceId/score", async (context) => {
    const sourceType = parseJson(knowledgeSourceTypeSchema, context.req.param("sourceType"));
    const sourceId = parseJson(z.string().uuid(), context.req.param("sourceId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(await service.sourceScore(context.var.auth, sourceType, sourceId));
  });

  app.patch("/api/knowledge/sources/:sourceType/:sourceId/score", zValidator("json", knowledgeSourceScoreUpdateSchema), async (context) => {
    const sourceType = parseJson(knowledgeSourceTypeSchema, context.req.param("sourceType"));
    const sourceId = parseJson(z.string().uuid(), context.req.param("sourceId"));
    const service = new KnowledgeService(context.var.db);
    return context.json(await service.updateSourceScore(
      context.var.auth,
      sourceType,
      sourceId,
      context.req.valid("json").manualWeight,
    ));
  });

  app.get("/api/knowledge/sources", async (context) => {
    const query = parseJson(sourceQuerySchema, context.req.query());
    const service = new KnowledgeService(context.var.db);
    return context.json({
      items: await service.listSources(context.var.auth, query.type, query.q),
    });
  });

  app.get("/api/knowledge/analytics", async (context) => {
    const service = new KnowledgeService(context.var.db);
    return context.json(await service.analytics(context.var.auth));
  });

  app.post("/api/knowledge/reindex", zValidator("json", knowledgeReindexSchema), async (context) => {
    const service = new KnowledgeService(context.var.db);
    const input = context.req.valid("json");
    return context.json(await service.reindex(context.var.auth, {
      targetType: input.targetType,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    }), 202);
  });

  return app;
}
