// 验证活动块差异的稳定 ID、旧文档兼容、净变化压缩和摘要预算。
import { describe, expect, test } from "bun:test";

import {
  diffDocumentActivityBlocks,
  DOCUMENT_ACTIVITY_LIMITS,
  documentActivityActorSchema,
  documentActivityDetailSchema,
  mergeDocumentContentActivityDetails,
} from "./document-activity";

describe("document activity contracts", () => {
  test("tracks inserted, updated and deleted blocks by stable id", () => {
    const details = diffDocumentActivityBlocks(
      [
        { id: "a", type: "p", children: [{ text: "before" }] },
        { id: "b", type: "p", children: [{ text: "delete" }] },
      ],
      [
        { id: "a", type: "p", children: [{ text: "after" }] },
        { id: "c", type: "h2", children: [{ text: "insert" }] },
      ],
    );

    expect(details.changes.map(({ blockId, kind }) => ({ blockId, kind }))).toEqual([
      { blockId: "a", kind: "updated" },
      { blockId: "c", kind: "inserted" },
      { blockId: "b", kind: "deleted" },
    ]);
  });

  test("does not report id backfill as a semantic edit", () => {
    const details = diffDocumentActivityBlocks(
      [{ type: "p", children: [{ text: "same" }] }],
      [{ id: "stable", type: "p", children: [{ text: "same" }] }],
    );

    expect(details.changes).toEqual([]);
  });

  test("removes a session change when the block returns to its original value", () => {
    const initial = [{ id: "a", type: "p", children: [{ text: "initial" }] }];
    const changed = [{ id: "a", type: "p", children: [{ text: "changed" }] }];
    const first = diffDocumentActivityBlocks(initial, changed);
    const reverted = diffDocumentActivityBlocks(changed, initial);

    expect(mergeDocumentContentActivityDetails(first, reverted).changes).toEqual([]);
  });

  test("truncates stored excerpts and change lists", () => {
    const details = diffDocumentActivityBlocks(
      [],
      Array.from({ length: DOCUMENT_ACTIVITY_LIMITS.changesPerEvent + 3 }, (_, index) => ({
        id: `block-${index}`,
        type: "p",
        children: [{ text: "x".repeat(DOCUMENT_ACTIVITY_LIMITS.excerptCharacters + 10) }],
      })),
    );

    expect(details.totalChangedBlocks).toBe(DOCUMENT_ACTIVITY_LIMITS.changesPerEvent + 3);
    expect(details.changes).toHaveLength(DOCUMENT_ACTIVITY_LIMITS.changesPerEvent);
    expect(details.changes[0]?.after?.text).toHaveLength(
      DOCUMENT_ACTIVITY_LIMITS.excerptCharacters,
    );
    expect(details.truncated).toBe(true);
  });

  test("accepts server-owned relative avatar media URLs", () => {
    expect(
      documentActivityActorSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Activity editor",
        avatarUrl: "/api/media/00000000-0000-4000-8000-000000000002/raw",
      }).avatarUrl,
    ).toBe("/api/media/00000000-0000-4000-8000-000000000002/raw");
  });

  test("represents inspectable open activity without allowing restore", () => {
    const detail = documentActivityDetailSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      type: "content_edited",
      status: "open",
      actor: {
        id: "00000000-0000-4000-8000-000000000002",
        displayName: "Editor",
        avatarUrl: null,
      },
      startedAt: "2026-07-14T00:00:00.000Z",
      occurredAt: "2026-07-14T00:00:01.000Z",
      details: { kind: "content", changes: [], totalChangedBlocks: 1, truncated: true },
      inspectable: true,
      restorable: false,
      beforeValue: [],
      afterValue: [{ type: "p", children: [{ text: "after" }] }],
      beforeContentHash: null,
      afterContentHash: null,
      formatVersion: 1,
      unavailableMediaCount: 0,
    });
    expect(detail.restorable).toBe(false);
  });
});
