// 统一文档活动事件的幂等写入、正文编辑会话聚合和封存，供 API、Collab 与 Worker 复用。
import {
  type DocumentActivityDetails,
  type DocumentActivityType,
  type DocumentContentActivityDetails,
  DOCUMENT_ACTIVITY_LIMITS,
  documentActivityDetailsSchema,
  documentContentActivityDetailsSchema,
  mergeDocumentContentActivityDetails,
  projectDocumentVersionValue,
} from "@sharebrain/contracts";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { materializeDocumentRevision } from "./document-revision-store";
import {
  documentActivityEvents,
  documentEditSessions,
  documents,
} from "./schema";

export const DOCUMENT_ACTIVITY_SESSION_IDLE_MS = 120 * 1000;
export const DOCUMENT_ACTIVITY_SESSION_MAX_MS = 30 * 60 * 1000;
const MAX_PROCESSED_SOURCE_KEYS = 1000;

export type DocumentActivityStoreClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

type ActivityOwnerInput = {
  tenantId: string;
  documentId: string;
  actorId: string;
  now?: Date;
};

type RecordContentActivityInput = ActivityOwnerInput & {
  sourceKey: string;
  details: DocumentContentActivityDetails;
  beforeValue: unknown;
  afterValue: unknown;
  startedAt?: Date;
};

type RecordStandaloneActivityInput = ActivityOwnerInput & {
  type: Exclude<DocumentActivityType, "content_edited">;
  sourceKey: string;
  details: DocumentActivityDetails;
  occurredAt?: Date;
};

function assertSourceKey(sourceKey: string) {
  if (
    sourceKey.length === 0 ||
    sourceKey.length > DOCUMENT_ACTIVITY_LIMITS.sourceKeyCharacters
  ) {
    throw new Error("Document activity source key is invalid");
  }
}

async function lockActiveDocument(
  db: DocumentActivityStoreClient,
  input: Pick<ActivityOwnerInput, "documentId" | "tenantId">,
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

function detailsKindForType(type: RecordStandaloneActivityInput["type"]) {
  switch (type) {
    case "document_created":
      return "document_created";
    case "title_edited":
      return "title";
    case "version_restored":
      return "restore";
    default:
      return "comment";
  }
}

export async function recordStandaloneDocumentActivity(
  db: DocumentActivityStoreClient,
  input: RecordStandaloneActivityInput,
) {
  const now = input.now ?? new Date();
  assertSourceKey(input.sourceKey);
  const occurredAt = input.occurredAt ?? now;
  const details = documentActivityDetailsSchema.parse(input.details);
  if (details.kind !== detailsKindForType(input.type)) {
    throw new Error(`Activity type ${input.type} does not match details ${details.kind}`);
  }
  const document = await lockActiveDocument(db, input);
  if (!document) return null;
  const [existing] = await db
    .select()
    .from(documentActivityEvents)
    .where(
      and(
        eq(documentActivityEvents.documentId, input.documentId),
        eq(documentActivityEvents.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);
  if (existing) return existing;
  await sealOtherActorSessions(db, input, now);

  const [created] = await db
    .insert(documentActivityEvents)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      actorId: input.actorId,
      type: input.type,
      status: "sealed",
      sourceKey: input.sourceKey,
      details,
      startedAt: occurredAt,
      occurredAt,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [documentActivityEvents.documentId, documentActivityEvents.sourceKey],
    })
    .returning();
  if (created) return created;

  const [conflicting] = await db
    .select()
    .from(documentActivityEvents)
    .where(
      and(
        eq(documentActivityEvents.documentId, input.documentId),
        eq(documentActivityEvents.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);
  return conflicting ?? null;
}

async function findOpenSession(
  db: DocumentActivityStoreClient,
  input: Pick<ActivityOwnerInput, "actorId" | "documentId">,
) {
  const [row] = await db
    .select({
      session: documentEditSessions,
      event: documentActivityEvents,
    })
    .from(documentEditSessions)
    .innerJoin(
      documentActivityEvents,
      eq(documentEditSessions.activityEventId, documentActivityEvents.id),
    )
    .where(
      and(
        eq(documentEditSessions.documentId, input.documentId),
        eq(documentEditSessions.actorId, input.actorId),
        isNull(documentEditSessions.sealedAt),
        isNull(documentEditSessions.deletedAt),
        isNull(documentActivityEvents.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function sealDocumentEditSession(
  db: DocumentActivityStoreClient,
  input: {
    sessionId: string;
    eventId: string;
    actorId: string;
    lastChangedAt: Date;
    now: Date;
  },
) {
  const [current] = await db
    .select()
    .from(documentEditSessions)
    .where(
      and(
        eq(documentEditSessions.id, input.sessionId),
        eq(documentEditSessions.activityEventId, input.eventId),
        isNull(documentEditSessions.sealedAt),
      ),
    )
    .limit(1);
  if (!current) return false;

  let beforeRevisionId: string | null = null;
  let afterRevisionId: string | null = null;
  if (current.beforeValue && current.afterValue) {
    const before = await materializeDocumentRevision(db, {
      tenantId: current.tenantId,
      documentId: current.documentId,
      value: current.beforeValue,
      userId: input.actorId,
      now: input.now,
    });
    const after = await materializeDocumentRevision(db, {
      tenantId: current.tenantId,
      documentId: current.documentId,
      value: current.afterValue,
      userId: input.actorId,
      now: input.now,
    });
    beforeRevisionId = before.revision.id;
    afterRevisionId = after.revision.id;
  }

  await db
    .update(documentEditSessions)
    .set({
      sealedAt: input.now,
      beforeValue: null,
      afterValue: null,
      updatedBy: input.actorId,
      updatedAt: input.now,
    })
    .where(and(eq(documentEditSessions.id, input.sessionId), isNull(documentEditSessions.sealedAt)));
  await db
    .update(documentActivityEvents)
    .set({
      status: "sealed",
      beforeRevisionId,
      afterRevisionId,
      occurredAt: input.lastChangedAt,
      updatedBy: input.actorId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(documentActivityEvents.id, input.eventId),
        eq(documentActivityEvents.status, "open"),
      ),
    );
  return true;
}

async function sealOtherActorSessions(
  db: DocumentActivityStoreClient,
  input: ActivityOwnerInput,
  now: Date,
) {
  const sessions = await db
    .select({
      id: documentEditSessions.id,
      eventId: documentEditSessions.activityEventId,
      actorId: documentEditSessions.actorId,
      lastChangedAt: documentEditSessions.lastChangedAt,
    })
    .from(documentEditSessions)
    .where(
      and(
        eq(documentEditSessions.documentId, input.documentId),
        ne(documentEditSessions.actorId, input.actorId),
        isNull(documentEditSessions.sealedAt),
        isNull(documentEditSessions.deletedAt),
      ),
    );
  for (const session of sessions) {
    await sealDocumentEditSession(db, {
      sessionId: session.id,
      eventId: session.eventId,
      actorId: session.actorId,
      lastChangedAt: session.lastChangedAt,
      now,
    });
  }
}

function sessionExpired(
  session: { startedAt: Date; lastChangedAt: Date },
  now: Date,
) {
  return (
    now.getTime() - session.lastChangedAt.getTime() >= DOCUMENT_ACTIVITY_SESSION_IDLE_MS ||
    now.getTime() - session.startedAt.getTime() >= DOCUMENT_ACTIVITY_SESSION_MAX_MS
  );
}

async function createContentSession(
  db: DocumentActivityStoreClient,
  input: RecordContentActivityInput,
  now: Date,
) {
  const sessionId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const startedAt = input.startedAt ?? now;
  const [event] = await db
    .insert(documentActivityEvents)
    .values({
      id: eventId,
      tenantId: input.tenantId,
      documentId: input.documentId,
      actorId: input.actorId,
      sessionId,
      type: "content_edited",
      status: "open",
      sourceKey: `content:${sessionId}`,
      details: input.details,
      startedAt,
      occurredAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!event) throw new Error("Failed to create document content activity event");

  const [session] = await db
    .insert(documentEditSessions)
    .values({
      id: sessionId,
      tenantId: input.tenantId,
      documentId: input.documentId,
      actorId: input.actorId,
      activityEventId: eventId,
      startedAt,
      lastChangedAt: now,
      changeCount: 1,
      processedSourceKeys: [input.sourceKey],
      beforeValue: projectDocumentVersionValue(input.beforeValue),
      afterValue: projectDocumentVersionValue(input.afterValue),
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!session) throw new Error("Failed to create document edit session");
  return { event, session };
}

export async function recordDocumentContentActivity(
  db: DocumentActivityStoreClient,
  input: RecordContentActivityInput,
) {
  if (input.details.changes.length === 0) return null;
  assertSourceKey(input.sourceKey);
  const now = input.now ?? new Date();
  const details = documentContentActivityDetailsSchema.parse(input.details);
  const document = await lockActiveDocument(db, input);
  if (!document) return null;
  await sealOtherActorSessions(db, input, now);

  let current = await findOpenSession(db, input);
  if (current?.session.processedSourceKeys.includes(input.sourceKey)) return current;
  if (current && sessionExpired(current.session, now)) {
    await sealDocumentEditSession(db, {
      sessionId: current.session.id,
      eventId: current.event.id,
      actorId: current.session.actorId,
      lastChangedAt: current.session.lastChangedAt,
      now,
    });
    current = null;
  }
  if (!current) return createContentSession(db, { ...input, details }, now);

  const merged = mergeDocumentContentActivityDetails(
    documentContentActivityDetailsSchema.parse(current.event.details),
    details,
  );
  if (merged.changes.length === 0 && !merged.truncated) {
    await db.delete(documentEditSessions).where(eq(documentEditSessions.id, current.session.id));
    await db.delete(documentActivityEvents).where(eq(documentActivityEvents.id, current.event.id));
    return null;
  }

  const processedSourceKeys = [
    ...current.session.processedSourceKeys,
    input.sourceKey,
  ].slice(-MAX_PROCESSED_SOURCE_KEYS);
  const [event] = await db
    .update(documentActivityEvents)
    .set({
      sequence: sql`nextval(pg_get_serial_sequence('document_activity_events', 'sequence'))`,
      details: merged,
      occurredAt: now,
      updatedBy: input.actorId,
      updatedAt: now,
    })
    .where(and(eq(documentActivityEvents.id, current.event.id), eq(documentActivityEvents.status, "open")))
    .returning();
  const [session] = await db
    .update(documentEditSessions)
    .set({
      lastChangedAt: now,
      changeCount: current.session.changeCount + 1,
      processedSourceKeys,
      afterValue: projectDocumentVersionValue(input.afterValue),
      updatedBy: input.actorId,
      updatedAt: now,
    })
    .where(and(eq(documentEditSessions.id, current.session.id), isNull(documentEditSessions.sealedAt)))
    .returning();
  if (!event || !session) throw new Error("Open document edit session changed while locked");
  return { event, session };
}
