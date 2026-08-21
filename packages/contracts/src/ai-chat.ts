import { z } from "zod";

import { aiCitationSchema, knowledgeScopeSchema } from "./knowledge";

export const aiMessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({
    type: z.literal("attachment"),
    mediaObjectId: z.string().uuid(),
    fileName: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("status"),
    label: z.string(),
    state: z.enum(["pending", "running", "complete", "failed"]),
  }),
]);

/**
 * 模型能读的附件类型。超出这个集合的文件会在 provider 转换阶段抛
 * UnsupportedFunctionalityError 把整条回答带崩，所以必须在入口就拦住。
 * 前端用它约束文件选择器，后端用它校验提交，只有这一份事实。
 */
export const AI_CHAT_ATTACHMENT_MEDIA_TYPES = ["image/", "text/", "application/pdf"] as const;

export function isSupportedChatAttachment(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return AI_CHAT_ATTACHMENT_MEDIA_TYPES.some((prefix) => normalized.startsWith(prefix));
}

export function isImageAttachment(mimeType: string): boolean {
  return mimeType.trim().toLowerCase().startsWith("image/");
}

// 工作过程是可回放的事实，不是临时的 UI 提示：流里推一份，历史里也要能读回同一份。
export const AI_RUN_STEP_KINDS = ["scope", "recall", "graph", "context", "generation"] as const;

export const aiRunStepSchema = z.object({
  kind: z.enum(AI_RUN_STEP_KINDS),
  status: z.enum(["running", "complete", "failed"]),
  // detail 只放可本地化渲染的量化字段，不放已拼好的展示文案。
  detail: z.object({
    projectName: z.string().nullable().optional(),
    resolution: knowledgeScopeSchema.shape.resolution.optional(),
    ftsCount: z.number().int().min(0).optional(),
    vectorCount: z.number().int().min(0).optional(),
    conceptCount: z.number().int().min(0).optional(),
    graphCount: z.number().int().min(0).optional(),
    citationCount: z.number().int().min(0).optional(),
    projectCount: z.number().int().min(0).optional(),
    tokenCount: z.number().int().min(0).optional(),
  }).default({}),
  durationMs: z.number().int().min(0).nullable().default(null),
});

export const aiChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(100_000),
  activeProjectId: z.string().uuid().nullable().optional(),
  explicitProjectId: z.string().uuid().nullable().optional(),
  includeCrossProject: z.boolean().default(true),
  attachments: z.array(z.string().uuid()).max(8).default([]),
});

export const aiConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const aiMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  sequence: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  activeProjectId: z.string().uuid().nullable(),
  scopeResolution: z.enum(["route", "explicit", "recent", "inferred", "none"]),
  status: z.enum(["streaming", "complete", "failed"]),
  runId: z.string().uuid().nullable(),
  parts: z.array(aiMessagePartSchema),
  steps: z.array(aiRunStepSchema),
  citations: z.array(aiCitationSchema),
  usage: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const aiAssistantRunSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
  status: z.enum(["queued", "running", "complete", "failed"]),
  attempts: z.number().int().min(0),
  errorCode: z.string().nullable(),
  nextAttemptAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const aiChatStreamEventSchema = z.discriminatedUnion("type", [
  // 带上 conversationId：新会话的 id 必须由服务端明确告知，不能让前端靠时间戳猜。
  z.object({
    type: z.literal("data-run"),
    data: aiAssistantRunSchema.pick({ id: true, conversationId: true, status: true }),
  }),
  z.object({ type: z.literal("data-scope"), data: knowledgeScopeSchema }),
  z.object({ type: z.literal("data-step"), data: aiRunStepSchema }),
  z.object({ type: z.literal("data-citations"), data: z.array(aiCitationSchema) }),
  z.object({ type: z.literal("text-start"), id: z.string() }),
  z.object({ type: z.literal("text-delta"), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal("text-end"), id: z.string() }),
  z.object({
    type: z.literal("data-finish"),
    data: z.object({ usage: z.record(z.string(), z.unknown()) }),
  }),
  z.object({
    type: z.literal("data-error"),
    data: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export const aiFeedbackSchema = z.object({
  vote: z.enum(["up", "down"]),
  reason: z.enum(["irrelevant", "outdated", "wrong_project", "incomplete"]).nullable().optional(),
});

export type AiMessagePart = z.infer<typeof aiMessagePartSchema>;
export type AiRunStep = z.infer<typeof aiRunStepSchema>;
export type AiRunStepKind = (typeof AI_RUN_STEP_KINDS)[number];
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiConversation = z.infer<typeof aiConversationSchema>;
export type AiMessage = z.infer<typeof aiMessageSchema>;
export type AiAssistantRun = z.infer<typeof aiAssistantRunSchema>;
export type AiChatStreamEvent = z.infer<typeof aiChatStreamEventSchema>;
export type AiFeedback = z.infer<typeof aiFeedbackSchema>;
