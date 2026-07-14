// 定义正文版本历史的稳定数据契约、投影规则和跨运行时确定性序列化。
import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./platform";

export const DOCUMENT_VERSION_FORMAT_VERSION = 1 as const;
export const DOCUMENT_VERSION_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxDepth: 64,
  maxKeys: 250_000,
  maxNodes: 50_000,
  maxStateVectorBytes: 64 * 1024,
} as const;

export type DocumentVersionJson =
  | null
  | boolean
  | number
  | string
  | DocumentVersionJson[]
  | { [key: string]: DocumentVersionJson };
export type DocumentVersionValue = DocumentVersionJson[];

type ProjectionLimits = Partial<
  Pick<typeof DOCUMENT_VERSION_LIMITS, "maxBytes" | "maxDepth" | "maxKeys" | "maxNodes">
>;

const TRANSIENT_KEYS = new Set(["comment", "comment_draft", "diff", "diffOperation"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class DocumentVersionValueError extends Error {
  readonly code = "DOCUMENT_VERSION_VALUE_INVALID";
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTransientKey(key: string) {
  return TRANSIENT_KEYS.has(key) || key.startsWith("comment_") || key.startsWith("suggestion_");
}

function getSuggestionData(value: Record<string, unknown>) {
  if (isRecord(value.suggestion)) return value.suggestion;

  const key = Object.keys(value)
    .filter((candidate) => candidate.startsWith("suggestion_"))
    .sort()
    .at(-1);
  return key && isRecord(value[key]) ? value[key] : undefined;
}

function applySuggestionProjection(value: Record<string, unknown>) {
  const suggestion = getSuggestionData(value);
  if (!suggestion) return value;
  if (suggestion.type === "remove") return null;

  if (suggestion.type === "update" && isRecord(suggestion.newProperties)) {
    return { ...value, ...suggestion.newProperties };
  }

  return value;
}

function normalizePlateRoot(value: DocumentVersionJson[]) {
  const normalized: DocumentVersionJson[] = [];
  let rootLeaves: DocumentVersionJson[] = [];
  const flushLeaves = () => {
    if (rootLeaves.length === 0) return;
    normalized.push({ type: "p", children: rootLeaves });
    rootLeaves = [];
  };
  for (const node of value) {
    if (isRecord(node) && Array.isArray(node.children)) {
      flushLeaves();
      normalized.push(node as { [key: string]: DocumentVersionJson });
    } else if (isRecord(node) && typeof node.text === "string") {
      rootLeaves.push(node as { [key: string]: DocumentVersionJson });
    } else {
      flushLeaves();
      normalized.push(node);
    }
  }
  flushLeaves();
  return normalized;
}

export function projectDocumentVersionValue(value: unknown, limits: ProjectionLimits = {}) {
  const resolved = { ...DOCUMENT_VERSION_LIMITS, ...limits };
  const seen = new WeakSet<object>();
  let keys = 0;
  let nodes = 0;

  const visit = (input: unknown, depth: number): DocumentVersionJson | undefined => {
    if (depth > resolved.maxDepth) {
      throw new DocumentVersionValueError("版本正文嵌套层级超限。");
    }
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new DocumentVersionValueError("版本正文包含非有限数字。");
      return input;
    }
    if (typeof input === "undefined") return undefined;
    if (typeof input !== "object") {
      throw new DocumentVersionValueError("版本正文包含非 JSON 值。");
    }
    if (seen.has(input)) throw new DocumentVersionValueError("版本正文包含循环引用。");
    seen.add(input);
    nodes += 1;
    if (nodes > resolved.maxNodes) throw new DocumentVersionValueError("版本正文节点数量超限。");

    try {
      if (Array.isArray(input)) {
        const projected: DocumentVersionJson[] = [];
        for (const item of input) {
          const child = visit(item, depth + 1);
          if (child !== undefined) projected.push(child);
        }
        return projected;
      }

      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new DocumentVersionValueError("版本正文包含非普通对象。");
      }
      const suggested = applySuggestionProjection(input as Record<string, unknown>);
      if (suggested === null) return undefined;
      const projected: Record<string, DocumentVersionJson> = Object.create(null);
      for (const key of Object.keys(suggested).sort()) {
        keys += 1;
        if (keys > resolved.maxKeys) throw new DocumentVersionValueError("版本正文属性数量超限。");
        if (UNSAFE_KEYS.has(key)) throw new DocumentVersionValueError("版本正文包含不安全属性。");
        if (isTransientKey(key) || key === "suggestion") continue;
        const child = visit(suggested[key], depth + 1);
        if (child !== undefined) projected[key] = child;
      }
      return projected;
    } finally {
      seen.delete(input);
    }
  };

  const projected = visit(value, 0);
  if (!Array.isArray(projected)) throw new DocumentVersionValueError("版本正文根节点必须是数组。");
  const canonical = JSON.stringify(projected);
  if (utf8ByteLength(canonical) > resolved.maxBytes) {
    throw new DocumentVersionValueError("版本正文字节数超限。");
  }
  return normalizePlateRoot(projected as DocumentVersionValue);
}

export const sanitizeRestorableDocumentValue = projectDocumentVersionValue;

export function canonicalizeDocumentVersionValue(value: unknown) {
  return JSON.stringify(projectDocumentVersionValue(value));
}

export async function hashDocumentVersionValue(value: unknown) {
  const canonical = canonicalizeDocumentVersionValue(value);
  const input = new TextEncoder().encode(`v${DOCUMENT_VERSION_FORMAT_VERSION}\n${canonical}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const documentVersionKindSchema = z.enum(["auto", "restore"]);
export type DocumentVersionKind = z.infer<typeof documentVersionKindSchema>;

export const documentVersionActorSchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

export const documentVersionSummarySchema = z.object({
  id: uuidSchema,
  versionNo: z.number().int().positive(),
  kind: documentVersionKindSchema,
  sourceVersionNo: z.number().int().positive().nullable(),
  changeSummary: z.string().nullable(),
  sealedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastEditor: documentVersionActorSchema,
});
export type DocumentVersionSummary = z.infer<typeof documentVersionSummarySchema>;

export const documentVersionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().min(1).max(128).optional(),
});
export type DocumentVersionListQuery = z.infer<typeof documentVersionListQuerySchema>;

export const documentVersionListResponseSchema = z.object({
  items: z.array(documentVersionSummarySchema),
  nextCursor: z.string().nullable(),
});
export type DocumentVersionListResponse = z.infer<typeof documentVersionListResponseSchema>;

export const documentVersionDetailSchema = documentVersionSummarySchema.extend({
  value: z.array(z.unknown()),
  previousValue: z.array(z.unknown()).nullable(),
  previousVersionNo: z.number().int().positive().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  formatVersion: z.literal(DOCUMENT_VERSION_FORMAT_VERSION),
  unavailableMediaCount: z.number().int().nonnegative(),
});
export type DocumentVersionDetail = z.infer<typeof documentVersionDetailSchema>;

export const documentVersionOperationStatusSchema = z.enum([
  "pending",
  "applying",
  "applied",
  "conflict",
  "failed",
  "expired",
]);
export type DocumentVersionOperationStatus = z.infer<typeof documentVersionOperationStatusSchema>;

const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u);
export const createDocumentVersionRestoreOperationSchema = z.object({
  requestId: uuidSchema,
  baseStateVector: base64UrlSchema.max(Math.ceil((DOCUMENT_VERSION_LIMITS.maxStateVectorBytes * 4) / 3)),
  force: z.boolean().default(false),
});
export type CreateDocumentVersionRestoreOperation = z.infer<
  typeof createDocumentVersionRestoreOperationSchema
>;

export const documentRestoreSourceKindSchema = z.enum(["version", "activity"]);
export type DocumentRestoreSourceKind = z.infer<typeof documentRestoreSourceKindSchema>;

export const documentVersionOperationSchema = z.object({
  operationId: uuidSchema,
  status: documentVersionOperationStatusSchema,
  sourceKind: documentRestoreSourceKindSchema,
  sourceVersionNo: z.number().int().positive().nullable(),
  sourceActivityEventId: uuidSchema.nullable(),
  beforeVersionNo: z.number().int().positive().nullable(),
  resultVersionNo: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
  expiresAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DocumentVersionOperation = z.infer<typeof documentVersionOperationSchema>;

export const executeDocumentVersionOperationSchema = z.object({
  type: z.literal("document.version.operation.execute"),
  operationId: uuidSchema,
});
export type ExecuteDocumentVersionOperation = z.infer<typeof executeDocumentVersionOperationSchema>;

export const documentVersionOperationAckSchema = z.object({
  type: z.literal("document.version.operation.ack"),
  operationId: uuidSchema,
  status: documentVersionOperationStatusSchema,
  resultVersionNo: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
});
export type DocumentVersionOperationAck = z.infer<typeof documentVersionOperationAckSchema>;

export function encodeDocumentVersionCursor(versionNo: number) {
  if (!Number.isSafeInteger(versionNo) || versionNo <= 0) {
    throw new Error("版本游标必须是正整数。");
  }
  return btoa(String(versionNo)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeDocumentVersionCursor(cursor: string) {
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    if (!/^[1-9]\d*$/u.test(decoded)) throw new Error("invalid");
    const versionNo = Number(decoded);
    if (!Number.isSafeInteger(versionNo)) throw new Error("invalid");
    return versionNo;
  } catch {
    throw new Error("DOCUMENT_VERSION_CURSOR_INVALID");
  }
}
