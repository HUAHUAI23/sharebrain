// 验证版本正文投影、确定性 hash、游标和 restore 协议的稳定行为。
import { describe, expect, test } from "bun:test";

import {
  createDocumentVersionRestoreOperationSchema,
  decodeDocumentVersionCursor,
  documentVersionOperationSchema,
  encodeDocumentVersionCursor,
  hashDocumentVersionValue,
  projectDocumentVersionValue,
} from "./document-version";

describe("document version projection", () => {
  test("removes review and diff metadata while preserving visible content", async () => {
    const source = [
      {
        type: "p",
        diff: true,
        diffOperation: { type: "insert" },
        children: [
          { text: "kept", bold: true, comment_thread: true, comment_draft: true },
          {
            text: "inserted",
            suggestion: true,
            suggestion_insert: { id: "insert", type: "insert", userId: "user" },
          },
          {
            text: "removed",
            suggestion: true,
            suggestion_remove: { id: "remove", type: "remove", userId: "user" },
          },
        ],
      },
    ];

    const projected = projectDocumentVersionValue(source);
    expect(projected).toEqual([
      {
        children: [{ bold: true, text: "kept" }, { text: "inserted" }],
        type: "p",
      },
    ]);
    expect(source[0]!.diff).toBe(true);
    expect(await hashDocumentVersionValue(source)).toHaveLength(64);
  });

  test("produces the same hash for different object key order", async () => {
    const first = [{ type: "p", children: [{ text: "same", bold: true }] }];
    const second = [{ children: [{ bold: true, text: "same" }], type: "p" }];
    expect(await hashDocumentVersionValue(first)).toBe(await hashDocumentVersionValue(second));
  });

  test("normalizes root text leaves into renderable Plate blocks", () => {
    expect(projectDocumentVersionValue([{ text: "legacy root" }])).toEqual([
      { type: "p", children: [{ text: "legacy root" }] },
    ]);
  });

  test("rejects cycles and configured limits", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => projectDocumentVersionValue(cyclic)).toThrow("循环引用");
    expect(() => projectDocumentVersionValue([{ text: "too large" }], { maxBytes: 4 })).toThrow(
      "字节数超限",
    );
  });
});

describe("document version transport contracts", () => {
  test("round trips opaque cursors", () => {
    expect(decodeDocumentVersionCursor(encodeDocumentVersionCursor(42))).toBe(42);
    expect(() => decodeDocumentVersionCursor("invalid!")).toThrow("DOCUMENT_VERSION_CURSOR_INVALID");
  });

  test("limits restore state vectors", () => {
    const base = {
      requestId: "00000000-0000-4000-8000-000000000001",
      baseStateVector: "AQID",
    };
    expect(createDocumentVersionRestoreOperationSchema.parse(base).force).toBe(false);
    expect(() =>
      createDocumentVersionRestoreOperationSchema.parse({ ...base, baseStateVector: "not base64!" }),
    ).toThrow();
  });

  test("supports version and activity restore sources", () => {
    const base = {
      operationId: "00000000-0000-4000-8000-000000000001",
      status: "pending",
      beforeVersionNo: null,
      resultVersionNo: null,
      errorCode: null,
      expiresAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    expect(
      documentVersionOperationSchema.parse({
        ...base,
        sourceKind: "activity",
        sourceVersionNo: null,
        sourceActivityEventId: "00000000-0000-4000-8000-000000000002",
      }).sourceKind,
    ).toBe("activity");
  });
});
