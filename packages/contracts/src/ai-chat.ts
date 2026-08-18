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
  z.object({ type: z.literal("data-run"), data: aiAssistantRunSchema.pick({ id: true, status: true }) }),
  z.object({ type: z.literal("data-scope"), data: knowledgeScopeSchema }),
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
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiConversation = z.infer<typeof aiConversationSchema>;
export type AiMessage = z.infer<typeof aiMessageSchema>;
export type AiAssistantRun = z.infer<typeof aiAssistantRunSchema>;
export type AiChatStreamEvent = z.infer<typeof aiChatStreamEventSchema>;
export type AiFeedback = z.infer<typeof aiFeedbackSchema>;
