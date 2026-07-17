import {
  createDocumentRequestSchema,
  documentDiscussionListSchema,
  markDocumentDiscussionsReadRequestSchema,
  markDocumentDiscussionsReadResponseSchema,
  documentDiscussionsResponseSchema,
  extractDocumentInlineMediaIds,
  updateDocumentRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import {
  materializeAutoVersion,
  recordStandaloneDocumentActivity,
  syncDocumentInlineMediaUsagesWithClient,
} from "@sharebrain/db";
import {
  documentDiscussionReadStates,
  documentReviewStates,
  documentVersions,
  documents,
  moduleRecords,
  projectModules,
  projects,
} from "@sharebrain/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { IndexerService } from "../indexer/indexer.service";
import {
  serializeDocumentDetail,
  serializeDocumentMetadata,
  serializeDocumentPreview,
  serializeDocumentSummary,
} from "../shared/serializers";
import { appendSortKey } from "../shared/sort-key";

import type { DatabaseClient } from "@sharebrain/db";
import type { ServerEnv } from "@sharebrain/config";

const emptyPlateJson = [{ type: "p", children: [{ text: "" }] }];
const documentPreviewBlockLimit = 24;

function toIsoTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class DocumentsService {
  private readonly indexer: IndexerService;

  constructor(
    private readonly db: DatabaseClient,
    private readonly env: ServerEnv,
  ) {
    this.indexer = new IndexerService(db);
  }

  async listByProject(auth: AuthContext, projectId: string, moduleId?: string | null, moduleRecordId?: string | null) {
    await this.ensureProject(auth, projectId);
    if (moduleId) {
      await this.ensureModuleInProject(auth, projectId, moduleId);
    }
    if (moduleRecordId) {
      await this.ensureRecordInContainer(auth, projectId, moduleId ?? null, moduleRecordId);
    }

    const conditions = [eq(documents.tenantId, auth.tenantId), eq(documents.projectId, projectId), isNull(documents.deletedAt)];
    if (moduleId) {
      conditions.push(eq(documents.moduleId, moduleId));
    }
    if (moduleRecordId) {
      conditions.push(eq(documents.moduleRecordId, moduleRecordId));
    }

    const rows = await this.db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(asc(documents.sortKey));

    return rows.map(serializeDocumentSummary);
  }

  async create(auth: AuthContext, projectId: string, input: unknown) {
    await this.ensureProject(auth, projectId);
    const payload = parseJson(createDocumentRequestSchema, input);
    await this.ensureModuleInProject(auth, projectId, payload.moduleId);
    if (payload.moduleRecordId) {
      await this.ensureRecordInContainer(auth, projectId, payload.moduleId, payload.moduleRecordId);
    }
    if (payload.parentId) {
      await this.ensureParentDocument(auth, projectId, payload.parentId);
    }

    const now = new Date();
    const document = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: auth.tenantId,
          projectId,
          moduleId: payload.moduleId,
          moduleRecordId: payload.moduleRecordId ?? null,
          parentId: payload.parentId ?? null,
          title: payload.title,
          status: "active",
          visibility: "tenant",
          currentVersion: 1,
          sortKey: appendSortKey(),
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) return null;
      await materializeAutoVersion(tx, {
        tenantId: auth.tenantId,
        documentId: created.id,
        value: emptyPlateJson,
        userId: auth.userId,
        now,
      });
      if (this.env.DOCUMENT_ACTIVITY_HISTORY_ENABLED) {
        await recordStandaloneDocumentActivity(tx, {
          tenantId: auth.tenantId,
          documentId: created.id,
          actorId: auth.userId,
          type: "document_created",
          sourceKey: `document-created:${created.id}`,
          details: { kind: "document_created", title: created.title },
          occurredAt: now,
          now,
        });
      }
      return created;
    });

    if (!document) {
      throw new ApiError("DOCUMENT_CREATE_FAILED", "文档创建失败。", 500);
    }

    await this.indexer.indexDocument(auth, document.id, emptyPlateJson, "");
    return serializeDocumentSummary(document);
  }

  async get(auth: AuthContext, documentId: string) {
    const document = await this.ensureDocument(auth, documentId);
    const [version] = await this.db
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.tenantId, auth.tenantId), eq(documentVersions.documentId, document.id)))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);

    return serializeDocumentDetail(document, version);
  }

  async getMetadata(auth: AuthContext, documentId: string) {
    return serializeDocumentMetadata(
      await this.ensureDocument(auth, documentId),
    );
  }

  async getPreview(auth: AuthContext, documentId: string) {
    const document = await this.ensureDocument(auth, documentId);
    const [version] = await this.db
      .select({
        plateJson: sql<unknown[]>`
          coalesce(
            (
              select jsonb_agg(item.value order by item.ordinality)
              from jsonb_array_elements(${documentVersions.plateJson})
                with ordinality as item(value, ordinality)
              where item.ordinality <= ${documentPreviewBlockLimit}
            ),
            '[]'::jsonb
          )
        `,
        totalBlocks: sql<number>`jsonb_array_length(${documentVersions.plateJson})`,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.tenantId, auth.tenantId),
          eq(documentVersions.documentId, document.id),
        ),
      )
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);
    const value = Array.isArray(version?.plateJson) ? version.plateJson : emptyPlateJson;
    const totalBlocks = Number(version?.totalBlocks ?? 0);

    return serializeDocumentPreview(
      document,
      value,
      Number.isSafeInteger(totalBlocks) && totalBlocks >= 0
        ? totalBlocks
        : value.length,
    );
  }

  async getDiscussions(auth: AuthContext, documentId: string) {
    const document = await this.ensureDocument(auth, documentId);
    const [reviewState] = await this.db
      .select({ discussions: documentReviewStates.discussions })
      .from(documentReviewStates)
      .where(and(eq(documentReviewStates.tenantId, auth.tenantId), eq(documentReviewStates.documentId, document.id)))
      .limit(1);
    const readStates = await this.db
      .select({
        activityKey: documentDiscussionReadStates.activityKey,
        discussionId: documentDiscussionReadStates.discussionId,
        readAt: documentDiscussionReadStates.readAt,
      })
      .from(documentDiscussionReadStates)
      .where(
        and(
          eq(documentDiscussionReadStates.tenantId, auth.tenantId),
          eq(documentDiscussionReadStates.documentId, document.id),
          eq(documentDiscussionReadStates.userId, auth.userId),
          isNull(documentDiscussionReadStates.deletedAt),
        ),
      );

    const parsed = documentDiscussionListSchema.safeParse(reviewState?.discussions ?? []);

    return documentDiscussionsResponseSchema.parse({
      discussions: parsed.success ? parsed.data : [],
      readStates: readStates.map((state) => ({
        activityKey: state.activityKey,
        discussionId: state.discussionId,
        readAt: toIsoTimestamp(state.readAt),
      })),
    });
  }

  async markDiscussionsRead(auth: AuthContext, documentId: string, input: unknown) {
    const document = await this.ensureDocument(auth, documentId);
    const payload = parseJson(markDocumentDiscussionsReadRequestSchema, input);
    const now = new Date();
    const itemsByDiscussionId = new Map(payload.items.map((item) => [item.discussionId, item]));

    const readStates = await this.db.transaction(async (tx) => {
      await tx
        .insert(documentDiscussionReadStates)
        .values(
          [...itemsByDiscussionId.values()].map((item) => ({
            tenantId: auth.tenantId,
            documentId: document.id,
            userId: auth.userId,
            discussionId: item.discussionId,
            activityKey: item.activityKey,
            readAt: now,
            createdBy: auth.userId,
            updatedBy: auth.userId,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [
            documentDiscussionReadStates.documentId,
            documentDiscussionReadStates.userId,
            documentDiscussionReadStates.discussionId,
          ],
          set: {
            activityKey: sql`excluded.activity_key`,
            readAt: now,
            updatedBy: auth.userId,
            updatedAt: now,
            deletedAt: null,
          },
        });

      return tx
        .select({
          activityKey: documentDiscussionReadStates.activityKey,
          discussionId: documentDiscussionReadStates.discussionId,
          readAt: documentDiscussionReadStates.readAt,
        })
        .from(documentDiscussionReadStates)
        .where(
          and(
            eq(documentDiscussionReadStates.tenantId, auth.tenantId),
            eq(documentDiscussionReadStates.documentId, document.id),
            eq(documentDiscussionReadStates.userId, auth.userId),
            isNull(documentDiscussionReadStates.deletedAt),
          ),
        );
    });

    return markDocumentDiscussionsReadResponseSchema.parse({
      readStates: readStates.map((state) => ({
        activityKey: state.activityKey,
        discussionId: state.discussionId,
        readAt: toIsoTimestamp(state.readAt),
      })),
    });
  }

  async update(auth: AuthContext, documentId: string, input: unknown) {
    const payload = parseJson(updateDocumentRequestSchema, input);
    const existing = await this.ensureDocument(auth, documentId);
    const now = new Date();
    const document = await this.db.transaction(async (tx) => {
      const [updatedDocument] = await tx
        .update(documents)
        .set({
          title: payload.title ?? existing.title,
          visibility: payload.visibility ?? existing.visibility,
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(eq(documents.id, existing.id))
        .returning();

      if (!updatedDocument) {
        throw new ApiError("DOCUMENT_UPDATE_FAILED", "文档更新失败。", 500);
      }

      if (payload.plateJson !== undefined) {
        await materializeAutoVersion(tx, {
          tenantId: auth.tenantId,
          documentId: updatedDocument.id,
          value: payload.plateJson,
          userId: auth.userId,
        });
        await syncDocumentInlineMediaUsagesWithClient(tx, {
          tenantId: auth.tenantId,
          documentId: updatedDocument.id,
          mediaIds: extractDocumentInlineMediaIds(payload.plateJson),
          userId: auth.userId,
        });
      }

      if (
        this.env.DOCUMENT_ACTIVITY_HISTORY_ENABLED &&
        payload.title !== undefined &&
        payload.title !== existing.title
      ) {
        await recordStandaloneDocumentActivity(tx, {
          tenantId: auth.tenantId,
          documentId: updatedDocument.id,
          actorId: auth.userId,
          type: "title_edited",
          sourceKey: `title:${auth.requestId}`,
          details: {
            kind: "title",
            beforeTitle: existing.title,
            afterTitle: updatedDocument.title,
          },
          occurredAt: now,
          now,
        });
      }

      return updatedDocument;
    });

    if (payload.plateJson !== undefined) {
      await this.indexer.indexDocument(auth, document.id, payload.plateJson, payload.plainText);
    }

    return this.get(auth, document.id);
  }

  async softDelete(auth: AuthContext, documentId: string) {
    const document = await this.db.transaction(async (tx) => {
      const [deletedDocument] = await tx
        .update(documents)
        .set({ deletedAt: new Date(), status: "deleted", updatedBy: auth.userId, updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId), isNull(documents.deletedAt)))
        .returning();

      if (!deletedDocument) {
        throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
      }

      await syncDocumentInlineMediaUsagesWithClient(tx, {
        tenantId: auth.tenantId,
        documentId: deletedDocument.id,
        mediaIds: [],
        userId: auth.userId,
      });

      return deletedDocument;
    });

    if (!document) {
      throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
    }

    return serializeDocumentSummary(document);
  }

  async restore(auth: AuthContext, documentId: string) {
    const document = await this.db.transaction(async (tx) => {
      const [restoredDocument] = await tx
        .update(documents)
        .set({ deletedAt: null, status: "active", updatedBy: auth.userId, updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId)))
        .returning();

      if (!restoredDocument) {
        throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
      }

      const [latestVersion] = await tx
        .select({ plateJson: documentVersions.plateJson })
        .from(documentVersions)
        .where(and(eq(documentVersions.tenantId, auth.tenantId), eq(documentVersions.documentId, restoredDocument.id)))
        .orderBy(desc(documentVersions.versionNo))
        .limit(1);

      await syncDocumentInlineMediaUsagesWithClient(tx, {
        tenantId: auth.tenantId,
        documentId: restoredDocument.id,
        mediaIds: extractDocumentInlineMediaIds(latestVersion?.plateJson ?? []),
        userId: auth.userId,
      });

      return restoredDocument;
    });

    if (!document) {
      throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
    }

    return serializeDocumentSummary(document);
  }

  private async ensureProject(auth: AuthContext, projectId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .limit(1);

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }
    return project;
  }

  private async ensureModuleInProject(auth: AuthContext, projectId: string, moduleId: string) {
    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.projectId, projectId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .limit(1);

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }
    return module;
  }

  private async ensureRecordInContainer(
    auth: AuthContext,
    projectId: string,
    moduleId: string | null,
    moduleRecordId: string,
  ) {
    const conditions = [
      eq(moduleRecords.id, moduleRecordId),
      eq(moduleRecords.projectId, projectId),
      eq(moduleRecords.tenantId, auth.tenantId),
      isNull(moduleRecords.deletedAt),
    ];
    if (moduleId) {
      conditions.push(eq(moduleRecords.moduleId, moduleId));
    }

    const [record] = await this.db
      .select()
      .from(moduleRecords)
      .where(and(...conditions))
      .limit(1);

    if (!record) {
      throw new ApiError("RECORD_NOT_FOUND", "记录不存在。", 404);
    }
    return record;
  }

  private async ensureParentDocument(auth: AuthContext, projectId: string, parentId: string) {
    const [parent] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, parentId),
          eq(documents.projectId, projectId),
          eq(documents.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!parent) {
      throw new ApiError("PARENT_DOCUMENT_NOT_FOUND", "父文档不存在。", 404);
    }
    return parent;
  }

  private async ensureDocument(auth: AuthContext, documentId: string) {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId), isNull(documents.deletedAt)))
      .limit(1);

    if (!document) {
      throw new ApiError("DOCUMENT_NOT_FOUND", "文档不存在。", 404);
    }
    return document;
  }
}
