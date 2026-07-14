// 提供文档活动时间线的隔离分页、revision 详情和统一正文恢复入口。
import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  createDocumentVersionRestoreOperationSchema,
  documentActivityDetailSchema,
  documentActivityDetailsSchema,
  documentActivityListResponseSchema,
  documentActivityStatusSchema,
  documentActivityTypeSchema,
  extractDocumentInlineMediaIds,
  hashDocumentVersionValue,
  projectDocumentVersionValue,
  type AuthContext,
  type CreateDocumentVersionRestoreOperation,
  type DocumentActivityListQuery,
} from "@sharebrain/contracts";
import {
  documentActivityEvents,
  documentEditSessions,
  documentRevisions,
  documents,
  mediaObjects,
  users,
} from "@sharebrain/db/schema";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { DocumentVersionsService } from "./document-versions.service";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";

type ActivityRow = Awaited<ReturnType<DocumentActivitiesService["findActivity"]>>;

function parseStoredActivityDetails(value: unknown) {
  const parsed = documentActivityDetailsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.kind === "restore") {
      return documentActivityDetailsSchema.parse({
        ...record,
        sourceKind: record.sourceKind === "activity" ? "activity" : "version",
        sourceVersionNo: record.sourceVersionNo ?? null,
        sourceActivityEventId: record.sourceActivityEventId ?? null,
      });
    }
  }
  return documentActivityDetailsSchema.parse(value);
}

export class DocumentActivitiesService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {}

  async list(
    auth: AuthContext,
    documentId: string,
    query: DocumentActivityListQuery,
  ) {
    this.assertHistoryEnabled();
    await this.ensureDocument(auth, documentId);

    const rows = await this.db
      .select({
        id: documentActivityEvents.id,
        sequence: documentActivityEvents.sequence,
        type: documentActivityEvents.type,
        status: documentActivityEvents.status,
        details: documentActivityEvents.details,
        startedAt: documentActivityEvents.startedAt,
        occurredAt: documentActivityEvents.occurredAt,
        beforeRevisionId: documentActivityEvents.beforeRevisionId,
        afterRevisionId: documentActivityEvents.afterRevisionId,
        sessionBeforeValue: documentEditSessions.beforeValue,
        sessionAfterValue: documentEditSessions.afterValue,
        actorId: users.id,
        actorName: users.displayName,
        actorAvatarMediaId: users.avatarMediaId,
      })
      .from(documentActivityEvents)
      .innerJoin(users, eq(documentActivityEvents.actorId, users.id))
      .leftJoin(
        documentEditSessions,
        eq(documentEditSessions.activityEventId, documentActivityEvents.id),
      )
      .where(
        and(
          eq(documentActivityEvents.tenantId, auth.tenantId),
          eq(documentActivityEvents.documentId, documentId),
          isNull(documentActivityEvents.deletedAt),
          query.cursor === undefined
            ? undefined
            : lt(documentActivityEvents.sequence, query.cursor),
        ),
      )
      .orderBy(desc(documentActivityEvents.sequence))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return documentActivityListResponseSchema.parse({
      items: page.map((row) => this.serializeItem(row)),
      nextCursor:
        hasMore && page.length > 0 ? String(page[page.length - 1]!.sequence) : null,
    });
  }

  async detail(auth: AuthContext, documentId: string, activityId: string) {
    this.assertHistoryEnabled();
    await this.ensureDocument(auth, documentId);
    const row = await this.findActivity(auth, documentId, activityId);
    if (!row) throw new ApiError("DOCUMENT_ACTIVITY_NOT_FOUND", "文档活动不存在。", 404);
    const item = this.serializeItem(row);

    let beforeValue: ReturnType<typeof projectDocumentVersionValue> | null = null;
    let afterValue: ReturnType<typeof projectDocumentVersionValue> | null = null;
    let beforeContentHash: string | null = null;
    let afterContentHash: string | null = null;
    let formatVersion: typeof DOCUMENT_VERSION_FORMAT_VERSION | null = null;

    if (item.inspectable && row.status === "open") {
      try {
        beforeValue = projectDocumentVersionValue(row.sessionBeforeValue);
        afterValue = projectDocumentVersionValue(row.sessionAfterValue);
        [beforeContentHash, afterContentHash] = await Promise.all([
          hashDocumentVersionValue(beforeValue),
          hashDocumentVersionValue(afterValue),
        ]);
        formatVersion = DOCUMENT_VERSION_FORMAT_VERSION;
      } catch {
        throw new ApiError("DOCUMENT_ACTIVITY_VALUE_INVALID", "活动正文无法读取。", 422);
      }
    } else if (item.inspectable && row.beforeRevisionId && row.afterRevisionId) {
      const revisions = await this.db
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.tenantId, auth.tenantId),
            eq(documentRevisions.documentId, documentId),
            inArray(documentRevisions.id, [row.beforeRevisionId, row.afterRevisionId]),
            isNull(documentRevisions.deletedAt),
          ),
        );
      const byId = new Map(revisions.map((revision) => [revision.id, revision]));
      const before = byId.get(row.beforeRevisionId);
      const after = byId.get(row.afterRevisionId);
      if (!before || !after || before.formatVersion !== 1 || after.formatVersion !== 1) {
        throw new ApiError("DOCUMENT_ACTIVITY_VALUE_INVALID", "活动 revision 无法读取。", 422);
      }
      try {
        beforeValue = projectDocumentVersionValue(before.plateJson);
        afterValue = projectDocumentVersionValue(after.plateJson);
      } catch {
        throw new ApiError("DOCUMENT_ACTIVITY_VALUE_INVALID", "活动正文无法读取。", 422);
      }
      beforeContentHash = before.contentHash;
      afterContentHash = after.contentHash;
      formatVersion = DOCUMENT_VERSION_FORMAT_VERSION;
    }

    return documentActivityDetailSchema.parse({
      ...item,
      beforeValue,
      afterValue,
      beforeContentHash,
      afterContentHash,
      formatVersion,
      unavailableMediaCount: afterValue
        ? await this.countUnavailableMedia(auth.tenantId, afterValue)
        : 0,
    });
  }

  async createRestoreOperation(
    auth: AuthContext,
    documentId: string,
    activityId: string,
    input: CreateDocumentVersionRestoreOperation,
  ) {
    const payload = createDocumentVersionRestoreOperationSchema.parse(input);
    const detail = await this.detail(auth, documentId, activityId);
    if (!detail.restorable) {
      throw new ApiError(
        "DOCUMENT_ACTIVITY_NOT_RESTORABLE",
        "只有已封存的正文编辑活动可以恢复。",
        409,
      );
    }
    const [event] = await this.db
      .select({ afterRevisionId: documentActivityEvents.afterRevisionId })
      .from(documentActivityEvents)
      .where(
        and(
          eq(documentActivityEvents.id, activityId),
          eq(documentActivityEvents.tenantId, auth.tenantId),
          eq(documentActivityEvents.documentId, documentId),
          eq(documentActivityEvents.type, "content_edited"),
          eq(documentActivityEvents.status, "sealed"),
          isNull(documentActivityEvents.deletedAt),
        ),
      )
      .limit(1);
    if (!event?.afterRevisionId) {
      throw new ApiError("DOCUMENT_ACTIVITY_NOT_RESTORABLE", "活动恢复节点不存在。", 409);
    }
    return new DocumentVersionsService(this.db, this.env).createRestoreOperationForSource(
      auth,
      documentId,
      {
        sourceKind: "activity",
        sourceRevisionId: event.afterRevisionId,
        sourceVersionId: null,
        sourceVersionNo: null,
        sourceActivityEventId: activityId,
        unavailableMediaCount: detail.unavailableMediaCount,
      },
      payload,
    );
  }

  private async findActivity(auth: AuthContext, documentId: string, activityId: string) {
    const [row] = await this.db
      .select({
        id: documentActivityEvents.id,
        sequence: documentActivityEvents.sequence,
        type: documentActivityEvents.type,
        status: documentActivityEvents.status,
        details: documentActivityEvents.details,
        startedAt: documentActivityEvents.startedAt,
        occurredAt: documentActivityEvents.occurredAt,
        beforeRevisionId: documentActivityEvents.beforeRevisionId,
        afterRevisionId: documentActivityEvents.afterRevisionId,
        sessionBeforeValue: documentEditSessions.beforeValue,
        sessionAfterValue: documentEditSessions.afterValue,
        actorId: users.id,
        actorName: users.displayName,
        actorAvatarMediaId: users.avatarMediaId,
      })
      .from(documentActivityEvents)
      .innerJoin(users, eq(documentActivityEvents.actorId, users.id))
      .leftJoin(
        documentEditSessions,
        eq(documentEditSessions.activityEventId, documentActivityEvents.id),
      )
      .where(
        and(
          eq(documentActivityEvents.id, activityId),
          eq(documentActivityEvents.tenantId, auth.tenantId),
          eq(documentActivityEvents.documentId, documentId),
          isNull(documentActivityEvents.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private serializeItem(row: NonNullable<ActivityRow>) {
    const type = documentActivityTypeSchema.parse(row.type);
    const status = documentActivityStatusSchema.parse(row.status);
    const hasRevisionPair = Boolean(row.beforeRevisionId && row.afterRevisionId);
    const hasSessionPair = Boolean(row.sessionBeforeValue && row.sessionAfterValue);
    const inspectable = type === "content_edited" && (hasRevisionPair || hasSessionPair);
    return {
      id: row.id,
      sequence: row.sequence,
      type,
      status,
      actor: {
        id: row.actorId,
        displayName: row.actorName,
        avatarUrl: row.actorAvatarMediaId
          ? `/api/media/${row.actorAvatarMediaId}/raw`
          : null,
      },
      startedAt: row.startedAt.toISOString(),
      occurredAt: row.occurredAt.toISOString(),
      details: parseStoredActivityDetails(row.details),
      inspectable,
      restorable: inspectable && status === "sealed" && hasRevisionPair,
    };
  }

  private async countUnavailableMedia(tenantId: string, value: unknown) {
    const mediaIds = extractDocumentInlineMediaIds(value);
    if (mediaIds.length === 0) return 0;
    const available = await this.db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.tenantId, tenantId),
          inArray(mediaObjects.id, mediaIds),
          eq(mediaObjects.status, "active"),
          isNull(mediaObjects.deletedAt),
        ),
      );
    return mediaIds.length - available.length;
  }

  private assertHistoryEnabled() {
    if (!this.env.DOCUMENT_ACTIVITY_HISTORY_ENABLED) {
      throw new ApiError("DOCUMENT_ACTIVITY_HISTORY_DISABLED", "文档活动历史尚未启用。", 404);
    }
  }

  private async ensureDocument(auth: AuthContext, documentId: string) {
    const [document] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!document) throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
    return document;
  }
}
