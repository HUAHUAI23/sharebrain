// 将停止编辑后的 current open checkpoint 封存为最终历史，并与正文保存复用 document 行锁。
import type { ServerEnv } from "@sharebrain/config";
import { sealCurrentVersion, type DatabaseClient } from "@sharebrain/db";
import { documentVersions, documents } from "@sharebrain/db/schema";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

export type DocumentVersionIdleSealResult = {
  enabled: boolean;
  cutoff: string | null;
  scanned: number;
  sealed: number;
  skipped: number;
  durationMs: number;
};

export async function runDocumentVersionIdleSeal(
  db: DatabaseClient,
  env: ServerEnv,
  options: { now?: Date; tenantId?: string } = {},
): Promise<DocumentVersionIdleSealResult> {
  const startedAt = performance.now();
  const now = options.now ?? new Date();
  if (env.DOCUMENT_VERSION_IDLE_SEAL_SECONDS === 0) {
    return completeIdleSealRun({
      enabled: false,
      cutoff: null,
      scanned: 0,
      sealed: 0,
      skipped: 0,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  const cutoff = new Date(
    now.getTime() - env.DOCUMENT_VERSION_IDLE_SEAL_SECONDS * 1000,
  );
  const candidates = await db
    .select({ id: documentVersions.id, documentId: documentVersions.documentId })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .where(idleSealCandidateCondition(cutoff, options.tenantId))
    .orderBy(asc(documentVersions.updatedAt), asc(documentVersions.id))
    .limit(env.DOCUMENT_VERSION_IDLE_SEAL_BATCH_SIZE);

  let sealed = 0;
  for (const candidate of candidates) {
    const didSeal = await sealIdleDocumentVersionCandidate(db, {
      ...candidate,
      cutoff,
      now,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    });
    if (didSeal) sealed += 1;
  }

  return completeIdleSealRun({
    enabled: true,
    cutoff: cutoff.toISOString(),
    scanned: candidates.length,
    sealed,
    skipped: candidates.length - sealed,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

export async function sealIdleDocumentVersionCandidate(
  db: DatabaseClient,
  input: {
    id: string;
    documentId: string;
    cutoff: Date;
    now: Date;
    tenantId?: string;
  },
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from documents where id = ${input.documentId} and deleted_at is null for update`,
    );
    const [current] = await tx
      .select({
        id: documentVersions.id,
        tenantId: documentVersions.tenantId,
        documentId: documentVersions.documentId,
        plateJson: documentVersions.plateJson,
        updatedBy: documentVersions.updatedBy,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(
        and(
          eq(documentVersions.id, input.id),
          idleSealCandidateCondition(input.cutoff, input.tenantId),
        ),
      )
      .limit(1);
    if (!current) return false;

    const sealed = await sealCurrentVersion(tx, {
      tenantId: current.tenantId,
      documentId: current.documentId,
      value: current.plateJson,
      userId: current.updatedBy,
      now: input.now,
    });
    return sealed?.id === current.id && sealed.sealedAt !== null;
  });
}

function idleSealCandidateCondition(cutoff: Date, tenantId?: string) {
  return and(
    tenantId ? eq(documentVersions.tenantId, tenantId) : undefined,
    eq(documentVersions.kind, "auto"),
    isNull(documentVersions.sealedAt),
    isNull(documentVersions.deletedAt),
    isNull(documents.deletedAt),
    eq(documentVersions.versionNo, documents.currentVersion),
    lte(documentVersions.updatedAt, cutoff),
  );
}

function completeIdleSealRun(result: DocumentVersionIdleSealResult) {
  console.info(JSON.stringify({ event: "document.version.idle_seal_completed", ...result }));
  return result;
}
