import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY,
  DOCUMENT_DISCUSSIONS_BY_ID_KEY,
  DOCUMENT_COMMENT_MARK_PREFIX,
  DOCUMENT_REVIEW_MAP_NAME,
  type DocumentDiscussionList,
} from "@sharebrain/contracts";
import * as Y from "yjs";

import { extractDocumentCommentIds, readDocumentReviewDiscussions } from "./document-store";

const userId = "00000000-0000-4000-9000-000000000001";

function toYMap(value: Record<string, unknown>) {
  const map = new Y.Map<unknown>();

  Object.entries(value).forEach(([key, entryValue]) => {
    map.set(key, entryValue);
  });

  return map;
}

function createDocWithDiscussions(discussions: DocumentDiscussionList | unknown) {
  const ydoc = new Y.Doc();
  const discussionsById = new Y.Map<unknown>();

  const parsedDiscussions = Array.isArray(discussions)
    ? (discussions as DocumentDiscussionList)
    : null;

  if (parsedDiscussions) {
    parsedDiscussions.forEach((discussion) => {
      const commentsById = new Y.Map<unknown>();

      discussion.comments.forEach((comment) => {
        commentsById.set(comment.id, toYMap(comment as unknown as Record<string, unknown>));
      });

      discussionsById.set(
        discussion.id,
        toYMap({
          ...discussion,
          [DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY]: commentsById,
        } as unknown as Record<string, unknown>),
      );
    });
  } else {
    discussionsById.set("malformed", discussions);
  }

  ydoc.getMap(DOCUMENT_REVIEW_MAP_NAME).set(DOCUMENT_DISCUSSIONS_BY_ID_KEY, discussionsById);
  return ydoc;
}

describe("document review state", () => {
  test("returns an empty discussion list when the review map is empty", () => {
    expect(readDocumentReviewDiscussions(new Y.Doc())).toEqual([]);
  });

  test("parses valid review discussions from the Yjs document", () => {
    const now = new Date().toISOString();
    const discussions: DocumentDiscussionList = [
      {
        id: "discussion-1",
        comments: [
          {
            id: "comment-1",
            contentRich: [{ type: "p", children: [{ text: "hello" }] }],
            createdAt: now,
            discussionId: "discussion-1",
            isEdited: false,
            updatedAt: now,
            userId,
          },
        ],
        createdAt: now,
        isResolved: false,
        updatedAt: now,
        userId,
      },
    ];

    expect(readDocumentReviewDiscussions(createDocWithDiscussions(discussions))).toEqual(discussions);
  });

  test("returns null for malformed review discussions", () => {
    expect(readDocumentReviewDiscussions(createDocWithDiscussions({ id: "" }))).toBeNull();
  });

  test("filters discussions whose comment mark is no longer present in document content", () => {
    const now = new Date().toISOString();
    const discussions: DocumentDiscussionList = [
      {
        id: "discussion-present",
        comments: [
          {
            id: "comment-present",
            contentRich: [{ type: "p", children: [{ text: "hello" }] }],
            createdAt: now,
            discussionId: "discussion-present",
            isEdited: false,
            updatedAt: now,
            userId,
          },
        ],
        createdAt: now,
        isResolved: false,
        updatedAt: now,
        userId,
      },
      {
        id: "discussion-orphan",
        comments: [
          {
            id: "comment-orphan",
            contentRich: [{ type: "p", children: [{ text: "orphan" }] }],
            createdAt: now,
            discussionId: "discussion-orphan",
            isEdited: false,
            updatedAt: now,
            userId,
          },
        ],
        createdAt: now,
        isResolved: false,
        updatedAt: now,
        userId,
      },
    ];
    const plateJson = [
      {
        type: "p",
        children: [{ text: "hello", [`${DOCUMENT_COMMENT_MARK_PREFIX}discussion-present`]: true }],
      },
    ];

    expect(
      readDocumentReviewDiscussions(createDocWithDiscussions(discussions), {
        presentCommentIds: extractDocumentCommentIds(plateJson),
      }),
    ).toEqual(discussions.slice(0, 1));
  });
});
