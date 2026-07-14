// 验证恢复 executor 在真实数据库与 Hocuspocus Document 上的完整状态转换和内容结果。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Document } from "@hocuspocus/server";
import { loadServerEnv } from "@sharebrain/config";
import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  hashDocumentVersionValue,
} from "@sharebrain/contracts";
import { createDatabaseClient, materializeDocumentRevision } from "@sharebrain/db";
import {
  auditLogs,
  documentActivityEvents,
  documentCrdtSnapshots,
  documentReviewStates,
  documentVersionOperations,
  documentVersions,
  documents,
  mediaUsages,
  projectModules,
  searchItems,
} from "@sharebrain/db/schema";
import { slateNodesToInsertDelta, yTextToSlateElement } from "@slate-yjs/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Node } from "slate";
import * as Y from "yjs";

import { assertRestoreTopology } from "./index";
import { executeDocumentVersionOperation, parseExecuteVersionOperation } from "./version-operations";

const env = loadServerEnv({ ...process.env, DOCUMENT_VERSION_RESTORE_ENABLED: "true" });
const db = createDatabaseClient(env.DATABASE_URL);
const documentId = crypto.randomUUID();
const sourceVersionId = crypto.randomUUID();
const currentVersionId = crypto.randomUUID();
const operationId = crypto.randomUUID();
const conflictOperationId = crypto.randomUUID();
const forceOperationId = crypto.randomUUID();
const expiredOperationId = crypto.randomUUID();
const activityOperationId = crypto.randomUUID();
const activityEventId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const sourceValue = [{ type: "p", children: [{ text: "restored body" }] }];
const currentValue = [
  { type: "p", children: [{ text: "current body", comment_thread: true }] },
];
const document = new Document(`document:${documentId}`);

async function sha256Hex(value: Uint8Array) {
  const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeAll(async () => {
  const [module] = await db
    .select({ id: projectModules.id, projectId: projectModules.projectId })
    .from(projectModules)
    .where(and(eq(projectModules.tenantId, env.DEV_AUTH_TENANT_ID), isNull(projectModules.deletedAt)))
    .limit(1);
  if (!module) throw new Error("Version operation tests require seeded project modules");
  await db.insert(documents).values({
    id: documentId,
    tenantId: env.DEV_AUTH_TENANT_ID,
    projectId: module.projectId,
    moduleId: module.id,
    title: "Version operation test",
    currentVersion: 2,
    sortKey: `version-operation-${documentId}`,
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
  await db.insert(documentVersions).values([
    {
      id: sourceVersionId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 1,
      kind: "auto",
      sealedAt: new Date(Date.now() - 60_000),
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash: await hashDocumentVersionValue(sourceValue),
      plateJson: sourceValue,
      plainText: "restored body",
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    },
    {
      id: currentVersionId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 2,
      kind: "auto",
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash: await hashDocumentVersionValue(currentValue),
      plateJson: currentValue,
      plainText: "current body",
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    },
  ]);
  const root = document.get("content", Y.XmlText);
  root.applyDelta(slateNodesToInsertDelta(currentValue as unknown as Node[]), { sanitize: false });
  const review = document.getMap("review");
  const discussions = new Y.Map<unknown>();
  const discussion = new Y.Map<unknown>();
  discussion.set("id", "thread");
  discussion.set("createdAt", new Date().toISOString());
  discussion.set("updatedAt", new Date().toISOString());
  discussion.set("userId", env.DEV_AUTH_USER_ID);
  discussion.set("isResolved", false);
  discussion.set("commentsById", new Y.Map());
  discussions.set("thread", discussion);
  review.set("discussionsById", discussions);

  await db.insert(documentVersionOperations).values({
    id: operationId,
    tenantId: env.DEV_AUTH_TENANT_ID,
    documentId,
    requestId,
    sourceVersionId,
    sourceVersionNo: 1,
    status: "pending",
    baseStateVectorHash: await sha256Hex(Y.encodeStateVector(document)),
    expiresAt: new Date(Date.now() + 60_000),
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
});

afterAll(async () => {
  document.destroy();
  await db.delete(auditLogs).where(eq(auditLogs.documentId, documentId));
  await db.delete(documentVersionOperations).where(eq(documentVersionOperations.documentId, documentId));
  await db.delete(documentActivityEvents).where(eq(documentActivityEvents.documentId, documentId));
  const versions = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  if (versions.length > 0) {
    await db
      .delete(mediaUsages)
      .where(inArray(mediaUsages.resourceId, versions.map((version) => version.id)));
  }
  await db.delete(documentCrdtSnapshots).where(eq(documentCrdtSnapshots.documentId, documentId));
  await db.delete(documentReviewStates).where(eq(documentReviewStates.documentId, documentId));
  await db.delete(searchItems).where(eq(searchItems.documentId, documentId));
  await db.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
  await db.delete(documents).where(eq(documents.id, documentId));
  await db.$client.end({ timeout: 1 });
});

describe("document version operation executor", () => {
  test("restores content with before/result checkpoints and detached discussions", async () => {
    const ack = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      operationId,
    );
    expect(ack.status).toBe("applied");
    expect(yTextToSlateElement(document.get("content", Y.XmlText)).children as unknown).toEqual([
      { children: [{ text: "restored body" }], type: "p" },
    ]);

    const [operation] = await db
      .select()
      .from(documentVersionOperations)
      .where(eq(documentVersionOperations.id, operationId));
    expect(operation?.beforeVersionNo).toBe(2);
    expect(operation?.resultVersionNo).toBe(3);
    expect(operation?.status).toBe("applied");
    const review = document.getMap("review") as Y.Map<unknown>;
    const discussions = review.get("discussionsById");
    const discussion = discussions instanceof Y.Map ? discussions.get("thread") : undefined;
    expect(discussion instanceof Y.Map ? discussion.get("detachedReason") : undefined).toBe(
      "version_restore",
    );

    const repeated = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      operationId,
    );
    expect(repeated.resultVersionNo).toBe(3);

    await db.insert(documentVersionOperations).values({
      id: conflictOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceVersionId,
      sourceVersionNo: 1,
      status: "pending",
      baseStateVectorHash: "stale-state-vector",
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    });
    await expect(
      executeDocumentVersionOperation(
        db,
        document,
        {
          tenantId: crypto.randomUUID(),
          documentId,
          userId: env.DEV_AUTH_USER_ID,
          role: "editor",
        },
        conflictOperationId,
      ),
    ).rejects.toThrow("DOCUMENT_VERSION_OPERATION_NOT_FOUND");
    await expect(
      executeDocumentVersionOperation(
        db,
        document,
        {
          tenantId: env.DEV_AUTH_TENANT_ID,
          documentId: crypto.randomUUID(),
          userId: env.DEV_AUTH_USER_ID,
          role: "editor",
        },
        conflictOperationId,
      ),
    ).rejects.toThrow("DOCUMENT_VERSION_OPERATION_NOT_FOUND");
    await expect(
      executeDocumentVersionOperation(
        db,
        document,
        {
          tenantId: env.DEV_AUTH_TENANT_ID,
          documentId,
          userId: crypto.randomUUID(),
          role: "editor",
        },
        conflictOperationId,
      ),
    ).rejects.toThrow("DOCUMENT_VERSION_OPERATION_NOT_FOUND");
    await expect(
      executeDocumentVersionOperation(
        db,
        document,
        {
          tenantId: env.DEV_AUTH_TENANT_ID,
          documentId,
          userId: env.DEV_AUTH_USER_ID,
          role: "viewer",
        },
        conflictOperationId,
      ),
    ).rejects.toThrow("FORBIDDEN");

    const conflict = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      conflictOperationId,
    );
    expect(conflict).toMatchObject({
      status: "conflict",
      errorCode: "DOCUMENT_VERSION_OPERATION_CONFLICT",
    });

    await db.insert(documentVersionOperations).values({
      id: forceOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceVersionId,
      sourceVersionNo: 1,
      status: "pending",
      baseStateVectorHash: "stale-state-vector",
      force: true,
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    });
    const forced = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      forceOperationId,
    );
    expect(forced).toMatchObject({ status: "applied", resultVersionNo: 4 });

    const activityValue = [{ type: "p", children: [{ text: "activity revision body" }] }];
    const revisions = await db.transaction(async (tx) => ({
      before: await materializeDocumentRevision(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: sourceValue,
        userId: env.DEV_AUTH_USER_ID,
      }),
      after: await materializeDocumentRevision(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: activityValue,
        userId: env.DEV_AUTH_USER_ID,
      }),
    }));
    await db.insert(documentActivityEvents).values({
      id: activityEventId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      actorId: env.DEV_AUTH_USER_ID,
      beforeRevisionId: revisions.before.revision.id,
      afterRevisionId: revisions.after.revision.id,
      type: "content_edited",
      status: "sealed",
      sourceKey: `activity-source:${activityEventId}`,
      details: {
        kind: "content",
        changes: [],
        totalChangedBlocks: 1,
        truncated: true,
      },
      startedAt: new Date(),
      occurredAt: new Date(),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    });
    await db.insert(documentVersionOperations).values({
      id: activityOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceKind: "activity",
      sourceRevisionId: revisions.after.revision.id,
      sourceActivityEventId: activityEventId,
      status: "pending",
      baseStateVectorHash: await sha256Hex(Y.encodeStateVector(document)),
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    });
    const activityRestore = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      activityOperationId,
    );
    expect(activityRestore).toMatchObject({ status: "applied", resultVersionNo: 5 });
    expect(yTextToSlateElement(document.get("content", Y.XmlText)).children as unknown).toEqual([
      { children: [{ text: "activity revision body" }], type: "p" },
    ]);

    const operationAudits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.documentId, documentId));
    expect(operationAudits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "document.version.restore_applied",
        "document.version.restore_conflict",
      ]),
    );

    await db.insert(documentVersionOperations).values({
      id: expiredOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceVersionId,
      sourceVersionNo: 1,
      status: "pending",
      baseStateVectorHash: "expired-state-vector",
      expiresAt: new Date(Date.now() - 1_000),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    });
    const expired = await executeDocumentVersionOperation(
      db,
      document,
      {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        userId: env.DEV_AUTH_USER_ID,
        role: "editor",
      },
      expiredOperationId,
    );
    expect(expired).toMatchObject({
      operationId: expiredOperationId,
      status: "expired",
      errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
    });
  });

  test("validates stateless payloads and restore topology", () => {
    expect(
      parseExecuteVersionOperation(
        JSON.stringify({ type: "document.version.operation.execute", operationId }),
      ).operationId,
    ).toBe(operationId);
    expect(() => parseExecuteVersionOperation("{}")) .toThrow();
    expect(() =>
      assertRestoreTopology(
        loadServerEnv({
          ...process.env,
          DOCUMENT_VERSION_RESTORE_ENABLED: "true",
          COLLAB_REPLICA_COUNT: "2",
          COLLAB_SHARED_SYNC_ENABLED: "false",
        }),
      ),
    ).toThrow("single collab replica");
  });
});
