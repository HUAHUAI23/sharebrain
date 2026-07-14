// 定义文档活动时间线的稳定契约，以及与业务无关的块级摘要差异和会话合并规则。
import { z } from "zod";

import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  documentRestoreSourceKindSchema,
  projectDocumentVersionValue,
} from "./document-version";
import { isoDateTimeSchema, uuidSchema } from "./platform";

export const DOCUMENT_ACTIVITY_LIMITS = {
  changesPerEvent: 50,
  excerptCharacters: 160,
  listPageSize: 50,
  sourceKeyCharacters: 240,
} as const;

export const documentActivityTypeSchema = z.enum([
  "document_created",
  "content_edited",
  "title_edited",
  "comment_added",
  "comment_replied",
  "comment_edited",
  "comment_deleted",
  "comment_resolved",
  "version_restored",
]);
export type DocumentActivityType = z.infer<typeof documentActivityTypeSchema>;

export const documentActivityStatusSchema = z.enum(["open", "sealed"]);
export type DocumentActivityStatus = z.infer<typeof documentActivityStatusSchema>;

export const documentActivityBlockSnapshotSchema = z.object({
  fingerprint: z.string().min(1).max(80),
  text: z.string().max(DOCUMENT_ACTIVITY_LIMITS.excerptCharacters),
  type: z.string().min(1).max(80),
});
export type DocumentActivityBlockSnapshot = z.infer<
  typeof documentActivityBlockSnapshotSchema
>;

export const documentActivityBlockChangeSchema = z.object({
  blockId: z.string().min(1).max(120),
  kind: z.enum(["inserted", "updated", "deleted"]),
  before: documentActivityBlockSnapshotSchema.nullable(),
  after: documentActivityBlockSnapshotSchema.nullable(),
});
export type DocumentActivityBlockChange = z.infer<typeof documentActivityBlockChangeSchema>;

export const documentContentActivityDetailsSchema = z.object({
  kind: z.literal("content"),
  changes: z
    .array(documentActivityBlockChangeSchema)
    .max(DOCUMENT_ACTIVITY_LIMITS.changesPerEvent),
  totalChangedBlocks: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type DocumentContentActivityDetails = z.infer<
  typeof documentContentActivityDetailsSchema
>;

export const documentActivityDetailsSchema = z.discriminatedUnion("kind", [
  documentContentActivityDetailsSchema,
  z.object({
    kind: z.literal("document_created"),
    title: z.string().max(200),
  }),
  z.object({
    kind: z.literal("title"),
    beforeTitle: z.string().max(200),
    afterTitle: z.string().max(200),
  }),
  z.object({
    kind: z.literal("comment"),
    discussionId: z.string().min(1).max(120),
    commentId: z.string().min(1).max(120).nullable(),
    excerpt: z.string().max(DOCUMENT_ACTIVITY_LIMITS.excerptCharacters),
  }),
  z.object({
    kind: z.literal("restore"),
    operationId: uuidSchema,
    sourceKind: documentRestoreSourceKindSchema,
    sourceVersionNo: z.number().int().positive().nullable(),
    sourceActivityEventId: uuidSchema.nullable(),
    resultVersionNo: z.number().int().positive(),
  }),
]);
export type DocumentActivityDetails = z.infer<typeof documentActivityDetailsSchema>;

export const documentActivityActorSchema = z.object({
  id: uuidSchema,
  displayName: z.string().min(1),
  avatarUrl: z.string().max(2048).nullable(),
});
export type DocumentActivityActor = z.infer<typeof documentActivityActorSchema>;

export const documentActivityItemSchema = z.object({
  id: uuidSchema,
  sequence: z.number().int().positive(),
  type: documentActivityTypeSchema,
  status: documentActivityStatusSchema,
  actor: documentActivityActorSchema,
  startedAt: isoDateTimeSchema,
  occurredAt: isoDateTimeSchema,
  details: documentActivityDetailsSchema,
  inspectable: z.boolean(),
  restorable: z.boolean(),
});
export type DocumentActivityItem = z.infer<typeof documentActivityItemSchema>;

export const documentActivityListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(DOCUMENT_ACTIVITY_LIMITS.listPageSize).default(30),
});
export type DocumentActivityListQuery = z.infer<typeof documentActivityListQuerySchema>;

export const documentActivityListResponseSchema = z.object({
  items: z.array(documentActivityItemSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentActivityListResponse = z.infer<typeof documentActivityListResponseSchema>;

export const documentActivityDetailSchema = documentActivityItemSchema.extend({
  beforeValue: z.array(z.unknown()).nullable(),
  afterValue: z.array(z.unknown()).nullable(),
  beforeContentHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  afterContentHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  formatVersion: z.literal(DOCUMENT_VERSION_FORMAT_VERSION).nullable(),
  unavailableMediaCount: z.number().int().nonnegative(),
});
export type DocumentActivityDetail = z.infer<typeof documentActivityDetailSchema>;

type IndexedBlock = {
  id: string | null;
  index: number;
  snapshot: DocumentActivityBlockSnapshot;
};

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function extractText(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map(extractText).filter(Boolean).join(" ");
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  return [typeof record.text === "string" ? record.text : "", extractText(record.children)]
    .filter(Boolean)
    .join(" ");
}

function stripStableNodeIds(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stripStableNodeIds);
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key]) => key !== "id")
      .map(([key, value]) => [key, stripStableNodeIds(value)]),
  );
}

export function toDocumentActivityExcerpt(input: unknown) {
  return extractText(input)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DOCUMENT_ACTIVITY_LIMITS.excerptCharacters);
}

function indexBlocks(value: unknown): IndexedBlock[] {
  return projectDocumentVersionValue(value).map((node, index) => {
    const record = node && typeof node === "object" && !Array.isArray(node) ? node : {};
    const canonical = JSON.stringify(stripStableNodeIds(node));
    return {
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : null,
      index,
      snapshot: {
        fingerprint: `v1:${canonical.length}:${fnv1a(canonical)}`,
        text: toDocumentActivityExcerpt(node),
        type: typeof record.type === "string" && record.type.length > 0 ? record.type : "block",
      },
    };
  });
}

function changeKind(
  before: DocumentActivityBlockSnapshot | null,
  after: DocumentActivityBlockSnapshot | null,
): DocumentActivityBlockChange["kind"] {
  if (!before) return "inserted";
  if (!after) return "deleted";
  return "updated";
}

export function diffDocumentActivityBlocks(
  beforeValue: unknown,
  afterValue: unknown,
): DocumentContentActivityDetails {
  const beforeBlocks = indexBlocks(beforeValue);
  const afterBlocks = indexBlocks(afterValue);
  const beforeById = new Map(
    beforeBlocks.flatMap((block) => (block.id ? ([[block.id, block]] as const) : [])),
  );
  const matchedBefore = new Set<number>();
  const changes: DocumentActivityBlockChange[] = [];

  for (const after of afterBlocks) {
    let before = after.id ? beforeById.get(after.id) : undefined;
    if (!before) {
      const positional = beforeBlocks[after.index];
      if (positional && !matchedBefore.has(positional.index) && (!positional.id || !after.id)) {
        before = positional;
      }
    }

    if (before) matchedBefore.add(before.index);
    if (before?.snapshot.fingerprint === after.snapshot.fingerprint) continue;

    changes.push({
      blockId: after.id ?? before?.id ?? `legacy:${after.index}`,
      kind: changeKind(before?.snapshot ?? null, after.snapshot),
      before: before?.snapshot ?? null,
      after: after.snapshot,
    });
  }

  for (const before of beforeBlocks) {
    if (matchedBefore.has(before.index)) continue;
    changes.push({
      blockId: before.id ?? `legacy:${before.index}`,
      kind: "deleted",
      before: before.snapshot,
      after: null,
    });
  }

  return documentContentActivityDetailsSchema.parse({
    kind: "content",
    changes: changes.slice(0, DOCUMENT_ACTIVITY_LIMITS.changesPerEvent),
    totalChangedBlocks: changes.length,
    truncated: changes.length > DOCUMENT_ACTIVITY_LIMITS.changesPerEvent,
  });
}

export function mergeDocumentContentActivityDetails(
  current: DocumentContentActivityDetails,
  incoming: DocumentContentActivityDetails,
): DocumentContentActivityDetails {
  const merged = new Map(current.changes.map((change) => [change.blockId, structuredClone(change)]));

  for (const change of incoming.changes) {
    const existing = merged.get(change.blockId);
    const before = existing?.before ?? change.before;
    const after = change.after;
    if (before?.fingerprint === after?.fingerprint || (!before && !after)) {
      merged.delete(change.blockId);
      continue;
    }
    merged.set(change.blockId, {
      blockId: change.blockId,
      kind: changeKind(before, after),
      before,
      after,
    });
  }

  const changes = Array.from(merged.values());
  const totalChangedBlocks = Math.max(
    changes.length,
    current.truncated ? current.totalChangedBlocks : 0,
    incoming.truncated ? incoming.totalChangedBlocks : 0,
  );
  return documentContentActivityDetailsSchema.parse({
    kind: "content",
    changes: changes.slice(0, DOCUMENT_ACTIVITY_LIMITS.changesPerEvent),
    totalChangedBlocks,
    truncated:
      current.truncated ||
      incoming.truncated ||
      changes.length > DOCUMENT_ACTIVITY_LIMITS.changesPerEvent,
  });
}
