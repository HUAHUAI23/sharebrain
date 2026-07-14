// 将超过空闲阈值的正文编辑会话封存为不可变活动条目，并与正文写入复用 document 行锁。
import type { ServerEnv } from "@sharebrain/config";
import { sealDocumentEditSession, type DatabaseClient } from "@sharebrain/db";
import {
  documentActivityEvents,
  documentEditSessions,
  documents,
} from "@sharebrain/db/schema";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

export type DocumentActivityIdleSealResult = {
  enabled: boolean;
  cutoff: string | null;
  scanned: number;
  sealed: number;
  skipped: number;
  durationMs: number;
};

export async function runDocumentActivityIdleSeal(
  db: DatabaseClient,
  env: ServerEnv,
  options: { now?: Date; tenantId?: string } = {},
): Promise<DocumentActivityIdleSealResult> {
  const startedAt = performance.now();
  const now = options.now ?? new Date();
  if (
    !env.DOCUMENT_ACTIVITY_HISTORY_ENABLED ||
    env.DOCUMENT_ACTIVITY_IDLE_SEAL_SECONDS === 0
  ) {
    return complete({
      enabled: false,
      cutoff: null,
      scanned: 0,
      sealed: 0,
      skipped: 0,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  const cutoff = new Date(
    now.getTime() - env.DOCUMENT_ACTIVITY_IDLE_SEAL_SECONDS * 1000,
  );
  const candidates = await db
    .select({
      id: documentEditSessions.id,
      documentId: documentEditSessions.documentId,
    })
    .from(documentEditSessions)
    .innerJoin(documents, eq(documentEditSessions.documentId, documents.id))
    .where(activityIdleCondition(cutoff, options.tenantId))
    .orderBy(asc(documentEditSessions.lastChangedAt), asc(documentEditSessions.id))
    .limit(env.DOCUMENT_ACTIVITY_IDLE_SEAL_BATCH_SIZE);

  let sealed = 0;
  for (const candidate of candidates) {
    const didSeal = await sealIdleDocumentActivitySession(db, {
      ...candidate,
      cutoff,
      now,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    });
    if (didSeal) sealed += 1;
  }

  return complete({
    enabled: true,
    cutoff: cutoff.toISOString(),
    scanned: candidates.length,
    sealed,
    skipped: candidates.length - sealed,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

export async function sealIdleDocumentActivitySession(
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
        id: documentEditSessions.id,
        eventId: documentEditSessions.activityEventId,
        actorId: documentEditSessions.actorId,
        lastChangedAt: documentEditSessions.lastChangedAt,
      })
      .from(documentEditSessions)
      .innerJoin(documents, eq(documentEditSessions.documentId, documents.id))
      .innerJoin(
        documentActivityEvents,
        eq(documentEditSessions.activityEventId, documentActivityEvents.id),
      )
      .where(
        and(
          eq(documentEditSessions.id, input.id),
          eq(documentActivityEvents.status, "open"),
          activityIdleCondition(input.cutoff, input.tenantId),
        ),
      )
      .limit(1);
    if (!current) return false;

    await sealDocumentEditSession(tx, {
      sessionId: current.id,
      eventId: current.eventId,
      actorId: current.actorId,
      lastChangedAt: current.lastChangedAt,
      now: input.now,
    });
    return true;
  });
}

function activityIdleCondition(cutoff: Date, tenantId?: string) {
  return and(
    tenantId ? eq(documentEditSessions.tenantId, tenantId) : undefined,
    isNull(documentEditSessions.sealedAt),
    isNull(documentEditSessions.deletedAt),
    isNull(documents.deletedAt),
    lte(documentEditSessions.lastChangedAt, cutoff),
  );
}

function complete(result: DocumentActivityIdleSealResult) {
  console.info(JSON.stringify({ event: "document.activity.idle_seal_completed", ...result }));
  return result;
}
