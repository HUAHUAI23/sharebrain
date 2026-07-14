// 过期 sealed checkpoints，并在同一事务释放 chunks 与版本媒体引用；默认只 dry-run。
import type { ServerEnv } from "@sharebrain/config";
import {
  cleanupUnreferencedDocumentRevisions,
  type DatabaseClient,
} from "@sharebrain/db";
import {
  documentChunks,
  documentVersionOperations,
  documentVersions,
  documents,
  mediaUsages,
} from "@sharebrain/db/schema";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";

export type DocumentVersionRetentionResult = {
  dryRun: boolean;
  candidates: number;
  deleted: number;
  bytes: number;
  mediaUsages: number;
  expiredOperations: number;
};

export async function runDocumentVersionRetention(
  db: DatabaseClient,
  env: ServerEnv,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<DocumentVersionRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? env.DOCUMENT_VERSION_RETENTION_DRY_RUN;
  const expiredOperations = await expirePendingVersionOperations(db, now, dryRun);
  if (env.DOCUMENT_VERSION_RETENTION_DAYS === 0) {
    return { dryRun, candidates: 0, deleted: 0, bytes: 0, mediaUsages: 0, expiredOperations };
  }

  const cutoff = new Date(now.getTime() - env.DOCUMENT_VERSION_RETENTION_DAYS * 86_400_000);
  const candidates = await db
    .select({
      id: documentVersions.id,
      tenantId: documentVersions.tenantId,
      documentId: documentVersions.documentId,
      versionNo: documentVersions.versionNo,
      revisionId: documentVersions.revisionId,
      plateJson: documentVersions.plateJson,
      updatedBy: documentVersions.updatedBy,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .where(retentionCandidateCondition(cutoff))
    .orderBy(asc(documentVersions.sealedAt), asc(documentVersions.id))
    .limit(env.DOCUMENT_VERSION_RETENTION_BATCH_SIZE);

  let deleted = 0;
  let bytes = 0;
  let mediaUsageCount = 0;
  for (const candidate of candidates) {
    const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate.plateJson)).byteLength;
    if (dryRun) {
      bytes += candidateBytes;
      const usages = await db
        .select({ id: mediaUsages.id })
        .from(mediaUsages)
        .where(
          and(
            eq(mediaUsages.resourceType, "document_version"),
            eq(mediaUsages.resourceId, candidate.id),
            isNull(mediaUsages.deletedAt),
          ),
        );
      mediaUsageCount += usages.length;
      continue;
    }

    const removed = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from documents where id = ${candidate.documentId} for update`);
      await tx.execute(sql`select id from document_versions where id = ${candidate.id} for update`);
      const [current] = await tx
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .where(and(eq(documentVersions.id, candidate.id), retentionCandidateCondition(cutoff)))
        .limit(1);
      if (!current) return null;

      await tx
        .delete(documentChunks)
        .where(
          and(
            eq(documentChunks.documentId, candidate.documentId),
            eq(documentChunks.versionNo, candidate.versionNo),
          ),
        );
      const released = await tx
        .update(mediaUsages)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(mediaUsages.resourceType, "document_version"),
            eq(mediaUsages.resourceId, candidate.id),
            isNull(mediaUsages.deletedAt),
          ),
        )
        .returning({ id: mediaUsages.id });
      const [version] = await tx
        .delete(documentVersions)
        .where(eq(documentVersions.id, candidate.id))
        .returning({ id: documentVersions.id });
      if (!version) return null;
      const revisionCleanup = candidate.revisionId
        ? await cleanupUnreferencedDocumentRevisions(tx, {
            tenantId: candidate.tenantId,
            documentId: candidate.documentId,
            revisionIds: [candidate.revisionId],
            userId: candidate.updatedBy,
            now,
          })
        : { releasedMediaUsages: 0 };
      return released.length + revisionCleanup.releasedMediaUsages;
    });
    if (removed === null) continue;
    deleted += 1;
    bytes += candidateBytes;
    mediaUsageCount += removed;
  }

  const result = {
    dryRun,
    candidates: candidates.length,
    deleted,
    bytes,
    mediaUsages: mediaUsageCount,
    expiredOperations,
  };
  console.info(JSON.stringify({ event: "document.version.retention_completed", ...result }));
  return result;
}

function retentionCandidateCondition(cutoff: Date) {
  const cutoffIso = cutoff.toISOString();
  return and(
    isNotNull(documentVersions.sealedAt),
    lt(documentVersions.sealedAt, cutoff),
    isNull(documentVersions.deletedAt),
    ne(documentVersions.versionNo, documents.currentVersion),
    sql`not exists (
      select 1
      from document_version_operations op
      where op.deleted_at is null
        and (op.status in ('pending', 'applying') or op.created_at >= ${cutoffIso}::timestamptz)
        and (
          op.source_version_id = ${documentVersions.id}
          or op.before_version_id = ${documentVersions.id}
          or op.result_version_id = ${documentVersions.id}
        )
    )`,
  );
}

async function expirePendingVersionOperations(db: DatabaseClient, now: Date, dryRun: boolean) {
  const condition = and(
    eq(documentVersionOperations.status, "pending"),
    lte(documentVersionOperations.expiresAt, now),
    isNull(documentVersionOperations.deletedAt),
  );
  if (dryRun) {
    const rows = await db
      .select({ id: documentVersionOperations.id })
      .from(documentVersionOperations)
      .where(condition)
      .limit(1000);
    return rows.length;
  }
  const rows = await db
    .update(documentVersionOperations)
    .set({ status: "expired", errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED", updatedAt: now })
    .where(condition)
    .returning({ id: documentVersionOperations.id });
  return rows.length;
}
