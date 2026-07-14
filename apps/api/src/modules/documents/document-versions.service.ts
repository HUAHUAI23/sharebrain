// 提供 sealed 正文版本的租户隔离查询、稳定分页、详情投影和媒体可用性检查。
import {
  createDocumentVersionRestoreOperationSchema,
  decodeDocumentVersionCursor,
  documentVersionListResponseSchema,
  encodeDocumentVersionCursor,
  extractDocumentInlineMediaIds,
  projectDocumentVersionValue,
  type AuthContext,
  type DocumentVersionListQuery,
  type CreateDocumentVersionRestoreOperation,
  type DocumentRestoreSourceKind,
} from "@sharebrain/contracts";
import {
  auditLogs,
  documentRevisions,
  documentVersionOperations,
  documentVersions,
  documents,
  mediaObjects,
  users,
} from "@sharebrain/db/schema";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";

import { ApiError } from "../../app/api-error";

import type { ServerEnv } from "@sharebrain/config";
import { materializeDocumentRevision, type DatabaseClient } from "@sharebrain/db";

export type DocumentRestoreOperationSource = {
  sourceKind: DocumentRestoreSourceKind;
  sourceRevisionId: string;
  sourceVersionId: string | null;
  sourceVersionNo: number | null;
  sourceActivityEventId: string | null;
  unavailableMediaCount: number;
};

export class DocumentVersionsService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {}

  async list(auth: AuthContext, documentId: string, query: DocumentVersionListQuery) {
    this.assertHistoryEnabled();
    await this.ensureDocument(auth, documentId);

    let beforeVersionNo: number | undefined;
    if (query.cursor) {
      try {
        beforeVersionNo = decodeDocumentVersionCursor(query.cursor);
      } catch {
        throw new ApiError("DOCUMENT_VERSION_CURSOR_INVALID", "版本分页游标无效。", 400);
      }
    }

    const rows = await this.db
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        kind: documentVersions.kind,
        sourceVersionNo: documentVersions.sourceVersionNo,
        changeSummary: documentVersions.changeSummary,
        sealedAt: documentVersions.sealedAt,
        updatedAt: documentVersions.updatedAt,
        editorId: users.id,
        editorName: users.displayName,
        editorAvatarMediaId: users.avatarMediaId,
      })
      .from(documentVersions)
      .innerJoin(users, eq(documentVersions.updatedBy, users.id))
      .where(
        and(
          eq(documentVersions.tenantId, auth.tenantId),
          eq(documentVersions.documentId, documentId),
          isNotNull(documentVersions.sealedAt),
          isNull(documentVersions.deletedAt),
          beforeVersionNo === undefined ? undefined : lt(documentVersions.versionNo, beforeVersionNo),
        ),
      )
      .orderBy(desc(documentVersions.versionNo))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return documentVersionListResponseSchema.parse({
      items: page.map((row) => this.serializeSummary(row)),
      nextCursor:
        hasMore && page.length > 0
          ? encodeDocumentVersionCursor(page[page.length - 1]!.versionNo)
          : null,
    });
  }

  async detail(auth: AuthContext, documentId: string, versionId: string) {
    this.assertHistoryEnabled();
    await this.ensureDocument(auth, documentId);
    const [row] = await this.db
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        kind: documentVersions.kind,
        sourceVersionNo: documentVersions.sourceVersionNo,
        changeSummary: documentVersions.changeSummary,
        sealedAt: documentVersions.sealedAt,
        updatedAt: documentVersions.updatedAt,
        revisionId: documentVersions.revisionId,
        plateJson: documentVersions.plateJson,
        formatVersion: documentVersions.formatVersion,
        contentHash: documentVersions.contentHash,
        editorId: users.id,
        editorName: users.displayName,
        editorAvatarMediaId: users.avatarMediaId,
      })
      .from(documentVersions)
      .innerJoin(users, eq(documentVersions.updatedBy, users.id))
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.tenantId, auth.tenantId),
          isNotNull(documentVersions.sealedAt),
          isNull(documentVersions.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new ApiError("DOCUMENT_VERSION_NOT_FOUND", "正文版本不存在。", 404);
    const stored = await this.readVersionValue(auth, row);
    const [previous] = await this.db
      .select({
        versionNo: documentVersions.versionNo,
        revisionId: documentVersions.revisionId,
        plateJson: documentVersions.plateJson,
        formatVersion: documentVersions.formatVersion,
        contentHash: documentVersions.contentHash,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.tenantId, auth.tenantId),
          eq(documentVersions.documentId, documentId),
          lt(documentVersions.versionNo, row.versionNo),
          isNotNull(documentVersions.sealedAt),
          isNull(documentVersions.deletedAt),
        ),
      )
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);
    const previousValue = previous
      ? (await this.readVersionValue(auth, previous)).value
      : [];
    const unavailableMediaCount = await this.countUnavailableMedia(auth.tenantId, stored.value);

    return {
      ...this.serializeSummary(row),
      value: stored.value,
      previousValue,
      previousVersionNo: previous?.versionNo ?? null,
      contentHash: stored.contentHash,
      formatVersion: 1 as const,
      unavailableMediaCount,
    };
  }

  async createRestoreOperation(
    auth: AuthContext,
    documentId: string,
    versionId: string,
    input: CreateDocumentVersionRestoreOperation,
  ) {
    this.assertRestoreEnabled(auth);
    const detail = await this.detail(auth, documentId, versionId);
    const sourceRevisionId = await this.ensureVersionRevision(auth, documentId, versionId);
    return this.createRestoreOperationForSource(
      auth,
      documentId,
      {
        sourceKind: "version",
        sourceRevisionId,
        sourceVersionId: versionId,
        sourceVersionNo: detail.versionNo,
        sourceActivityEventId: null,
        unavailableMediaCount: detail.unavailableMediaCount,
      },
      input,
    );
  }

  async createRestoreOperationForSource(
    auth: AuthContext,
    documentId: string,
    source: DocumentRestoreOperationSource,
    input: CreateDocumentVersionRestoreOperation,
  ) {
    this.assertRestoreEnabled(auth);
    await this.ensureDocument(auth, documentId);
    this.assertRestoreSource(source);
    const [revision] = await this.db
      .select({ id: documentRevisions.id, formatVersion: documentRevisions.formatVersion })
      .from(documentRevisions)
      .where(
        and(
          eq(documentRevisions.id, source.sourceRevisionId),
          eq(documentRevisions.tenantId, auth.tenantId),
          eq(documentRevisions.documentId, documentId),
          isNull(documentRevisions.deletedAt),
        ),
      )
      .limit(1);
    if (!revision || revision.formatVersion !== 1) {
      throw new ApiError("DOCUMENT_VERSION_VALUE_INVALID", "历史节点正文无法读取。", 422);
    }
    const payload = createDocumentVersionRestoreOperationSchema.parse(input);
    const now = new Date();
    await this.expirePendingOperations(auth, documentId, now);
    const baseStateVectorHash = await this.hashStateVector(payload.baseStateVector);
    const existing = await this.findOperationByRequest(auth, documentId, payload.requestId);
    if (existing) {
      this.assertMatchingRequest(existing, source, baseStateVectorHash, payload.force);
      return this.serializeOperation(existing);
    }
    if (source.unavailableMediaCount > 0) {
      throw new ApiError(
        "DOCUMENT_VERSION_MEDIA_UNAVAILABLE",
        "该历史节点包含不可用媒体，无法安全恢复。",
        409,
        { unavailableMediaCount: source.unavailableMediaCount },
      );
    }
    const [active] = await this.db
      .select()
      .from(documentVersionOperations)
      .where(
        and(
          eq(documentVersionOperations.documentId, documentId),
          inArray(documentVersionOperations.status, ["pending", "applying"]),
          isNull(documentVersionOperations.deletedAt),
        ),
      )
      .limit(1);
    if (active) {
      if (
        active.tenantId === auth.tenantId &&
        active.createdBy === auth.userId &&
        active.requestId === payload.requestId
      ) {
        this.assertMatchingRequest(active, source, baseStateVectorHash, payload.force);
        return this.serializeOperation(active);
      }
      throw new ApiError("DOCUMENT_VERSION_OPERATION_ACTIVE", "该文档已有恢复操作正在执行。", 409);
    }

    const since = new Date(now.getTime() - 60_000);
    const recent = await this.db
      .select({ id: documentVersionOperations.id })
      .from(documentVersionOperations)
      .where(
        and(
          eq(documentVersionOperations.tenantId, auth.tenantId),
          eq(documentVersionOperations.documentId, documentId),
          eq(documentVersionOperations.createdBy, auth.userId),
          gt(documentVersionOperations.createdAt, since),
          isNull(documentVersionOperations.deletedAt),
        ),
      )
      .limit(5);
    if (recent.length >= 5) {
      throw new ApiError("DOCUMENT_VERSION_RATE_LIMITED", "恢复操作过于频繁，请稍后再试。", 429);
    }

    const expiresAt = new Date(now.getTime() + this.env.DOCUMENT_VERSION_OPERATION_EXPIRES_SECONDS * 1000);
    try {
      const operation = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from documents where id = ${documentId} and tenant_id = ${auth.tenantId} and deleted_at is null for update`,
        );
        const [created] = await tx
          .insert(documentVersionOperations)
          .values({
            tenantId: auth.tenantId,
            documentId,
            requestId: payload.requestId,
            sourceKind: source.sourceKind,
            sourceRevisionId: source.sourceRevisionId,
            sourceVersionId: source.sourceVersionId,
            sourceVersionNo: source.sourceVersionNo,
            sourceActivityEventId: source.sourceActivityEventId,
            status: "pending",
            baseStateVectorHash,
            force: payload.force,
            expiresAt,
            createdBy: auth.userId,
            updatedBy: auth.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) throw new Error("Failed to create restore operation");
        await tx.insert(auditLogs).values({
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: payload.force
            ? "document.version.restore_forced"
            : "document.version.restore_requested",
          resourceType: "document_version_operation",
          resourceId: created.id,
          documentId,
          metadata: {
            sourceKind: source.sourceKind,
            sourceVersionNo: source.sourceVersionNo,
            sourceActivityEventId: source.sourceActivityEventId,
            force: payload.force,
            requestId: payload.requestId,
          },
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        });
        return created;
      });
      console.info(
        JSON.stringify({
          event: "document.version.restore_requested",
          tenantId: auth.tenantId,
          documentId,
          operationId: operation.id,
          sourceVersionNo: operation.sourceVersionNo,
          force: operation.force,
        }),
      );
      return this.serializeOperation(operation);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const concurrent = await this.findOperationByRequest(
          auth,
          documentId,
          payload.requestId,
        );
        if (concurrent) {
          this.assertMatchingRequest(
            concurrent,
            source,
            baseStateVectorHash,
            payload.force,
          );
          return this.serializeOperation(concurrent);
        }
        throw new ApiError("DOCUMENT_VERSION_OPERATION_ACTIVE", "该文档已有恢复操作正在执行。", 409);
      }
      throw error;
    }
  }

  async getOperation(auth: AuthContext, documentId: string, operationId: string) {
    this.assertHistoryEnabled();
    await this.ensureDocument(auth, documentId);
    const visibility =
      auth.role === "admin"
        ? undefined
        : eq(documentVersionOperations.createdBy, auth.userId);
    const [operation] = await this.db
      .select()
      .from(documentVersionOperations)
      .where(
        and(
          eq(documentVersionOperations.id, operationId),
          eq(documentVersionOperations.tenantId, auth.tenantId),
          eq(documentVersionOperations.documentId, documentId),
          visibility,
          isNull(documentVersionOperations.deletedAt),
        ),
      )
      .limit(1);
    if (!operation) {
      throw new ApiError("DOCUMENT_VERSION_OPERATION_NOT_FOUND", "恢复操作不存在。", 404);
    }
    if (operation.status === "pending" && operation.expiresAt.getTime() <= Date.now()) {
      const now = new Date();
      const [expired] = await this.db
        .update(documentVersionOperations)
        .set({
          status: "expired",
          errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
          updatedBy: operation.createdBy,
          updatedAt: now,
        })
        .where(
          and(
            eq(documentVersionOperations.id, operation.id),
            eq(documentVersionOperations.status, "pending"),
            lte(documentVersionOperations.expiresAt, now),
          ),
        )
        .returning();
      return this.serializeOperation(expired ?? operation);
    }
    return this.serializeOperation(operation);
  }

  private async expirePendingOperations(auth: AuthContext, documentId: string, now: Date) {
    await this.db
      .update(documentVersionOperations)
      .set({
        status: "expired",
        errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
        updatedBy: auth.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(documentVersionOperations.tenantId, auth.tenantId),
          eq(documentVersionOperations.documentId, documentId),
          eq(documentVersionOperations.status, "pending"),
          lte(documentVersionOperations.expiresAt, now),
          isNull(documentVersionOperations.deletedAt),
        ),
      );
  }

  private async findOperationByRequest(
    auth: AuthContext,
    documentId: string,
    requestId: string,
  ) {
    const [operation] = await this.db
      .select()
      .from(documentVersionOperations)
      .where(
        and(
          eq(documentVersionOperations.tenantId, auth.tenantId),
          eq(documentVersionOperations.documentId, documentId),
          eq(documentVersionOperations.createdBy, auth.userId),
          eq(documentVersionOperations.requestId, requestId),
          isNull(documentVersionOperations.deletedAt),
        ),
      )
      .limit(1);
    return operation ?? null;
  }

  private async readVersionValue(
    auth: AuthContext,
    row: {
      revisionId: string | null;
      plateJson: unknown;
      formatVersion: number;
      contentHash: string;
    },
  ) {
    let stored = {
      value: row.plateJson,
      formatVersion: row.formatVersion,
      contentHash: row.contentHash,
    };
    if (row.revisionId) {
      const [revision] = await this.db
        .select({
          plateJson: documentRevisions.plateJson,
          formatVersion: documentRevisions.formatVersion,
          contentHash: documentRevisions.contentHash,
        })
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.id, row.revisionId),
            eq(documentRevisions.tenantId, auth.tenantId),
            isNull(documentRevisions.deletedAt),
          ),
        )
        .limit(1);
      if (!revision) {
        throw new ApiError("DOCUMENT_VERSION_VALUE_INVALID", "正文 revision 不存在。", 422);
      }
      stored = {
        value: revision.plateJson,
        formatVersion: revision.formatVersion,
        contentHash: revision.contentHash,
      };
    }
    if (stored.formatVersion !== 1) {
      throw new ApiError("DOCUMENT_VERSION_VALUE_INVALID", "正文版本格式暂不受支持。", 422);
    }
    try {
      return {
        value: projectDocumentVersionValue(stored.value),
        contentHash: stored.contentHash,
      };
    } catch {
      throw new ApiError("DOCUMENT_VERSION_VALUE_INVALID", "正文版本内容无法读取。", 422);
    }
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

  private async ensureVersionRevision(auth: AuthContext, documentId: string, versionId: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from documents where id = ${documentId} and tenant_id = ${auth.tenantId} and deleted_at is null for update`,
      );
      const [version] = await tx
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.tenantId, auth.tenantId),
            eq(documentVersions.documentId, documentId),
            isNotNull(documentVersions.sealedAt),
            isNull(documentVersions.deletedAt),
          ),
        )
        .limit(1);
      if (!version) throw new ApiError("DOCUMENT_VERSION_NOT_FOUND", "正文版本不存在。", 404);
      if (version.revisionId) return version.revisionId;
      const { revision } = await materializeDocumentRevision(tx, {
        tenantId: auth.tenantId,
        documentId,
        value: version.plateJson,
        userId: auth.userId,
      });
      await tx
        .update(documentVersions)
        .set({ revisionId: revision.id, updatedBy: auth.userId, updatedAt: new Date() })
        .where(and(eq(documentVersions.id, versionId), isNull(documentVersions.revisionId)));
      return revision.id;
    });
  }

  private assertRestoreSource(source: DocumentRestoreOperationSource) {
    const validVersion =
      source.sourceKind === "version" &&
      source.sourceVersionId !== null &&
      source.sourceVersionNo !== null &&
      source.sourceActivityEventId === null;
    const validActivity =
      source.sourceKind === "activity" &&
      source.sourceVersionId === null &&
      source.sourceVersionNo === null &&
      source.sourceActivityEventId !== null;
    if (!validVersion && !validActivity) {
      throw new ApiError("DOCUMENT_VERSION_VALUE_INVALID", "恢复来源不完整。", 422);
    }
  }

  private assertMatchingRequest(
    operation: typeof documentVersionOperations.$inferSelect,
    source: DocumentRestoreOperationSource,
    baseStateVectorHash: string,
    force: boolean,
  ) {
    if (
      operation.sourceKind !== source.sourceKind ||
      operation.sourceRevisionId !== source.sourceRevisionId ||
      operation.sourceVersionId !== source.sourceVersionId ||
      operation.sourceVersionNo !== source.sourceVersionNo ||
      operation.sourceActivityEventId !== source.sourceActivityEventId ||
      operation.baseStateVectorHash !== baseStateVectorHash ||
      operation.force !== force
    ) {
      throw new ApiError(
        "DOCUMENT_VERSION_REQUEST_ID_REUSED",
        "该恢复请求标识已用于不同参数。",
        409,
      );
    }
  }

  private serializeSummary(row: {
    id: string;
    versionNo: number;
    kind: string;
    sourceVersionNo: number | null;
    changeSummary: string | null;
    sealedAt: Date | null;
    updatedAt: Date;
    editorId: string;
    editorName: string;
    editorAvatarMediaId: string | null;
  }) {
    if (!row.sealedAt) throw new Error("Cannot serialize an open document version");
    return {
      id: row.id,
      versionNo: row.versionNo,
      kind: row.kind === "restore" ? ("restore" as const) : ("auto" as const),
      sourceVersionNo: row.sourceVersionNo,
      changeSummary: row.changeSummary,
      sealedAt: row.sealedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastEditor: {
        id: row.editorId,
        displayName: row.editorName,
        avatarUrl: row.editorAvatarMediaId ? `/api/media/${row.editorAvatarMediaId}/raw` : null,
      },
    };
  }

  private assertHistoryEnabled() {
    if (!this.env.DOCUMENT_VERSION_HISTORY_ENABLED) {
      throw new ApiError("DOCUMENT_VERSION_HISTORY_DISABLED", "正文版本历史尚未启用。", 404);
    }
  }

  private assertRestoreEnabled(auth: AuthContext) {
    this.assertHistoryEnabled();
    if (!this.env.DOCUMENT_VERSION_RESTORE_ENABLED || !["editor", "admin"].includes(auth.role)) {
      throw new ApiError("FORBIDDEN", "当前用户不能恢复正文版本。", 403);
    }
  }

  private async hashStateVector(base64Url: string) {
    const normalized = base64Url.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private serializeOperation(operation: typeof documentVersionOperations.$inferSelect) {
    return {
      operationId: operation.id,
      status: operation.status as
        | "pending"
        | "applying"
        | "applied"
        | "conflict"
        | "failed"
        | "expired",
      sourceKind: operation.sourceKind === "activity" ? ("activity" as const) : ("version" as const),
      sourceVersionNo: operation.sourceVersionNo,
      sourceActivityEventId: operation.sourceActivityEventId,
      beforeVersionNo: operation.beforeVersionNo,
      resultVersionNo: operation.resultVersionNo,
      errorCode: operation.errorCode,
      expiresAt: operation.expiresAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
    };
  }

  private isUniqueViolation(error: unknown) {
    let current = error;
    for (let depth = 0; depth < 5; depth += 1) {
      if (!current || typeof current !== "object") return false;
      if ("code" in current && current.code === "23505") return true;
      current = "cause" in current ? current.cause : null;
    }
    return false;
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
