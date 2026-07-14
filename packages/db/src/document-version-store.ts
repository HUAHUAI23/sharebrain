// 统一正文 checkpoint 的分配、封存、去重和历史媒体引用，供所有正文 writer 复用。
import { type DocumentRestoreSourceKind } from "@sharebrain/contracts";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import {
  materializeDocumentRevision,
  prepareDocumentRevisionValue,
} from "./document-revision-store";
import { syncInlineMediaUsagesWithClient } from "./media-usage-service";
import { documents, documentVersions } from "./schema";

export const DOCUMENT_VERSION_WINDOW_MS = 5 * 60 * 1000;

export type DocumentVersionStoreClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

type VersionInput = {
  tenantId: string;
  documentId: string;
  value: unknown;
  userId: string;
  now?: Date;
};

type RestoreVersionInput = VersionInput & {
  operationId: string;
  sourceKind: DocumentRestoreSourceKind;
  sourceRevisionId: string;
  sourceVersionId?: string | null;
  sourceVersionNo?: number | null;
  sourceActivityEventId?: string | null;
};

async function lockActiveDocument(
  db: DocumentVersionStoreClient,
  input: Pick<VersionInput, "documentId" | "tenantId">,
) {
  await db.execute(
    sql`select id from documents where id = ${input.documentId} and tenant_id = ${input.tenantId} and deleted_at is null for update`,
  );
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.tenantId, input.tenantId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  return document ?? null;
}

async function latestDocumentVersion(db: DocumentVersionStoreClient, documentId: string) {
  const [latest] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  return latest ?? null;
}

async function prepareVersionValue(value: unknown) {
  return prepareDocumentRevisionValue(value);
}

export async function syncVersionMediaUsages(
  db: DocumentVersionStoreClient,
  input: {
    tenantId: string;
    versionId: string;
    versionNo: number;
    documentId: string;
    mediaIds: string[];
    userId: string;
    now: Date;
  },
) {
  return syncInlineMediaUsagesWithClient(db, {
    tenantId: input.tenantId,
    resourceType: "document_version",
    resourceId: input.versionId,
    mediaIds: input.mediaIds,
    metadata: { documentId: input.documentId, versionNo: input.versionNo },
    userId: input.userId,
    now: input.now,
  });
}

async function sealVersionRecord(
  db: DocumentVersionStoreClient,
  input: Pick<VersionInput, "documentId" | "tenantId" | "userId"> & { now: Date },
  version: typeof documentVersions.$inferSelect,
) {
  if (version.sealedAt && version.revisionId) return version;
  const { revision } = await materializeDocumentRevision(db, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    value: version.plateJson,
    userId: input.userId,
    now: input.now,
  });
  const [sealed] = await db
    .update(documentVersions)
    .set({
      revisionId: revision.id,
      sealedAt: version.sealedAt ?? input.now,
      updatedBy: input.userId,
      updatedAt: input.now,
    })
    .where(eq(documentVersions.id, version.id))
    .returning();
  await syncVersionMediaUsages(db, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    versionId: version.id,
    versionNo: version.versionNo,
    mediaIds: [],
    userId: input.userId,
    now: input.now,
  });
  return sealed ?? version;
}

export async function materializeAutoVersion(db: DocumentVersionStoreClient, input: VersionInput) {
  const now = input.now ?? new Date();
  const prepared = await prepareVersionValue(input.value);
  const document = await lockActiveDocument(db, input);
  if (!document) return null;

  const latest = await latestDocumentVersion(db, input.documentId);
  if (latest && latest.contentHash === prepared.contentHash) {
    await db
      .update(documents)
      .set({ updatedBy: input.userId, updatedAt: now })
      .where(eq(documents.id, input.documentId));
    return { created: false, version: latest };
  }

  const canUpdateOpenVersion =
    latest?.kind === "auto" &&
    latest.sealedAt === null &&
    now.getTime() - latest.createdAt.getTime() < DOCUMENT_VERSION_WINDOW_MS;

  if (latest && canUpdateOpenVersion) {
    const [updated] = await db
      .update(documentVersions)
      .set({
        plateJson: prepared.projected,
        plainText: prepared.plainText,
        formatVersion: prepared.formatVersion,
        contentHash: prepared.contentHash,
        updatedBy: input.userId,
        updatedAt: now,
      })
      .where(and(eq(documentVersions.id, latest.id), isNull(documentVersions.sealedAt)))
      .returning();
    if (!updated) throw new Error("Open document version changed while it was locked");
    await syncVersionMediaUsages(db, {
      tenantId: input.tenantId,
      documentId: input.documentId,
      versionId: updated.id,
      versionNo: updated.versionNo,
      mediaIds: prepared.mediaIds,
      userId: input.userId,
      now,
    });
    await db
      .update(documents)
      .set({ updatedBy: input.userId, updatedAt: now })
      .where(eq(documents.id, input.documentId));
    return { created: false, version: updated };
  }

  if (latest?.sealedAt === null) {
    await sealVersionRecord(db, { ...input, now }, latest);
  }

  const nextVersionNo = (latest?.versionNo ?? 0) + 1;
  const [created] = await db
    .insert(documentVersions)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      versionNo: nextVersionNo,
      kind: "auto",
      formatVersion: prepared.formatVersion,
      contentHash: prepared.contentHash,
      plateJson: prepared.projected,
      markdown: "",
      plainText: prepared.plainText,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to create document version");

  await syncVersionMediaUsages(db, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    versionId: created.id,
    versionNo: created.versionNo,
    mediaIds: prepared.mediaIds,
    userId: input.userId,
    now,
  });
  await db
    .update(documents)
    .set({ currentVersion: nextVersionNo, updatedBy: input.userId, updatedAt: now })
    .where(eq(documents.id, input.documentId));
  return { created: true, version: created };
}

export async function sealCurrentVersion(
  db: DocumentVersionStoreClient,
  input: VersionInput,
) {
  const result = await materializeAutoVersion(db, input);
  if (!result) return null;
  const now = input.now ?? new Date();
  return sealVersionRecord(db, { ...input, now }, result.version);
}

export async function insertRestoreVersion(
  db: DocumentVersionStoreClient,
  input: RestoreVersionInput,
) {
  const validVersionSource =
    input.sourceKind === "version" &&
    Boolean(input.sourceVersionId) &&
    input.sourceVersionNo !== null &&
    input.sourceVersionNo !== undefined &&
    !input.sourceActivityEventId;
  const validActivitySource =
    input.sourceKind === "activity" &&
    !input.sourceVersionId &&
    (input.sourceVersionNo === null || input.sourceVersionNo === undefined) &&
    Boolean(input.sourceActivityEventId);
  if (!validVersionSource && !validActivitySource) {
    throw new Error("Restore document version source is invalid");
  }
  const now = input.now ?? new Date();
  const document = await lockActiveDocument(db, input);
  if (!document) return null;

  const [existing] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.operationId, input.operationId))
    .limit(1);
  if (existing) return existing;

  const prepared = await prepareVersionValue(input.value);
  const latest = await latestDocumentVersion(db, input.documentId);
  if (latest?.sealedAt === null) {
    await sealVersionRecord(db, { ...input, now }, latest);
  }
  const { revision } = await materializeDocumentRevision(db, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    value: prepared.projected,
    userId: input.userId,
    now,
  });
  if (revision.id !== input.sourceRevisionId) {
    throw new Error("Restore document version does not match its source revision");
  }
  const nextVersionNo = (latest?.versionNo ?? 0) + 1;
  const [created] = await db
    .insert(documentVersions)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      versionNo: nextVersionNo,
      kind: "restore",
      sealedAt: now,
      sourceVersionId: input.sourceVersionId ?? null,
      sourceVersionNo: input.sourceVersionNo ?? null,
      operationId: input.operationId,
      revisionId: revision.id,
      formatVersion: prepared.formatVersion,
      contentHash: prepared.contentHash,
      plateJson: prepared.projected,
      markdown: "",
      plainText: prepared.plainText,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to create restore document version");

  await db
    .update(documents)
    .set({ currentVersion: nextVersionNo, updatedBy: input.userId, updatedAt: now })
    .where(eq(documents.id, input.documentId));
  return created;
}
