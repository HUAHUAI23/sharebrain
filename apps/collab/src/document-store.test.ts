import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_DISCUSSIONS_KEY,
  DOCUMENT_REVIEW_MAP_NAME,
  type DocumentDiscussionList,
} from "@sharebrain/contracts";
import * as Y from "yjs";

import { readDocumentReviewDiscussions } from "./document-store";

const userId = "00000000-0000-4000-9000-000000000001";

function createDocWithDiscussions(discussions: unknown) {
  const ydoc = new Y.Doc();
  ydoc.getMap(DOCUMENT_REVIEW_MAP_NAME).set(DOCUMENT_DISCUSSIONS_KEY, discussions);
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
            userId,
          },
        ],
        createdAt: now,
        isResolved: false,
        userId,
      },
    ];

    expect(readDocumentReviewDiscussions(createDocWithDiscussions(discussions))).toEqual(discussions);
  });

  test("returns null for malformed review discussions", () => {
    expect(readDocumentReviewDiscussions(createDocWithDiscussions([{ id: "" }]))).toBeNull();
  });
});
