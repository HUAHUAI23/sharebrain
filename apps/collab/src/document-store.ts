import type { DatabaseClient } from "@sharebrain/db";
import {
  DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY,
  DOCUMENT_COMMENT_MARK_PREFIX,
  DOCUMENT_DISCUSSIONS_BY_ID_KEY,
  DOCUMENT_DRAFT_COMMENT_MARK_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  type DocumentDiscussionList,
  documentDiscussionSchema,
  documentDiscussionListSchema,
  extractDocumentInlineMediaIds,
} from "@sharebrain/contracts";
import { syncDocumentInlineMediaUsagesWithClient } from "@sharebrain/db";
import {
  documentCrdtSnapshots,
  documentReviewStates,
  documentVersions,
  documents,
  searchItems,
} from "@sharebrain/db/schema";
import { yTextToSlateElement } from "@slate-yjs/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as Y from "yjs";

import type { CollabContext } from "./auth";

/** 距上一个版本超过该间隔才生成新版本行，否则原地更新最新版本。 */
const VERSION_ROLLUP_MS = 5 * 60 * 1000;

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

  return snapshot?.ydocSnapshot ?? null;
}

export async function storeDocumentSnapshot(
  db: DatabaseClient,
  context: CollabContext,
  ydoc: Y.Doc,
) {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  const stateVector = Buffer.from(Y.encodeStateVector(ydoc));
  const sharedRoot = ydoc.get("content", Y.XmlText);
  const plateJson = yTextToSlateElement(sharedRoot).children;
  const plainText = extractTextFromPlate(plateJson);

  await db.transaction(async (tx) => {
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

    const documentActive = await materializeVersion(tx, context, plateJson, plainText);
    if (!documentActive) {
      return;
    }

    await syncDocumentInlineMediaUsagesWithClient(tx, {
      tenantId: context.tenantId,
      documentId: context.documentId,
      mediaIds: extractDocumentInlineMediaIds(plateJson),
      userId: context.userId,
    });
    await materializeReviewState(tx, context, ydoc, plateJson);
    await upsertSearchItem(tx, context, plainText);
  });
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
    if (presentCommentIds && !presentCommentIds.has(discussionId)) continue;
    if (!(discussionValue instanceof Y.Map)) return null;

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

async function materializeVersion(
  db: DocumentStoreClient,
  context: CollabContext,
  plateJson: unknown,
  plainText: string,
) {
  const [document] = await db
    .select()
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
    return false;
  }

  const [latestVersion] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, document.id))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);

  const shouldRollup =
    latestVersion && Date.now() - latestVersion.updatedAt.getTime() < VERSION_ROLLUP_MS;

  if (shouldRollup) {
    await db
      .update(documentVersions)
      .set({
        plateJson: plateJson as never,
        plainText,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(eq(documentVersions.id, latestVersion.id));
  } else {
    const nextVersionNo = (latestVersion?.versionNo ?? 0) + 1;

    await db.insert(documentVersions).values({
      tenantId: context.tenantId,
      documentId: document.id,
      versionNo: nextVersionNo,
      plateJson: plateJson as never,
      markdown: "",
      plainText,
      createdBy: context.userId,
      updatedBy: context.userId,
    });

    await db
      .update(documents)
      .set({ currentVersion: nextVersionNo, updatedBy: context.userId, updatedAt: new Date() })
      .where(eq(documents.id, document.id));

    return true;
  }

  await db
    .update(documents)
    .set({ updatedBy: context.userId, updatedAt: new Date() })
    .where(eq(documents.id, document.id));

  return true;
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
