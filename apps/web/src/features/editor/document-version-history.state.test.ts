// 验证版本历史的默认检查模式和移动端导航转换。
import { describe, expect, test } from "bun:test";

import {
  CURRENT_DOCUMENT_VERSION_KEY,
  createInitialDocumentVersionHistoryState,
  documentVersionHistoryReducer,
} from "./document-version-history.state";
import { computeDocumentVersionDiff } from "./document-version-diff.worker-core";

describe("document version history state", () => {
  test("opens the current content at the version list", () => {
    expect(createInitialDocumentVersionHistoryState()).toEqual({
      selectedKey: CURRENT_DOCUMENT_VERSION_KEY,
      mode: "preview",
      mobilePane: "list",
    });
  });

  test("opens a selected historical version directly in changes", () => {
    expect(createInitialDocumentVersionHistoryState("version-2")).toEqual({
      selectedKey: "version-2",
      mode: "changes",
      mobilePane: "content",
    });
  });

  test("uses changes for historical selections and preview for current content", () => {
    const historical = documentVersionHistoryReducer(
      createInitialDocumentVersionHistoryState(),
      { type: "select", key: "version-3" },
    );
    expect(historical).toEqual({
      selectedKey: "version-3",
      mode: "changes",
      mobilePane: "content",
    });

    expect(
      documentVersionHistoryReducer(historical, {
        type: "select",
        key: CURRENT_DOCUMENT_VERSION_KEY,
      }),
    ).toEqual({
      selectedKey: CURRENT_DOCUMENT_VERSION_KEY,
      mode: "preview",
      mobilePane: "content",
    });
  });
});

describe("document version diff worker", () => {
  test("returns only changed block context for valid large inputs", () => {
    const previous = Array.from({ length: 120 }, (_, index) => ({
      type: "p",
      children: [{ text: `Block ${index}` }],
    }));
    const current = structuredClone(previous);
    current[60]!.children[0]!.text = "Changed";

    const result = computeDocumentVersionDiff({
      requestId: 1,
      previous,
      current,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.startIndex).toBe(55);
    expect(result.segments[0]?.endIndex).toBe(66);
  });

  test("reports no segments when the versions are equivalent", () => {
    const value = [{ type: "p", children: [{ text: "Same" }] }];
    const result = computeDocumentVersionDiff({
      requestId: 2,
      previous: value,
      current: structuredClone(value),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.segments).toEqual([]);
  });
});
