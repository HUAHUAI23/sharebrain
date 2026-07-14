// 验证 retention 的 dry-run、保留期、当前版本和近期 operation 引用保护。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { DOCUMENT_VERSION_FORMAT_VERSION, hashDocumentVersionValue } from "@sharebrain/contracts";
import { createDatabaseClient } from "@sharebrain/db";
import {
  documentChunks,
  documentVersionOperations,
  documentVersions,
  documents,
  mediaObjects,
  mediaUsages,
  projectModules,
} from "@sharebrain/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { runDocumentVersionRetention } from "./document-version-retention";

const now = new Date("2026-07-13T12:00:00.000Z");
const env = loadServerEnv({
  ...process.env,
  DOCUMENT_VERSION_RETENTION_DAYS: "90",
  DOCUMENT_VERSION_RETENTION_BATCH_SIZE: "100",
  DOCUMENT_VERSION_RETENTION_DRY_RUN: "true",
});
const db = createDatabaseClient(env.DATABASE_URL);
const documentId = crypto.randomUUID();
const expiryDocumentId = crypto.randomUUID();
const candidateId = crypto.randomUUID();
const recentOperationVersionId = crypto.randomUUID();
const activeOperationVersionId = crypto.randomUUID();
const recentVersionId = crypto.randomUUID();
const currentId = crypto.randomUUID();
const recentOperationId = crypto.randomUUID();
const activeOperationId = crypto.randomUUID();
const expiredOperationId = crypto.randomUUID();
const mediaId = crypto.randomUUID();
const value = [{ type: "p", children: [{ text: "retention" }] }];
let projectId = "";

beforeAll(async () => {
  const [module] = await db
    .select({ id: projectModules.id, projectId: projectModules.projectId })
    .from(projectModules)
    .where(and(eq(projectModules.tenantId, env.DEV_AUTH_TENANT_ID), isNull(projectModules.deletedAt)))
    .limit(1);
  if (!module) throw new Error("Retention tests require seeded project modules");
  projectId = module.projectId;
  await db.insert(documents).values([
    {
      id: documentId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      projectId,
      moduleId: module.id,
      title: "Retention test",
      currentVersion: 5,
      sortKey: `retention-${documentId}`,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    },
    {
      id: expiryDocumentId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      projectId,
      moduleId: module.id,
      title: "Retention expiry test",
      sortKey: `retention-expiry-${expiryDocumentId}`,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
    },
  ]);
  const contentHash = await hashDocumentVersionValue(value);
  const oldDate = new Date(now.getTime() - 120 * 86_400_000);
  const recentDate = new Date(now.getTime() - 24 * 60 * 60_000);
  await db.insert(documentVersions).values([
    {
      id: candidateId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 1,
      sealedAt: oldDate,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash,
      plateJson: value,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: recentOperationVersionId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 2,
      sealedAt: oldDate,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash,
      plateJson: value,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: activeOperationVersionId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 3,
      sealedAt: oldDate,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash,
      plateJson: value,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: recentVersionId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 4,
      sealedAt: recentDate,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash,
      plateJson: value,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: recentDate,
      updatedAt: recentDate,
    },
    {
      id: currentId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 5,
      kind: "restore",
      sealedAt: oldDate,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash,
      plateJson: value,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  ]);
  await db.insert(documentVersionOperations).values([
    {
      id: recentOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceVersionId: recentOperationVersionId,
      sourceVersionNo: 2,
      status: "applied",
      baseStateVectorHash: "recent-hash",
      expiresAt: new Date(now.getTime() + 60_000),
      appliedAt: now,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: activeOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      requestId: crypto.randomUUID(),
      sourceVersionId: activeOperationVersionId,
      sourceVersionNo: 3,
      status: "applying",
      baseStateVectorHash: "active-hash",
      expiresAt: new Date(now.getTime() + 60_000),
      applyingAt: oldDate,
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      id: expiredOperationId,
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId: expiryDocumentId,
      requestId: crypto.randomUUID(),
      sourceVersionNo: 1,
      status: "pending",
      baseStateVectorHash: "expired-hash",
      expiresAt: new Date(now.getTime() - 60_000),
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: oldDate,
      updatedAt: oldDate,
    },
  ]);
  await db.insert(mediaObjects).values({
    id: mediaId,
    tenantId: env.DEV_AUTH_TENANT_ID,
    bucket: "version-retention-test",
    objectKey: `retention/${mediaId}.png`,
    fileName: "retention.png",
    mimeType: "image/png",
    byteSize: 64,
    purpose: "inline",
    status: "active",
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
  await db.insert(mediaUsages).values({
    tenantId: env.DEV_AUTH_TENANT_ID,
    mediaId,
    resourceType: "document_version",
    resourceId: candidateId,
    usageKind: "inline",
    metadata: { documentId, versionNo: 1 },
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
  await db.insert(documentChunks).values({
    tenantId: env.DEV_AUTH_TENANT_ID,
    projectId,
    documentId,
    versionNo: 1,
    chunkIndex: 0,
    content: "retention",
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
});

afterAll(async () => {
  await db
    .delete(documentVersionOperations)
    .where(inArray(documentVersionOperations.documentId, [documentId, expiryDocumentId]));
  await db.delete(mediaUsages).where(eq(mediaUsages.mediaId, mediaId));
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  await db.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
  await db.delete(documents).where(inArray(documents.id, [documentId, expiryDocumentId]));
  await db.delete(mediaObjects).where(eq(mediaObjects.id, mediaId));
  await db.$client.end({ timeout: 1 });
});

describe("document version retention", () => {
  test("dry-runs and atomically deletes only checkpoints outside the protection set", async () => {
    const dryRun = await runDocumentVersionRetention(db, env, { now, dryRun: true });
    expect(dryRun.candidates).toBe(1);
    expect(dryRun.deleted).toBe(0);
    expect(dryRun.mediaUsages).toBe(1);
    expect(dryRun.expiredOperations).toBe(1);
    const [pendingAfterDryRun] = await db
      .select({ status: documentVersionOperations.status })
      .from(documentVersionOperations)
      .where(eq(documentVersionOperations.id, expiredOperationId));
    expect(pendingAfterDryRun?.status).toBe("pending");
    expect(
      await db.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)),
    ).toHaveLength(1);

    const applied = await runDocumentVersionRetention(db, env, { now, dryRun: false });
    expect(applied.deleted).toBe(1);
    expect(applied.mediaUsages).toBe(1);
    expect(applied.expiredOperations).toBe(1);
    const remaining = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId));
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [recentOperationVersionId, activeOperationVersionId, recentVersionId, currentId].sort(),
    );
    expect(
      await db.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)),
    ).toHaveLength(0);
    const [releasedUsage] = await db
      .select({ deletedAt: mediaUsages.deletedAt })
      .from(mediaUsages)
      .where(eq(mediaUsages.mediaId, mediaId));
    expect(releasedUsage?.deletedAt?.toISOString()).toBe(now.toISOString());
    const [expiredOperation] = await db
      .select({ errorCode: documentVersionOperations.errorCode, status: documentVersionOperations.status })
      .from(documentVersionOperations)
      .where(eq(documentVersionOperations.id, expiredOperationId));
    expect(expiredOperation).toEqual({
      errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
      status: "expired",
    });

    const unlimited = await runDocumentVersionRetention(
      db,
      loadServerEnv({ ...process.env, DOCUMENT_VERSION_RETENTION_DAYS: "0" }),
      { now, dryRun: false },
    );
    expect(unlimited.deleted).toBe(0);
  });
});
