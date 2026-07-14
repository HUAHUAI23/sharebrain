// 验证版本历史的默认检查模式和移动端导航转换。
import { describe, expect, test } from "bun:test";

import {
  CURRENT_DOCUMENT_VERSION_KEY,
  createInitialDocumentVersionHistoryState,
  documentVersionHistoryReducer,
} from "./document-version-history.state";

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
