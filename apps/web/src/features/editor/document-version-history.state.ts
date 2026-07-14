// 固化历史工作区允许的选择、显示模式和移动端主从导航转换。
export const CURRENT_DOCUMENT_VERSION_KEY = "current";

export type DocumentVersionHistoryState = {
  selectedKey: string;
  mode: "preview" | "changes";
  mobilePane: "list" | "content";
};

export type DocumentVersionHistoryAction =
  | { type: "select"; key: string }
  | { type: "set-mode"; mode: DocumentVersionHistoryState["mode"] }
  | { type: "show-list" };

export function createInitialDocumentVersionHistoryState(
  selectedKey = CURRENT_DOCUMENT_VERSION_KEY,
): DocumentVersionHistoryState {
  const historical = selectedKey !== CURRENT_DOCUMENT_VERSION_KEY;
  return {
    selectedKey,
    mode: historical ? "changes" : "preview",
    mobilePane: historical ? "content" : "list",
  };
}

export const initialDocumentVersionHistoryState = createInitialDocumentVersionHistoryState();

export function documentVersionHistoryReducer(
  state: DocumentVersionHistoryState,
  action: DocumentVersionHistoryAction,
): DocumentVersionHistoryState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selectedKey: action.key,
        mode: action.key === CURRENT_DOCUMENT_VERSION_KEY ? "preview" : "changes",
        mobilePane: "content",
      };
    case "set-mode":
      return { ...state, mode: action.mode };
    case "show-list":
      return { ...state, mobilePane: "list" };
  }
}
