import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const projectRoleSchema = z.enum(["viewer", "editor", "admin", "auditor"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const documentTypeSchema = z.enum([
  "project_note",
  "change_record",
  "incident_review",
  "delivery_record",
  "meeting_note",
  "inspection_record",
  "handover_doc",
  "general_doc",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const timelineEventTypeSchema = z.enum([
  "project_created",
  "requirement_changed",
  "deployment",
  "incident",
  "fix",
  "handover",
  "meeting",
  "inspection",
  "note",
]);
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

export const searchEntityTypeSchema = z.enum([
  "project",
  "document",
  "document_block",
  "timeline_event",
  "comment",
]);
export type SearchEntityType = z.infer<typeof searchEntityTypeSchema>;

export const apiHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("api"),
  version: z.string(),
});
export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>;

export const collabHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("collab"),
  version: z.string(),
});
export type CollabHealthResponse = z.infer<typeof collabHealthResponseSchema>;

export const workerHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("worker"),
  version: z.string(),
});
export type WorkerHealthResponse = z.infer<typeof workerHealthResponseSchema>;

export const contextPackSchema = z.object({
  project: z.object({
    id: uuidSchema,
    name: z.string(),
  }),
  topic: z.string(),
  timeline: z.array(z.unknown()),
  documents: z.array(z.unknown()),
  evidence: z.array(z.unknown()),
  compressedSummary: z.string(),
});
export type ContextPack = z.infer<typeof contextPackSchema>;
