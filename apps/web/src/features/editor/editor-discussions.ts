import { YjsPlugin } from "@platejs/yjs/react";
import {
  DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY,
  DOCUMENT_DISCUSSIONS_BY_ID_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  DOCUMENT_REVIEW_VERSION,
  DOCUMENT_REVIEW_VERSION_KEY,
  documentDiscussionCommentSchema,
  documentDiscussionListSchema,
  documentDiscussionSchema,
  type DocumentDiscussion,
  type DocumentDiscussionComment,
} from "@sharebrain/contracts";
import {
  discussionPlugin,
  setEditorDiscussions,
  type DiscussionAction,
  type TDiscussion,
} from "@sharebrain/editor";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { useEffect } from "react";
import * as Y from "yjs";

import { subscribeEditorYjsSync } from "./editor-yjs-bootstrap";

type DiscussionYMap = Y.Map<unknown>;
type CommentYMap = Y.Map<unknown>;

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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

function toSerializableComment(comment: TDiscussion["comments"][number]): DocumentDiscussionComment {
  return {
    id: comment.id,
    contentRich: Array.isArray(comment.contentRich) ? comment.contentRich : [],
    createdAt: toIsoTimestamp(comment.createdAt),
    discussionId: comment.discussionId,
    isEdited: comment.isEdited,
    updatedAt: toIsoTimestamp(comment.updatedAt),
    userId: comment.userId,
  };
}

function toSerializableDiscussion(discussion: TDiscussion): DocumentDiscussion {
  return {
    id: discussion.id,
    comments: discussion.comments.map(toSerializableComment),
    createdAt: toIsoTimestamp(discussion.createdAt),
    ...(discussion.documentContent ? { documentContent: discussion.documentContent } : {}),
    ...(discussion.detachedAt ? { detachedAt: toIsoTimestamp(discussion.detachedAt) } : {}),
    ...(discussion.detachedReason ? { detachedReason: discussion.detachedReason } : {}),
    isResolved: discussion.isResolved,
    updatedAt: toIsoTimestamp(discussion.updatedAt),
    userId: discussion.userId,
  };
}

export function toEditorDiscussions(discussions: DocumentDiscussion[]): TDiscussion[] {
  return discussions.map((discussion) => ({
    id: discussion.id,
    comments: discussion.comments.map((comment) => ({
      id: comment.id,
      contentRich: comment.contentRich as Value,
      createdAt: comment.createdAt,
      discussionId: comment.discussionId,
      isEdited: comment.isEdited,
      updatedAt: comment.updatedAt,
      userId: comment.userId,
    })),
    createdAt: discussion.createdAt,
    ...(discussion.documentContent ? { documentContent: discussion.documentContent } : {}),
    ...(discussion.detachedAt ? { detachedAt: discussion.detachedAt } : {}),
    ...(discussion.detachedReason ? { detachedReason: discussion.detachedReason } : {}),
    isResolved: discussion.isResolved,
    updatedAt: discussion.updatedAt,
    userId: discussion.userId,
  }));
}

function writeCommentMap(map: CommentYMap, comment: TDiscussion["comments"][number]) {
  const serializable = toSerializableComment(comment);

  map.set("id", serializable.id);
  map.set("contentRich", serializable.contentRich);
  map.set("createdAt", serializable.createdAt);
  map.set("discussionId", serializable.discussionId);
  map.set("isEdited", serializable.isEdited);
  map.set("updatedAt", serializable.updatedAt);
  map.set("userId", serializable.userId);
}

function createCommentMap(comment: TDiscussion["comments"][number]) {
  const map = new Y.Map<unknown>();
  writeCommentMap(map, comment);
  return map;
}

function writeDiscussionFields(map: DiscussionYMap, discussion: TDiscussion) {
  const serializable = toSerializableDiscussion(discussion);

  map.set("id", serializable.id);
  map.set("createdAt", serializable.createdAt);
  map.set("isResolved", serializable.isResolved);
  map.set("updatedAt", serializable.updatedAt);
  map.set("userId", serializable.userId);

  if (serializable.documentContent) {
    map.set("documentContent", serializable.documentContent);
  } else {
    map.delete("documentContent");
  }
  if (serializable.detachedAt) {
    map.set("detachedAt", serializable.detachedAt);
    map.set("detachedReason", serializable.detachedReason ?? "version_restore");
  } else {
    map.delete("detachedAt");
    map.delete("detachedReason");
  }
}

function createDiscussionMap(discussion: TDiscussion): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  const commentsById = new Y.Map<unknown>();

  writeDiscussionFields(map, discussion);
  discussion.comments.forEach((comment) => {
    commentsById.set(comment.id, createCommentMap(comment));
  });
  map.set(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY, commentsById);

  return map;
}

function readCommentMap(
  commentId: string,
  commentMap: CommentYMap,
  discussionId: string,
): DocumentDiscussionComment | null {
  const contentRich = commentMap.get("contentRich");

  const parsed = documentDiscussionCommentSchema.safeParse({
    id: getString(commentMap, "id") ?? commentId,
    contentRich: Array.isArray(contentRich) ? contentRich : [],
    createdAt: getString(commentMap, "createdAt") ?? "",
    discussionId: getString(commentMap, "discussionId") ?? discussionId,
    isEdited: getBoolean(commentMap, "isEdited") ?? false,
    updatedAt: getString(commentMap, "updatedAt") ?? "",
    userId: getString(commentMap, "userId") ?? "",
  });

  return parsed.success ? parsed.data : null;
}

function readDiscussionMap(discussionId: string, discussionMap: DiscussionYMap): DocumentDiscussion | null {
  const commentsById = discussionMap.get(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY);
  const documentContent = getOptionalString(discussionMap, "documentContent");
  const detachedAt = getOptionalString(discussionMap, "detachedAt");

  if (!(commentsById instanceof Y.Map)) return null;

  const comments: DocumentDiscussionComment[] = [];

  for (const [commentId, commentValue] of commentsById.entries()) {
    if (!(commentValue instanceof Y.Map)) continue;

    const comment = readCommentMap(commentId, commentValue, discussionId);

    if (comment) {
      comments.push(comment);
    }
  }

  const parsed = documentDiscussionSchema.safeParse({
    id: getString(discussionMap, "id") ?? discussionId,
    comments: comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    createdAt: getString(discussionMap, "createdAt") ?? "",
    ...(documentContent ? { documentContent } : {}),
    ...(detachedAt ? { detachedAt } : {}),
    ...(getOptionalString(discussionMap, "detachedReason") === "version_restore"
      ? { detachedReason: "version_restore" as const }
      : {}),
    isResolved: getBoolean(discussionMap, "isResolved") ?? false,
    updatedAt: getString(discussionMap, "updatedAt") ?? "",
    userId: getString(discussionMap, "userId") ?? "",
  });

  return parsed.success && parsed.data.comments.length > 0 ? parsed.data : null;
}

function readDiscussionsById(discussionsById: Y.Map<unknown>): TDiscussion[] {
  const discussions: DocumentDiscussion[] = [];

  for (const [discussionId, discussionValue] of discussionsById.entries()) {
    if (!(discussionValue instanceof Y.Map)) continue;

    const discussion = readDiscussionMap(discussionId, discussionValue);
    if (!discussion || discussion.comments.length === 0) continue;

    discussions.push(discussion);
  }

  const parsed = documentDiscussionListSchema.safeParse(
    discussions.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  );

  return parsed.success ? toEditorDiscussions(parsed.data) : [];
}

function ensureDiscussionsById(reviewMap: Y.Map<unknown>): Y.Map<unknown> {
  reviewMap.set(DOCUMENT_REVIEW_VERSION_KEY, DOCUMENT_REVIEW_VERSION);

  const value = reviewMap.get(DOCUMENT_DISCUSSIONS_BY_ID_KEY);
  if (value instanceof Y.Map) return value as Y.Map<unknown>;

  const discussionsById = new Y.Map<unknown>();
  reviewMap.set(DOCUMENT_DISCUSSIONS_BY_ID_KEY, discussionsById);

  return discussionsById;
}

function seedDiscussionsById(reviewMap: Y.Map<unknown>, discussions: TDiscussion[]) {
  const discussionsById = ensureDiscussionsById(reviewMap);

  Array.from(discussionsById.keys()).forEach((key) => discussionsById.delete(key));
  discussions.forEach((discussion) => {
    discussionsById.set(discussion.id, createDiscussionMap(discussion));
  });

  return discussionsById;
}

function updateDiscussionTimestamp(discussionMap: DiscussionYMap, updatedAt: Date | string) {
  discussionMap.set("updatedAt", toIsoTimestamp(updatedAt));
}

function applyDiscussionActionToYjs(discussionsById: Y.Map<unknown>, action: DiscussionAction) {
  switch (action.type) {
    case "createThread": {
      discussionsById.set(action.discussion.id, createDiscussionMap(action.discussion));
      return;
    }

    case "addComment": {
      const discussionValue = discussionsById.get(action.discussionId);
      if (!(discussionValue instanceof Y.Map)) return;

      const commentsById = discussionValue.get(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY);
      if (!(commentsById instanceof Y.Map)) return;

      commentsById.set(action.comment.id, createCommentMap(action.comment));
      updateDiscussionTimestamp(discussionValue, action.comment.updatedAt);
      return;
    }

    case "updateComment": {
      const discussionValue = discussionsById.get(action.discussionId);
      if (!(discussionValue instanceof Y.Map)) return;

      const commentsById = discussionValue.get(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY);
      if (!(commentsById instanceof Y.Map)) return;

      const commentValue = commentsById.get(action.commentId);
      if (!(commentValue instanceof Y.Map)) return;

      commentValue.set("contentRich", Array.isArray(action.contentRich) ? action.contentRich : []);
      commentValue.set("isEdited", true);
      commentValue.set("updatedAt", toIsoTimestamp(action.updatedAt));
      updateDiscussionTimestamp(discussionValue, action.updatedAt);
      return;
    }

    case "deleteComment": {
      const discussionValue = discussionsById.get(action.discussionId);
      if (!(discussionValue instanceof Y.Map)) return;

      const commentsById = discussionValue.get(DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY);
      if (!(commentsById instanceof Y.Map)) return;

      commentsById.delete(action.commentId);
      if (commentsById.size === 0) {
        discussionsById.delete(action.discussionId);
        return;
      }

      updateDiscussionTimestamp(discussionValue, new Date());
      return;
    }

    case "resolveThread": {
      const discussionValue = discussionsById.get(action.discussionId);
      if (!(discussionValue instanceof Y.Map)) return;

      discussionValue.set("isResolved", true);
      updateDiscussionTimestamp(discussionValue, action.updatedAt);
      return;
    }

    case "deleteThread": {
      discussionsById.delete(action.discussionId);
      return;
    }
  }
}

export function useEditorDiscussionsBridge(editor: PlateEditor, initialDiscussions: TDiscussion[]) {
  useEffect(() => {
    const ydoc = editor.getOptions(YjsPlugin).ydoc;
    const reviewMap = ydoc.getMap(DOCUMENT_REVIEW_MAP_NAME);
    let applyingRemote = false;
    let initialized = false;

    const syncEditorFromYjs = () => {
      const discussionsById = reviewMap.get(DOCUMENT_DISCUSSIONS_BY_ID_KEY);
      const nextDiscussions = discussionsById instanceof Y.Map ? readDiscussionsById(discussionsById) : [];

      applyingRemote = true;
      try {
        setEditorDiscussions(editor, nextDiscussions);
      } finally {
        applyingRemote = false;
      }
    };

    const initializeReviewState = () => {
      if (initialized) return;
      initialized = true;

      const discussionsById = reviewMap.get(DOCUMENT_DISCUSSIONS_BY_ID_KEY);

      if (discussionsById instanceof Y.Map) {
        syncEditorFromYjs();
        return;
      }

      ydoc.transact(() => {
        seedDiscussionsById(reviewMap, initialDiscussions);
      });
      setEditorDiscussions(editor, initialDiscussions);
    };

    setEditorDiscussions(editor, initialDiscussions);

    editor.setOption(discussionPlugin, "onDiscussionAction", (action) => {
      if (applyingRemote) return;

      ydoc.transact(() => {
        applyDiscussionActionToYjs(ensureDiscussionsById(reviewMap), action);
      });
    });

    const unsubscribeSync = subscribeEditorYjsSync(editor, ({ isSynced, type }) => {
      if (isSynced && type !== "indexeddb") initializeReviewState();
    });

    if (editor.getOption(YjsPlugin, "_isSynced")) {
      initializeReviewState();
    }

    reviewMap.observeDeep(syncEditorFromYjs);

    return () => {
      reviewMap.unobserveDeep(syncEditorFromYjs);
      unsubscribeSync();
      editor.setOption(discussionPlugin, "onDiscussionAction", null);
    };
  }, [editor, initialDiscussions]);
}
