// 统一不可变正文 revision 的投影、内容寻址、媒体引用和无引用清理。
import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  extractDocumentInlineMediaIds,
  hashDocumentVersionValue,
  projectDocumentVersionValue,
} from "@sharebrain/contracts";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { syncInlineMediaUsagesWithClient } from "./media-usage-service";
import {
  documentActivityEvents,
  documentRevisions,
  documentVersionOperations,
  documentVersions,
  mediaUsages,
} from "./schema";

export type DocumentRevisionStoreClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

export type MaterializeDocumentRevisionInput = {
  tenantId: string;
  documentId: string;
  value: unknown;
  userId: string;
  now?: Date;
};

function extractPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractPlainText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const childText = extractPlainText(record.children);
  return [ownText, childText].filter(Boolean).join("");
}

export async function prepareDocumentRevisionValue(value: unknown) {
  const projected = projectDocumentVersionValue(value);
  return {
    contentHash: await hashDocumentVersionValue(projected),
    formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
    mediaIds: extractDocumentInlineMediaIds(projected),
    plainText: extractPlainText(projected),
    projected,
  };
}

export async function materializeDocumentRevision(
  db: DocumentRevisionStoreClient,
  input: MaterializeDocumentRevisionInput,
) {
  const now = input.now ?? new Date();
  const prepared = await prepareDocumentRevisionValue(input.value);
  const [created] = await db
    .insert(documentRevisions)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      formatVersion: prepared.formatVersion,
      contentHash: prepared.contentHash,
      plateJson: prepared.projected,
      plainText: prepared.plainText,
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        documentRevisions.documentId,
        documentRevisions.formatVersion,
        documentRevisions.contentHash,
      ],
    })
    .returning();

  const revision = created ?? (await db
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.tenantId, input.tenantId),
        eq(documentRevisions.documentId, input.documentId),
        eq(documentRevisions.formatVersion, prepared.formatVersion),
        eq(documentRevisions.contentHash, prepared.contentHash),
        isNull(documentRevisions.deletedAt),
      ),
    )
    .limit(1))[0];
  if (!revision) throw new Error("Failed to materialize document revision");

  await syncInlineMediaUsagesWithClient(db, {
    tenantId: input.tenantId,
    resourceType: "document_revision",
    resourceId: revision.id,
    mediaIds: prepared.mediaIds,
    metadata: {
      documentId: input.documentId,
      contentHash: revision.contentHash,
      formatVersion: revision.formatVersion,
    },
    userId: input.userId,
    now,
  });
  return { created: Boolean(created), revision };
}

export async function cleanupUnreferencedDocumentRevisions(
  db: DocumentRevisionStoreClient,
  input: {
    tenantId: string;
    documentId: string;
    revisionIds?: string[];
    userId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await db.execute(
    sql`select id from documents where id = ${input.documentId} and tenant_id = ${input.tenantId} for update`,
  );

  const conditions = [
    eq(documentRevisions.tenantId, input.tenantId),
    eq(documentRevisions.documentId, input.documentId),
    isNull(documentRevisions.deletedAt),
    notExists(
      db
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .where(eq(documentVersions.revisionId, documentRevisions.id)),
    ),
    notExists(
      db
        .select({ id: documentActivityEvents.id })
        .from(documentActivityEvents)
        .where(
          sql`${documentActivityEvents.beforeRevisionId} = ${documentRevisions.id} or ${documentActivityEvents.afterRevisionId} = ${documentRevisions.id}`,
        ),
    ),
    notExists(
      db
        .select({ id: documentVersionOperations.id })
        .from(documentVersionOperations)
        .where(eq(documentVersionOperations.sourceRevisionId, documentRevisions.id)),
    ),
  ];
  if (input.revisionIds) {
    if (input.revisionIds.length === 0) return { deletedRevisions: 0, releasedMediaUsages: 0 };
    conditions.push(inArray(documentRevisions.id, [...new Set(input.revisionIds)]));
  }

  const candidates = await db
    .select({ id: documentRevisions.id })
    .from(documentRevisions)
    .where(and(...conditions));
  if (candidates.length === 0) return { deletedRevisions: 0, releasedMediaUsages: 0 };
  const revisionIds = candidates.map((candidate) => candidate.id);
  const released = await db
    .update(mediaUsages)
    .set({ deletedAt: now, updatedBy: input.userId, updatedAt: now })
    .where(
      and(
        eq(mediaUsages.tenantId, input.tenantId),
        eq(mediaUsages.resourceType, "document_revision"),
        inArray(mediaUsages.resourceId, revisionIds),
        isNull(mediaUsages.deletedAt),
      ),
    )
    .returning({ id: mediaUsages.id });
  const deleted = await db
    .delete(documentRevisions)
    .where(and(eq(documentRevisions.documentId, input.documentId), inArray(documentRevisions.id, revisionIds)))
    .returning({ id: documentRevisions.id });
  return { deletedRevisions: deleted.length, releasedMediaUsages: released.length };
}
