// 接收版本正文并把受预算约束的 Diff 上下文片段返回给历史工作区。
import {
  computeDocumentVersionDiff,
  type DocumentVersionDiffRequest,
} from "./document-version-diff.worker-core";

self.addEventListener("message", (event: MessageEvent<DocumentVersionDiffRequest>) => {
  self.postMessage(computeDocumentVersionDiff(event.data));
});
