// 在活跃 Y.Doc 上串行执行已由 API 鉴权并持久化的正文恢复 operation。
import type { Document } from "@hocuspocus/server";
import {
  DOCUMENT_DISCUSSIONS_BY_ID_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  documentVersionOperationAckSchema,
  executeDocumentVersionOperationSchema,
  type DocumentVersionOperationAck,
} from "@sharebrain/contracts";
import {
  materializeDocumentRevision,
  recordStandaloneDocumentActivity,
  type DatabaseClient,
} from "@sharebrain/db";
import {
  auditLogs,
  documentActivityEvents,
  documentRevisions,
  documentVersionOperations,
  documentVersions,
} from "@sharebrain/db/schema";
import { slateNodesToInsertDelta } from "@slate-yjs/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as Y from "yjs";

import type { CollabContext } from "./auth";
import {
  extractDocumentCommentIds,
  prepareDocumentYjsNodes,
  storeDocumentSnapshot,
} from "./document-store";

const restoreGates = new Set<string>();

function operationAck(input: DocumentVersionOperationAck) {
  return documentVersionOperationAckSchema.parse(input);
}

async function sha256Hex(value: Uint8Array) {
  const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unwrapStoredVersion(
  value:
    | null
    | undefined
    | { id: string; versionNo: number }
    | { version: { id: string; versionNo: number } },
) {
  if (!value) return null;
  return "version" in value ? value.version : value;
}

export function isDocumentRestoreGated(documentName: string) {
  return restoreGates.has(documentName);
}

export function parseExecuteVersionOperation(payload: string) {
  if (payload.length > 1024) throw new Error("DOCUMENT_VERSION_OPERATION_PAYLOAD_TOO_LARGE");
  return executeDocumentVersionOperationSchema.parse(JSON.parse(payload));
}

async function resolveRestoreSource(
  db: DatabaseClient,
  operation: typeof documentVersionOperations.$inferSelect,
) {
  if (operation.sourceKind === "activity") {
    if (!operation.sourceActivityEventId || !operation.sourceRevisionId) return null;
    const [event] = await db
      .select({ afterRevisionId: documentActivityEvents.afterRevisionId })
      .from(documentActivityEvents)
      .where(
        and(
          eq(documentActivityEvents.id, operation.sourceActivityEventId),
          eq(documentActivityEvents.tenantId, operation.tenantId),
          eq(documentActivityEvents.documentId, operation.documentId),
          eq(documentActivityEvents.type, "content_edited"),
          eq(documentActivityEvents.status, "sealed"),
          isNull(documentActivityEvents.deletedAt),
        ),
      )
      .limit(1);
    if (event?.afterRevisionId !== operation.sourceRevisionId) return null;
    const [revision] = await db
      .select()
      .from(documentRevisions)
      .where(
        and(
          eq(documentRevisions.id, operation.sourceRevisionId),
          eq(documentRevisions.tenantId, operation.tenantId),
          eq(documentRevisions.documentId, operation.documentId),
          isNull(documentRevisions.deletedAt),
        ),
      )
      .limit(1);
    if (!revision) return null;
    return {
      sourceKind: "activity" as const,
      revisionId: revision.id,
      versionId: null,
      versionNo: null,
      activityEventId: operation.sourceActivityEventId,
      formatVersion: revision.formatVersion,
      value: revision.plateJson,
    };
  }

  if (!operation.sourceVersionId) return null;
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, operation.sourceVersionId),
        eq(documentVersions.tenantId, operation.tenantId),
        eq(documentVersions.documentId, operation.documentId),
        isNull(documentVersions.deletedAt),
      ),
    )
    .limit(1);
  if (!version || !version.sealedAt || version.formatVersion !== 1) return null;
  if (
    operation.sourceRevisionId &&
    version.revisionId &&
    operation.sourceRevisionId !== version.revisionId
  ) {
    return null;
  }

  let revisionId = operation.sourceRevisionId ?? version.revisionId;
  if (!revisionId) {
    const materialized = await db.transaction(async (tx) => {
      const result = await materializeDocumentRevision(tx, {
        tenantId: operation.tenantId,
        documentId: operation.documentId,
        value: version.plateJson,
        userId: operation.createdBy,
      });
      await tx
        .update(documentVersions)
        .set({ revisionId: result.revision.id })
        .where(and(eq(documentVersions.id, version.id), isNull(documentVersions.revisionId)));
      await tx
        .update(documentVersionOperations)
        .set({ sourceRevisionId: result.revision.id })
        .where(and(eq(documentVersionOperations.id, operation.id), isNull(documentVersionOperations.sourceRevisionId)));
      return result.revision;
    });
    revisionId = materialized.id;
  }
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.id, revisionId),
        eq(documentRevisions.tenantId, operation.tenantId),
        eq(documentRevisions.documentId, operation.documentId),
        isNull(documentRevisions.deletedAt),
      ),
    )
    .limit(1);
  if (!revision) return null;
  return {
    sourceKind: "version" as const,
    revisionId: revision.id,
    versionId: version.id,
    versionNo: version.versionNo,
    activityEventId: null,
    formatVersion: revision.formatVersion,
    value: revision.plateJson,
  };
}

export async function executeDocumentVersionOperation(
  db: DatabaseClient,
  document: Document,
  context: CollabContext,
  operationId: string,
  options: { interactive?: boolean } = {},
) {
  const interactive = options.interactive ?? true;
  const [initial] = await db
    .select()
    .from(documentVersionOperations)
    .where(
      and(
        eq(documentVersionOperations.id, operationId),
        eq(documentVersionOperations.tenantId, context.tenantId),
        eq(documentVersionOperations.documentId, context.documentId),
        isNull(documentVersionOperations.deletedAt),
      ),
    )
    .limit(1);
  if (!initial || (interactive && initial.createdBy !== context.userId)) {
    throw new Error("DOCUMENT_VERSION_OPERATION_NOT_FOUND");
  }
  if (interactive && !["editor", "admin"].includes(context.role)) {
    throw new Error("FORBIDDEN");
  }
  if (!inArrayStatus(initial.status)) return ackFromOperation(initial);

  restoreGates.add(document.name);
  try {
    return await document.saveMutex.runExclusive(async () => {
      const [operation] = await db
        .select()
        .from(documentVersionOperations)
        .where(eq(documentVersionOperations.id, operationId))
        .limit(1);
      if (!operation || !inArrayStatus(operation.status)) {
        return operation ? ackFromOperation(operation) : operationAck({
          type: "document.version.operation.ack",
          operationId,
          status: "failed",
          resultVersionNo: null,
          errorCode: "DOCUMENT_VERSION_OPERATION_NOT_FOUND",
        });
      }

      if (operation.status === "pending" && operation.expiresAt.getTime() <= Date.now()) {
        const [expired] = await db
          .update(documentVersionOperations)
          .set({
            status: "expired",
            errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
            updatedBy: operation.createdBy,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(documentVersionOperations.id, operation.id),
              eq(documentVersionOperations.status, "pending"),
            ),
          )
          .returning();
        return ackFromOperation(expired ?? operation);
      }

      const [existingResult] = await db
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.operationId, operation.id),
            isNull(documentVersions.deletedAt),
          ),
        )
        .limit(1);
      if (existingResult) {
        const now = new Date();
        const applied = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(documentVersionOperations)
            .set({
              status: "applied",
              resultVersionId: existingResult.id,
              resultVersionNo: existingResult.versionNo,
              appliedAt: now,
              updatedBy: operation.createdBy,
              updatedAt: now,
            })
            .where(eq(documentVersionOperations.id, operation.id))
            .returning();
          await recordStandaloneDocumentActivity(tx, {
            tenantId: operation.tenantId,
            documentId: operation.documentId,
            actorId: operation.createdBy,
            type: "version_restored",
            sourceKey: `restore:${operation.id}`,
            details: {
              kind: "restore",
              operationId: operation.id,
              sourceKind: operation.sourceKind === "activity" ? "activity" : "version",
              sourceVersionNo: operation.sourceVersionNo,
              sourceActivityEventId: operation.sourceActivityEventId,
              resultVersionNo: existingResult.versionNo,
            },
            occurredAt: now,
            now,
          });
          return updated;
        });
        return ackFromOperation(applied ?? operation);
      }

      const source = await resolveRestoreSource(db, operation);
      if (!source || source.formatVersion !== 1) {
        return failOperation(db, operation, "DOCUMENT_VERSION_VALUE_INVALID");
      }

      const executorContext: CollabContext = {
        ...context,
        userId: operation.createdBy,
        tenantId: operation.tenantId,
        documentId: operation.documentId,
      };
      if (operation.status === "pending") {
        const stateVectorHash = await sha256Hex(Y.encodeStateVector(document));
        if (!operation.force && stateVectorHash !== operation.baseStateVectorHash) {
          const now = new Date();
          const conflict = await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(documentVersionOperations)
              .set({
                status: "conflict",
                errorCode: "DOCUMENT_VERSION_OPERATION_CONFLICT",
                updatedBy: operation.createdBy,
                updatedAt: now,
              })
              .where(
                and(
                  eq(documentVersionOperations.id, operation.id),
                  eq(documentVersionOperations.status, "pending"),
                ),
              )
              .returning();
            if (!updated) return null;
            await tx.insert(auditLogs).values({
              tenantId: operation.tenantId,
              actorId: operation.createdBy,
              action: "document.version.restore_conflict",
              resourceType: "document_version_operation",
              resourceId: operation.id,
              documentId: operation.documentId,
              metadata: {
                sourceKind: operation.sourceKind,
                sourceVersionNo: operation.sourceVersionNo,
                sourceActivityEventId: operation.sourceActivityEventId,
                force: false,
              },
              createdBy: operation.createdBy,
              updatedBy: operation.createdBy,
              createdAt: now,
              updatedAt: now,
            });
            return updated;
          });
          if (conflict) {
            console.info(
              JSON.stringify({
                event: "document.version.restore_conflict",
                tenantId: operation.tenantId,
                documentId: operation.documentId,
                operationId: operation.id,
              }),
            );
          }
          return ackFromOperation(conflict ?? operation);
        }

        const beforeStored = unwrapStoredVersion(
          await storeDocumentSnapshot(db, executorContext, document, { seal: true }),
        );
        if (!beforeStored) return failOperation(db, operation, "DOCUMENT_NOT_FOUND");
        const [applying] = await db
          .update(documentVersionOperations)
          .set({
            status: "applying",
            beforeVersionId: beforeStored.id,
            beforeVersionNo: beforeStored.versionNo,
            applyingAt: new Date(),
            updatedBy: operation.createdBy,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(documentVersionOperations.id, operation.id),
              eq(documentVersionOperations.status, "pending"),
            ),
          )
          .returning();
        if (!applying) throw new Error("DOCUMENT_VERSION_OPERATION_CLAIM_FAILED");
        console.info(
          JSON.stringify({
            event: "document.version.restore_applying",
            tenantId: operation.tenantId,
            documentId: operation.documentId,
            operationId: operation.id,
            beforeVersionNo: applying.beforeVersionNo,
            sourceVersionNo: operation.sourceVersionNo,
            force: operation.force,
          }),
        );
      }

      let restoredValue: ReturnType<typeof prepareDocumentYjsNodes>;
      try {
        restoredValue = prepareDocumentYjsNodes(source.value);
      } catch {
        return failOperation(db, operation, "DOCUMENT_VERSION_VALUE_INVALID");
      }
      const sharedRoot = document.get("content", Y.XmlText);
      document.transact(() => {
        sharedRoot.delete(0, sharedRoot.length);
        sharedRoot.applyDelta(slateNodesToInsertDelta(restoredValue), { sanitize: false });
        detachMissingDiscussions(document, restoredValue);
      }, { source: "local", skipStoreHooks: true, context: executorContext });

      const result = unwrapStoredVersion(
        await storeDocumentSnapshot(db, executorContext, document, {
          restore: {
            operationId: operation.id,
            sourceKind: source.sourceKind,
            sourceRevisionId: source.revisionId,
            sourceVersionId: source.versionId,
            sourceVersionNo: source.versionNo,
            sourceActivityEventId: source.activityEventId,
          },
        }),
      );
      if (!result) throw new Error("DOCUMENT_VERSION_RESULT_STORE_FAILED");
      const now = new Date();
      const applied = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(documentVersionOperations)
          .set({
            status: "applied",
            resultVersionId: result.id,
            resultVersionNo: result.versionNo,
            errorCode: null,
            appliedAt: now,
            updatedBy: operation.createdBy,
            updatedAt: now,
          })
          .where(
            and(
              eq(documentVersionOperations.id, operation.id),
              eq(documentVersionOperations.status, "applying"),
            ),
          )
          .returning();
        if (!updated) throw new Error("DOCUMENT_VERSION_OPERATION_FINALIZE_FAILED");
        await tx.insert(auditLogs).values({
          tenantId: operation.tenantId,
          actorId: operation.createdBy,
          action: "document.version.restore_applied",
          resourceType: "document_version_operation",
          resourceId: operation.id,
          documentId: operation.documentId,
          metadata: {
            beforeVersionNo: updated.beforeVersionNo,
            sourceKind: updated.sourceKind,
            sourceVersionNo: updated.sourceVersionNo,
            sourceActivityEventId: updated.sourceActivityEventId,
            resultVersionNo: result.versionNo,
            force: operation.force,
          },
          createdBy: operation.createdBy,
          updatedBy: operation.createdBy,
          createdAt: now,
          updatedAt: now,
        });
        await recordStandaloneDocumentActivity(tx, {
          tenantId: operation.tenantId,
          documentId: operation.documentId,
          actorId: operation.createdBy,
          type: "version_restored",
          sourceKey: `restore:${operation.id}`,
          details: {
            kind: "restore",
            operationId: operation.id,
            sourceKind: operation.sourceKind === "activity" ? "activity" : "version",
            sourceVersionNo: operation.sourceVersionNo,
            sourceActivityEventId: operation.sourceActivityEventId,
            resultVersionNo: result.versionNo,
          },
          occurredAt: now,
          now,
        });
        return updated;
      });
      console.info(
        JSON.stringify({
          event: "document.version.restore_applied",
          tenantId: operation.tenantId,
          documentId: operation.documentId,
          operationId: operation.id,
          resultVersionNo: result.versionNo,
          force: operation.force,
        }),
      );
      return ackFromOperation(applied);
    });
  } finally {
    restoreGates.delete(document.name);
  }
}

export async function resumeDocumentVersionOperation(
  db: DatabaseClient,
  document: Document,
  context: CollabContext,
) {
  const [operation] = await db
    .select()
    .from(documentVersionOperations)
    .where(
      and(
        eq(documentVersionOperations.tenantId, context.tenantId),
        eq(documentVersionOperations.documentId, context.documentId),
        inArray(documentVersionOperations.status, ["pending", "applying"]),
        isNull(documentVersionOperations.deletedAt),
      ),
    )
    .limit(1);
  if (!operation) return null;
  return executeDocumentVersionOperation(
    db,
    document,
    { ...context, userId: operation.createdBy },
    operation.id,
    { interactive: false },
  );
}

function detachMissingDiscussions(document: Document, restoredValue: unknown) {
  const presentIds = extractDocumentCommentIds(restoredValue);
  const reviewMap = document.getMap(DOCUMENT_REVIEW_MAP_NAME);
  const discussions = reviewMap.get(DOCUMENT_DISCUSSIONS_BY_ID_KEY);
  if (!(discussions instanceof Y.Map)) return;
  const detachedAt = new Date().toISOString();
  for (const [discussionId, value] of discussions.entries()) {
    if (presentIds.has(discussionId) || !(value instanceof Y.Map)) continue;
    value.set("detachedAt", detachedAt);
    value.set("detachedReason", "version_restore");
  }
}

function inArrayStatus(status: string) {
  return status === "pending" || status === "applying";
}

function ackFromOperation(operation: typeof documentVersionOperations.$inferSelect) {
  const status = operation.status;
  if (
    status !== "pending" &&
    status !== "applying" &&
    status !== "applied" &&
    status !== "conflict" &&
    status !== "failed" &&
    status !== "expired"
  ) {
    throw new Error("DOCUMENT_VERSION_OPERATION_STATUS_INVALID");
  }
  return operationAck({
    type: "document.version.operation.ack",
    operationId: operation.id,
    status,
    resultVersionNo: operation.resultVersionNo,
    errorCode: operation.errorCode,
  });
}

async function failOperation(
  db: DatabaseClient,
  operation: typeof documentVersionOperations.$inferSelect,
  errorCode: string,
) {
  const now = new Date();
  const failed = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documentVersionOperations)
      .set({
        status: "failed",
        errorCode,
        updatedBy: operation.createdBy,
        updatedAt: now,
      })
      .where(
        and(
          eq(documentVersionOperations.id, operation.id),
          inArray(documentVersionOperations.status, ["pending", "applying"]),
        ),
      )
      .returning();
    if (!updated) return null;
    await tx.insert(auditLogs).values({
      tenantId: operation.tenantId,
      actorId: operation.createdBy,
      action: "document.version.restore_failed",
      resourceType: "document_version_operation",
      resourceId: operation.id,
      documentId: operation.documentId,
      metadata: {
        sourceVersionNo: operation.sourceVersionNo,
        force: operation.force,
        errorCode,
      },
      createdBy: operation.createdBy,
      updatedBy: operation.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return updated;
  });
  if (failed) {
    console.error(
      JSON.stringify({
        event: "document.version.restore_failed",
        tenantId: operation.tenantId,
        documentId: operation.documentId,
        operationId: operation.id,
        errorCode,
      }),
    );
  }
  return ackFromOperation(failed ?? operation);
}
