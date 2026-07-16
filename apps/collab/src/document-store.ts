// 负责把活跃 Y.Doc 原子物化为快照、版本、媒体、评论和搜索读模型。
import type { DatabaseClient } from "@sharebrain/db";
import {
  DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY,
  DOCUMENT_COMMENT_MARK_PREFIX,
  DOCUMENT_DISCUSSIONS_BY_ID_KEY,
  DOCUMENT_DRAFT_COMMENT_MARK_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  type DocumentDiscussionList,
  type DocumentActivityType,
  type DocumentRestoreSourceKind,
  diffDocumentActivityBlocks,
  documentDiscussionSchema,
  documentDiscussionListSchema,
  extractDocumentInlineMediaIds,
  projectDocumentVersionValue,
  toDocumentActivityExcerpt,
} from "@sharebrain/contracts";
import {
  insertRestoreVersion,
  materializeAutoVersion,
  recordDocumentContentActivity,
  recordStandaloneDocumentActivity,
  sealCurrentVersion,
  syncDocumentInlineMediaUsagesWithClient,
} from "@sharebrain/db";
import {
  documentCrdtSnapshots,
  documentReviewStates,
  documentVersions,
  documents,
  searchItems,
} from "@sharebrain/db/schema";
import { slateNodesToInsertDelta, yTextToSlateElement } from "@slate-yjs/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Node } from "slate";
import * as Y from "yjs";

import type { CollabContext } from "./auth";
import type { DocumentActivityBatch } from "./document-activity-tracker";

type DocumentStoreClient = Pick<DatabaseClient, "delete" | "insert" | "select" | "update">;

function extractTextFromPlate(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextFromPlate).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ownText = typeof record.text === "string" ? record.text : "";
    const childText = extractTextFromPlate(record.children);
    return [ownText, childText].filter(Boolean).join("");
  }

  return "";
}

export async function loadDocumentSnapshot(db: DatabaseClient, context: CollabContext) {
  const [snapshot] = await db
    .select({ ydocSnapshot: documentCrdtSnapshots.ydocSnapshot })
    .from(documentCrdtSnapshots)
    .where(
      and(
        eq(documentCrdtSnapshots.documentId, context.documentId),
        eq(documentCrdtSnapshots.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (snapshot) return snapshot.ydocSnapshot;

  const [latestVersion] = await db
    .select({ plateJson: documentVersions.plateJson })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, context.documentId),
        eq(documentVersions.tenantId, context.tenantId),
        isNull(documentVersions.deletedAt),
      ),
    )
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);

  return latestVersion ? createDocumentBootstrapUpdate(latestVersion.plateJson) : null;
}

export function createDocumentBootstrapUpdate(value: unknown) {
  const nodes = prepareDocumentYjsNodes(value);
  const ydoc = new Y.Doc();
  const sharedRoot = ydoc.get("content", Y.XmlText);

  ydoc.transact(() => {
    sharedRoot.applyDelta(
      slateNodesToInsertDelta(nodes),
      { sanitize: false },
    );
  });

  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
}

export function prepareDocumentYjsNodes(value: unknown): Node[] {
  const projected = projectDocumentVersionValue(value);

  // Projection uses null-prototype records to reject prototype pollution. Yjs
  // XmlText attributes only accept ordinary JSON records, so materialize the
  // already validated canonical value before converting it to a Slate delta.
  return JSON.parse(JSON.stringify(projected)) as Node[];
}

export async function storeDocumentSnapshot(
  db: DatabaseClient,
  context: CollabContext,
  ydoc: Y.Doc,
  options: StoreDocumentOptions = {},
) {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  const stateVector = Buffer.from(Y.encodeStateVector(ydoc));
  const sharedRoot = ydoc.get("content", Y.XmlText);
  const plateJson = yTextToSlateElement(sharedRoot).children;
  const plainText = extractTextFromPlate(plateJson);

  const result = await db.transaction(async (tx) => {
    await tx
      .insert(documentCrdtSnapshots)
      .values({
        tenantId: context.tenantId,
        documentId: context.documentId,
        ydocSnapshot: snapshot,
        stateVector,
        updatedBy: context.userId,
      })
      .onConflictDoUpdate({
        target: documentCrdtSnapshots.documentId,
        set: {
          ydocSnapshot: snapshot,
          stateVector,
          updatedBy: context.userId,
          updatedAt: new Date(),
        },
      });

    const versionInput = {
      tenantId: context.tenantId,
      documentId: context.documentId,
      value: plateJson,
      userId: context.userId,
    };
    const version = options.restore
      ? await insertRestoreVersion(tx, {
          ...versionInput,
          operationId: options.restore.operationId,
          sourceKind: options.restore.sourceKind,
          sourceRevisionId: options.restore.sourceRevisionId,
          sourceVersionId: options.restore.sourceVersionId,
          sourceVersionNo: options.restore.sourceVersionNo,
          sourceActivityEventId: options.restore.sourceActivityEventId,
        })
      : options.seal
        ? await sealCurrentVersion(tx, versionInput)
        : await materializeAutoVersion(tx, versionInput);
    if (!version) {
      return;
    }

    await persistDocumentActivityBatches(tx, options.activityBatches ?? []);

    await syncDocumentInlineMediaUsagesWithClient(tx, {
      tenantId: context.tenantId,
      documentId: context.documentId,
      mediaIds: extractDocumentInlineMediaIds(plateJson),
      userId: context.userId,
    });
    await materializeReviewState(tx, context, ydoc, plateJson);
    await upsertSearchItem(tx, context, plainText);
    return version;
  });

  options.onSnapshotStored?.(snapshot);
  return result;
}

type StoreDocumentOptions = {
  activityBatches?: DocumentActivityBatch[];
  onSnapshotStored?: (snapshot: Uint8Array) => void;
  seal?: boolean;
  restore?: {
    operationId: string;
    sourceKind: DocumentRestoreSourceKind;
    sourceRevisionId: string;
    sourceVersionId: string | null;
    sourceVersionNo: number | null;
    sourceActivityEventId: string | null;
  };
};

type DiscussionActivity = {
  type: Extract<
    DocumentActivityType,
    | "comment_added"
    | "comment_replied"
    | "comment_edited"
    | "comment_deleted"
    | "comment_resolved"
  >;
  discussionId: string;
  commentId: string | null;
  excerpt: string;
};

function diffDiscussionActivities(
  before: DocumentDiscussionList,
  after: DocumentDiscussionList,
): DiscussionActivity[] {
  const activities: DiscussionActivity[] = [];
  const beforeDiscussions = new Map(before.map((discussion) => [discussion.id, discussion]));
  const afterDiscussionIds = new Set(after.map((discussion) => discussion.id));

  for (const discussion of after) {
    const previous = beforeDiscussions.get(discussion.id);
    if (!previous) {
      discussion.comments.forEach((comment, index) => {
        activities.push({
          type: index === 0 ? "comment_added" : "comment_replied",
          discussionId: discussion.id,
          commentId: comment.id,
          excerpt: toDocumentActivityExcerpt(comment.contentRich),
        });
      });
      continue;
    }

    const previousComments = new Map(previous.comments.map((comment) => [comment.id, comment]));
    const currentCommentIds = new Set(discussion.comments.map((comment) => comment.id));
    for (const comment of discussion.comments) {
      const previousComment = previousComments.get(comment.id);
      if (!previousComment) {
        activities.push({
          type: "comment_replied",
          discussionId: discussion.id,
          commentId: comment.id,
          excerpt: toDocumentActivityExcerpt(comment.contentRich),
        });
      } else if (
        previousComment.updatedAt !== comment.updatedAt ||
        JSON.stringify(previousComment.contentRich) !== JSON.stringify(comment.contentRich)
      ) {
        activities.push({
          type: "comment_edited",
          discussionId: discussion.id,
          commentId: comment.id,
          excerpt: toDocumentActivityExcerpt(comment.contentRich),
        });
      }
    }
    for (const comment of previous.comments) {
      if (currentCommentIds.has(comment.id)) continue;
      activities.push({
        type: "comment_deleted",
        discussionId: discussion.id,
        commentId: comment.id,
        excerpt: toDocumentActivityExcerpt(comment.contentRich),
      });
    }
    if (!previous.isResolved && discussion.isResolved) {
      activities.push({
        type: "comment_resolved",
        discussionId: discussion.id,
        commentId: null,
        excerpt: discussion.documentContent?.slice(0, 160) ?? "",
      });
    }
  }

  for (const discussion of before) {
    if (afterDiscussionIds.has(discussion.id)) continue;
    activities.push({
      type: "comment_deleted",
      discussionId: discussion.id,
      commentId: null,
      excerpt:
        discussion.documentContent?.slice(0, 160) ??
        toDocumentActivityExcerpt(discussion.comments[0]?.contentRich ?? []),
    });
  }
  return activities;
}

async function persistDocumentActivityBatches(
  db: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  batches: DocumentActivityBatch[],
) {
  for (const batch of batches) {
    await recordDocumentContentActivity(db, {
      tenantId: batch.context.tenantId,
      documentId: batch.context.documentId,
      actorId: batch.context.userId,
      sourceKey: `yjs:${batch.id}:content`,
      details: diffDocumentActivityBlocks(batch.beforeValue, batch.afterValue),
      beforeValue: batch.beforeValue,
      afterValue: batch.afterValue,
      startedAt: batch.startedAt,
      now: batch.occurredAt,
    });

    if (batch.beforeDiscussions === null || batch.afterDiscussions === null) continue;
    const discussionActivities = diffDiscussionActivities(
      batch.beforeDiscussions,
      batch.afterDiscussions,
    );
    for (const [index, activity] of discussionActivities.entries()) {
      await recordStandaloneDocumentActivity(db, {
        tenantId: batch.context.tenantId,
        documentId: batch.context.documentId,
        actorId: batch.context.userId,
        type: activity.type,
        sourceKey: `yjs:${batch.id}:${activity.type}:${index}`,
        details: {
          kind: "comment",
          discussionId: activity.discussionId,
          commentId: activity.commentId,
          excerpt: activity.excerpt,
        },
        occurredAt: batch.occurredAt,
        now: batch.occurredAt,
      });
    }
  }
}

async function materializeReviewState(
  db: DocumentStoreClient,
  context: CollabContext,
  ydoc: Y.Doc,
  plateJson: unknown,
) {
  const discussions = readDocumentReviewDiscussions(ydoc, {
    presentCommentIds: extractDocumentCommentIds(plateJson),
  });

  if (discussions === null) {
    console.warn(`collab review state skipped, invalid discussions for ${context.documentId}`);
    return;
  }

  await db
    .insert(documentReviewStates)
    .values({
      tenantId: context.tenantId,
      documentId: context.documentId,
      discussions,
      updatedBy: context.userId,
    })
    .onConflictDoUpdate({
      target: documentReviewStates.documentId,
      set: {
        discussions,
        updatedBy: context.userId,
        updatedAt: new Date(),
      },
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractDocumentCommentIds(value: unknown): Set<string> {
  const ids = new Set<string>();

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!isRecord(node)) return;

    Object.keys(node).forEach((key) => {
      if (key === DOCUMENT_DRAFT_COMMENT_MARK_KEY) return;
      if (!key.startsWith(DOCUMENT_COMMENT_MARK_PREFIX)) return;

      ids.add(key.slice(DOCUMENT_COMMENT_MARK_PREFIX.length));
    });

    visit(node.children);
  };

  visit(value);
  return ids;
}

const getString = (map: Y.Map<unknown>, key: string) => {
  const value = map.get(key);
  return typeof value === "string" ? value : null;
};

const getBoolean = (map: Y.Map<unknown>, key: string) => {
  const value = map.get(key);
  return typeof value === "boolean" ? value : null;
};

const getOptionalString = (map: Y.Map<unknown>, key: string) => {
  const value = map.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

function readReviewV2Discussions(
  discussionsById: Y.Map<unknown>,
  presentCommentIds?: Set<string>,
): DocumentDiscussionList | null {
  const discussions: DocumentDiscussionList = [];

  for (const [discussionId, discussionValue] of discussionsById.entries()) {
    if (!(discussionValue instanceof Y.Map)) return null;
    const detachedAt = getOptionalString(discussionValue, "detachedAt");
    if (presentCommentIds && !presentCommentIds.has(discussionId) && !detachedAt) continue;

    const commentsById = discussionValue.get(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY);
    if (!(commentsById instanceof Y.Map)) return null;

    const comments = [];
    for (const [commentId, commentValue] of commentsById.entries()) {
      if (!(commentValue instanceof Y.Map)) return null;

      comments.push({
        id: getString(commentValue, "id") ?? commentId,
        contentRich: Array.isArray(commentValue.get("contentRich")) ? commentValue.get("contentRich") : [],
        createdAt: getString(commentValue, "createdAt"),
        discussionId: getString(commentValue, "discussionId") ?? discussionId,
        isEdited: getBoolean(commentValue, "isEdited"),
        updatedAt: getString(commentValue, "updatedAt"),
        userId: getString(commentValue, "userId"),
      });
    }

    const candidate = {
      id: getString(discussionValue, "id") ?? discussionId,
      comments: comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
      createdAt: getString(discussionValue, "createdAt"),
      documentContent: getOptionalString(discussionValue, "documentContent"),
      ...(detachedAt ? { detachedAt } : {}),
      ...(getOptionalString(discussionValue, "detachedReason") === "version_restore"
        ? { detachedReason: "version_restore" as const }
        : {}),
      isResolved: getBoolean(discussionValue, "isResolved"),
      updatedAt: getString(discussionValue, "updatedAt"),
      userId: getString(discussionValue, "userId"),
    };
    const parsed = documentDiscussionSchema.safeParse(candidate);

    if (!parsed.success) return null;
    if (parsed.data.comments.length === 0) continue;

    discussions.push(parsed.data);
  }

  return discussions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function readDocumentReviewDiscussions(
  ydoc: Y.Doc,
  options: { presentCommentIds?: Set<string> } = {},
): DocumentDiscussionList | null {
  const reviewMap = ydoc.getMap(DOCUMENT_REVIEW_MAP_NAME);
  const discussionsById = reviewMap.get(DOCUMENT_DISCUSSIONS_BY_ID_KEY);

  if (discussionsById === undefined) return [];

  if (!(discussionsById instanceof Y.Map)) return null;

  const parsed = documentDiscussionListSchema.safeParse(
    readReviewV2Discussions(discussionsById, options.presentCommentIds),
  );

  if (parsed.success) {
    return parsed.data;
  }

  return null;
}

/**
 * 与 API 侧 indexer 的文档分支保持一致的最小搜索读模型更新；
 * blocks/chunks 等派生数据后续由 worker 物化。
 */
async function upsertSearchItem(db: DocumentStoreClient, context: CollabContext, plainText: string) {
  const [document] = await db
    .select({ id: documents.id, projectId: documents.projectId, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.id, context.documentId),
        eq(documents.tenantId, context.tenantId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!document) {
    return;
  }

  await db
    .delete(searchItems)
    .where(
      and(
        eq(searchItems.tenantId, context.tenantId),
        eq(searchItems.entityType, "document"),
        eq(searchItems.entityId, document.id),
      ),
    );

  await db.insert(searchItems).values({
    tenantId: context.tenantId,
    projectId: document.projectId,
    entityType: "document",
    entityId: document.id,
    documentId: document.id,
    title: document.title,
    content: plainText || document.title,
    pathText: document.title,
    tags: [],
    metadata: {},
    createdBy: context.userId,
    updatedBy: context.userId,
  });
}
