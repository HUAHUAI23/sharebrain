import { YjsPlugin } from "@platejs/yjs/react";
import {
  DOCUMENT_DISCUSSIONS_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  documentDiscussionListSchema,
  type DocumentDiscussion,
} from "@sharebrain/contracts";
import {
  discussionPlugin,
  setEditorDiscussions,
  type TDiscussion,
} from "@sharebrain/editor";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { useEffect } from "react";
import type { YMapEvent } from "yjs";

function toIsoTimestamp(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toSerializableDiscussions(discussions: TDiscussion[]): DocumentDiscussion[] {
  return discussions.map((discussion) => ({
    id: discussion.id,
    comments: discussion.comments.map((comment) => ({
      id: comment.id,
      contentRich: Array.isArray(comment.contentRich) ? comment.contentRich : [],
      createdAt: toIsoTimestamp(comment.createdAt),
      discussionId: comment.discussionId,
      isEdited: comment.isEdited,
      userId: comment.userId,
    })),
    createdAt: toIsoTimestamp(discussion.createdAt),
    ...(discussion.documentContent ? { documentContent: discussion.documentContent } : {}),
    isResolved: discussion.isResolved,
    userId: discussion.userId,
  }));
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
      userId: comment.userId,
    })),
    createdAt: discussion.createdAt,
    ...(discussion.documentContent ? { documentContent: discussion.documentContent } : {}),
    isResolved: discussion.isResolved,
    userId: discussion.userId,
  }));
}

function parseStoredDiscussions(value: unknown): TDiscussion[] {
  const parsed = documentDiscussionListSchema.safeParse(value);
  return parsed.success ? toEditorDiscussions(parsed.data) : [];
}

function discussionSnapshot(discussions: TDiscussion[]) {
  return JSON.stringify(toSerializableDiscussions(discussions));
}

export function useEditorDiscussionsBridge(editor: PlateEditor, initialDiscussions: TDiscussion[]) {
  useEffect(() => {
    const initialSnapshot = discussionSnapshot(initialDiscussions);
    const ydoc = editor.getOptions(YjsPlugin).ydoc;
    const reviewMap = ydoc.getMap(DOCUMENT_REVIEW_MAP_NAME);
    const remoteValue = reviewMap.get(DOCUMENT_DISCUSSIONS_KEY);
    const remoteDiscussions = parseStoredDiscussions(remoteValue);
    const remoteSnapshot = discussionSnapshot(remoteDiscussions);
    const snapshotRef = { current: remoteValue === undefined ? initialSnapshot : remoteSnapshot };
    let applyingRemote = false;

    setEditorDiscussions(
      editor,
      remoteValue === undefined ? initialDiscussions : remoteDiscussions,
      { notify: false },
    );

    editor.setOption(discussionPlugin, "onDiscussionsChange", (nextDiscussions) => {
      if (applyingRemote) return;

      const nextSerializable = toSerializableDiscussions(nextDiscussions);
      const nextSnapshot = JSON.stringify(nextSerializable);

      if (nextSnapshot === snapshotRef.current) return;

      snapshotRef.current = nextSnapshot;
      ydoc.transact(() => {
        reviewMap.set(DOCUMENT_DISCUSSIONS_KEY, nextSerializable);
      });
    });

    const handleReviewChange = (event: YMapEvent<unknown>) => {
      if (!event.keysChanged.has(DOCUMENT_DISCUSSIONS_KEY)) return;

      const nextDiscussions = parseStoredDiscussions(reviewMap.get(DOCUMENT_DISCUSSIONS_KEY));
      const nextSnapshot = discussionSnapshot(nextDiscussions);

      if (nextSnapshot === snapshotRef.current) return;

      snapshotRef.current = nextSnapshot;
      applyingRemote = true;
      try {
        setEditorDiscussions(editor, nextDiscussions, { notify: false });
      } finally {
        applyingRemote = false;
      }
    };

    reviewMap.observe(handleReviewChange);

    return () => {
      reviewMap.unobserve(handleReviewChange);
      editor.setOption(discussionPlugin, "onDiscussionsChange", null);
    };
  }, [editor, initialDiscussions]);
}
