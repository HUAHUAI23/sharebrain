import { OpenAPIHono } from "@hono/zod-openapi";
import { zValidator } from "@hono/zod-validator";
import { aiChatRequestSchema, aiFeedbackSchema } from "@sharebrain/contracts";
import { z } from "zod";

import { parseJson } from "../../app/validation";
import type { AppEnv } from "../../app/types";
import { AiChatService } from "./ai-chat.service";
import { AiService } from "./ai.service";

const aiCommandBodySchema = z.object({
  prompt: z.string().min(1).max(100_000),
  toolName: z.enum(["generate", "edit", "comment"]).default("generate"),
});
const aiMessageListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const aiConversationListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function createAiRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.post("/api/ai/command", zValidator("json", aiCommandBodySchema), async (context) => {
    const body = context.req.valid("json");
    const service = new AiService(context.var.db, context.var.env);

    return service.streamCommand(context.var.auth, body);
  });

  app.post("/api/ai/chat", zValidator("json", aiChatRequestSchema), async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    // 客户端断开或点"停止"时一并中止 provider 调用，不再空烧 token。
    return service.streamChat(context.var.auth, context.req.valid("json"), context.req.raw.signal);
  });

  app.post("/api/ai/scope", zValidator("json", aiChatRequestSchema), async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    return context.json(await service.resolveScope(context.var.auth, context.req.valid("json")));
  });

  app.get("/api/ai/conversations", async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const query = parseJson(aiConversationListQuerySchema, context.req.query());
    return context.json(await service.listConversations(context.var.auth, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }));
  });

  app.delete("/api/ai/conversations/:conversationId", async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const conversationId = parseJson(z.string().uuid(), context.req.param("conversationId"));
    return context.json(await service.deleteConversation(context.var.auth, conversationId));
  });

  app.get("/api/ai/conversations/:conversationId/messages", async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const conversationId = parseJson(z.string().uuid(), context.req.param("conversationId"));
    const query = parseJson(aiMessageListQuerySchema, context.req.query());
    return context.json(await service.readMessages(context.var.auth, conversationId, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }));
  });

  app.post("/api/ai/messages/:messageId/feedback", zValidator("json", aiFeedbackSchema), async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const messageId = parseJson(z.string().uuid(), context.req.param("messageId"));
    return context.json(
      await service.writeMessageFeedback(context.var.auth, messageId, context.req.valid("json")),
    );
  });

  app.post("/api/ai/citations/:citationId/feedback", zValidator("json", aiFeedbackSchema), async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const citationId = parseJson(z.string().uuid(), context.req.param("citationId"));
    return context.json(
      await service.writeCitationFeedback(context.var.auth, citationId, context.req.valid("json")),
    );
  });

  app.get("/api/ai/runs/:runId", async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const runId = parseJson(z.string().uuid(), context.req.param("runId"));
    return context.json(await service.getRun(context.var.auth, runId));
  });

  app.post("/api/ai/runs/:runId/retry", async (context) => {
    const service = new AiChatService(context.var.db, context.var.env);
    const runId = parseJson(z.string().uuid(), context.req.param("runId"));
    return service.retryRun(context.var.auth, runId, context.req.raw.signal);
  });

  return app;
}
