// 验证共享版本存储的窗口、不可变性、并发编号、幂等和历史媒体引用语义。
import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { createDatabaseClient } from "./client";
import {
  cleanupUnreferencedDocumentRevisions,
  materializeDocumentRevision,
} from "./document-revision-store";
import {
  insertRestoreVersion,
  materializeAutoVersion,
  sealCurrentVersion,
} from "./document-version-store";
import {
  documentVersions,
  documentRevisions,
  documents,
  mediaObjects,
  mediaUsages,
  projectModules,
} from "./schema";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const documentIds: string[] = [];
const mediaIds = [crypto.randomUUID(), crypto.randomUUID()];
let moduleId = "";
let projectId = "";

async function createTestDocument(title: string) {
  const documentId = crypto.randomUUID();
  documentIds.push(documentId);
  await db.insert(documents).values({
    id: documentId,
    tenantId: env.DEV_AUTH_TENANT_ID,
    projectId,
    moduleId,
    title,
    sortKey: `version-store-${documentId}`,
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
  return documentId;
}

async function materialize(
  documentId: string,
  value: unknown,
  now: Date,
) {
  return db.transaction((tx) =>
    materializeAutoVersion(tx, {
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      value,
      userId: env.DEV_AUTH_USER_ID,
      now,
    }),
  );
}

beforeAll(async () => {
  const [module] = await db
    .select({ id: projectModules.id, projectId: projectModules.projectId })
    .from(projectModules)
    .where(
      and(
        eq(projectModules.tenantId, env.DEV_AUTH_TENANT_ID),
        isNull(projectModules.deletedAt),
      ),
    )
    .limit(1);
  if (!module) throw new Error("Document version store tests require seeded project modules");
  moduleId = module.id;
  projectId = module.projectId;

  const now = new Date();
  await db.insert(mediaObjects).values(
    mediaIds.map((id, index) => ({
      id,
      tenantId: env.DEV_AUTH_TENANT_ID,
      bucket: "version-store-test",
      objectKey: `versions/${id}.png`,
      fileName: `version-${index + 1}.png`,
      mimeType: "image/png",
      byteSize: 64,
      purpose: "inline",
      status: "active",
      createdBy: env.DEV_AUTH_USER_ID,
      updatedBy: env.DEV_AUTH_USER_ID,
      createdAt: now,
      updatedAt: now,
    })),
  );
});

afterAll(async () => {
  if (documentIds.length > 0) {
    const versions = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, documentIds));
    if (versions.length > 0) {
      await db
        .delete(mediaUsages)
        .where(inArray(mediaUsages.resourceId, versions.map((version) => version.id)));
    }
    await db.delete(documentVersions).where(inArray(documentVersions.documentId, documentIds));
    await db.delete(documents).where(inArray(documents.id, documentIds));
  }
  await db.delete(mediaUsages).where(inArray(mediaUsages.mediaId, mediaIds));
  await db.delete(mediaObjects).where(inArray(mediaObjects.id, mediaIds));
  await db.$client.end({ timeout: 1 });
});

describe("document version store", () => {
  test("deduplicates content-addressed revisions and removes only unreferenced rows", async () => {
    const documentId = await createTestDocument("Revision deduplication");
    const first = await db.transaction((tx) =>
      materializeDocumentRevision(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: [{ type: "p", children: [{ text: "same" }] }],
        userId: env.DEV_AUTH_USER_ID,
      }),
    );
    const repeated = await db.transaction((tx) =>
      materializeDocumentRevision(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: [{ children: [{ text: "same" }], type: "p" }],
        userId: env.DEV_AUTH_USER_ID,
      }),
    );
    expect(repeated.revision.id).toBe(first.revision.id);
    expect(repeated.created).toBe(false);
    const cleaned = await db.transaction((tx) =>
      cleanupUnreferencedDocumentRevisions(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        revisionIds: [first.revision.id],
        userId: env.DEV_AUTH_USER_ID,
      }),
    );
    expect(cleaned.deletedRevisions).toBe(1);
    expect(
      await db.select().from(documentRevisions).where(eq(documentRevisions.id, first.revision.id)),
    ).toHaveLength(0);
  });

  test("uses a fixed five-minute window and preserves sealed payloads", async () => {
    const documentId = await createTestDocument("Fixed version window");
    const startedAt = new Date("2026-07-13T08:00:00.000Z");
    const first = await materialize(
      documentId,
      [{ type: "p", children: [{ text: "first" }] }],
      startedAt,
    );
    const updated = await materialize(
      documentId,
      [{ children: [{ bold: true, text: "second" }], type: "p" }],
      new Date(startedAt.getTime() + 4 * 60_000),
    );
    const duplicate = await materialize(
      documentId,
      [{ type: "p", children: [{ text: "second", bold: true }] }],
      new Date(startedAt.getTime() + 4 * 60_000 + 1),
    );
    const boundary = await materialize(
      documentId,
      [{ type: "p", children: [{ text: "after five minutes" }] }],
      new Date(startedAt.getTime() + 5 * 60_000),
    );

    expect(first?.created).toBe(true);
    expect(updated?.version.id).toBe(first?.version.id);
    expect(duplicate?.version.id).toBe(first?.version.id);
    expect(boundary?.created).toBe(true);
    expect(boundary?.version.versionNo).toBe(2);

    const versions = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(asc(documentVersions.versionNo));
    expect(versions).toHaveLength(2);
    expect(versions[0]?.sealedAt?.toISOString()).toBe(
      new Date(startedAt.getTime() + 5 * 60_000).toISOString(),
    );
    expect(versions[0]?.plateJson).toEqual([
      { children: [{ bold: true, text: "second" }], type: "p" },
    ]);
    expect(versions[1]?.sealedAt).toBeNull();
  });

  test("keeps restore results idempotent and starts a new auto checkpoint", async () => {
    const documentId = await createTestDocument("Restore version idempotence");
    const startedAt = new Date("2026-07-13T09:00:00.000Z");
    const source = await db.transaction((tx) =>
      sealCurrentVersion(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: [{ type: "p", children: [{ text: "source" }] }],
        userId: env.DEV_AUTH_USER_ID,
        now: startedAt,
      }),
    );
    if (!source) throw new Error("Expected a source checkpoint");
    if (!source.revisionId) throw new Error("Expected a source revision");
    const sourceRevisionId = source.revisionId;
    const operationId = crypto.randomUUID();
    const restoreInput = {
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      value: [{ type: "p", children: [{ text: "source" }] }],
      userId: env.DEV_AUTH_USER_ID,
      operationId,
      sourceKind: "version" as const,
      sourceRevisionId,
      sourceVersionId: source.id,
      sourceVersionNo: source.versionNo,
      now: new Date(startedAt.getTime() + 1_000),
    };
    const restored = await db.transaction((tx) => insertRestoreVersion(tx, restoreInput));
    const repeated = await db.transaction((tx) => insertRestoreVersion(tx, restoreInput));
    const edited = await materialize(
      documentId,
      [{ type: "p", children: [{ text: "edited after restore" }] }],
      new Date(startedAt.getTime() + 2_000),
    );

    expect(repeated?.id).toBe(restored?.id);
    expect(restored).toMatchObject({ kind: "restore", versionNo: 2, operationId });
    expect(edited).toMatchObject({ created: true, version: { kind: "auto", versionNo: 3 } });
    const [document] = await db
      .select({ currentVersion: documents.currentVersion })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document?.currentVersion).toBe(3);
  });

  test("serializes concurrent version number allocation with the document row lock", async () => {
    const documentId = await createTestDocument("Concurrent version numbers");
    const startedAt = new Date("2026-07-13T10:00:00.000Z");
    const source = await db.transaction((tx) =>
      sealCurrentVersion(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        value: [{ type: "p", children: [{ text: "source" }] }],
        userId: env.DEV_AUTH_USER_ID,
        now: startedAt,
      }),
    );
    if (!source) throw new Error("Expected a source checkpoint");
    if (!source.revisionId) throw new Error("Expected a source revision");
    const sourceRevisionId = source.revisionId;

    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        db.transaction((tx) =>
          insertRestoreVersion(tx, {
            tenantId: env.DEV_AUTH_TENANT_ID,
            documentId,
            value: [{ type: "p", children: [{ text: "source" }] }],
            userId: env.DEV_AUTH_USER_ID,
            operationId: crypto.randomUUID(),
            sourceKind: "version",
            sourceRevisionId,
            sourceVersionId: source.id,
            sourceVersionNo: source.versionNo,
            now: new Date(startedAt.getTime() + (index + 1) * 1_000),
          }),
        ),
      ),
    );

    const versions = await db
      .select({ versionNo: documentVersions.versionNo })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(asc(documentVersions.versionNo));
    expect(versions.map((version) => version.versionNo)).toEqual([1, 2, 3, 4, 5]);
  });

  test("updates open-checkpoint media usages without releasing sealed history", async () => {
    const documentId = await createTestDocument("Version media usages");
    const startedAt = new Date("2026-07-13T11:00:00.000Z");
    const first = await materialize(
      documentId,
      [
        {
          type: "img",
          sourceKey: mediaIds[0],
          url: `/api/media/${mediaIds[0]}/raw`,
          children: [{ text: "" }],
        },
      ],
      startedAt,
    );
    const updated = await materialize(
      documentId,
      [
        {
          type: "img",
          sourceKey: mediaIds[1],
          url: `/api/media/${mediaIds[1]}/raw`,
          children: [{ text: "" }],
        },
      ],
      new Date(startedAt.getTime() + 60_000),
    );
    if (!first || !updated) throw new Error("Expected an open checkpoint");

    let usages = await db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.resourceType, "document_version"),
          eq(mediaUsages.resourceId, first.version.id),
        ),
      );
    expect(usages.find((usage) => usage.mediaId === mediaIds[0])?.deletedAt).not.toBeNull();
    expect(usages.find((usage) => usage.mediaId === mediaIds[1])?.deletedAt).toBeNull();
    expect(usages.find((usage) => usage.mediaId === mediaIds[1])?.metadata).toEqual({
      documentId,
      versionNo: 1,
    });

    await materialize(
      documentId,
      [{ type: "p", children: [{ text: "new checkpoint" }] }],
      new Date(startedAt.getTime() + 6 * 60_000),
    );
    usages = await db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.resourceType, "document_version"),
          eq(mediaUsages.resourceId, first.version.id),
        ),
      );
    expect(usages.find((usage) => usage.mediaId === mediaIds[1])?.deletedAt).not.toBeNull();
    const [sealedVersion] = await db
      .select({ revisionId: documentVersions.revisionId })
      .from(documentVersions)
      .where(eq(documentVersions.id, first.version.id));
    expect(sealedVersion?.revisionId).not.toBeNull();
    const revisionUsages = await db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.resourceType, "document_revision"),
          eq(mediaUsages.resourceId, sealedVersion!.revisionId!),
        ),
      );
    expect(revisionUsages.find((usage) => usage.mediaId === mediaIds[1])?.deletedAt).toBeNull();
  });
});
