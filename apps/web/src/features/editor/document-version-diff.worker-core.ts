// 在 Worker 中执行版本预算、Diff 计算和变更上下文投影，保持主线程可响应。
import {
  EDITOR_VERSION_DIFF_RESULT_BUDGET,
  computeEditorVersionDiffCore,
  getEditorVersionDiffSegments,
  isEditorVersionDiffWithinBudget,
  isEditorVersionValueWithinBudget,
  type EditorVersionDiffSegment,
} from "@sharebrain/editor/version-history-core";
import type { Value } from "platejs";

export type DocumentVersionDiffRequest = {
  current: Value;
  previous: Value;
  requestId: number;
};

export type DocumentVersionDiffResponse =
  | {
      durationMs: number;
      requestId: number;
      segments: EditorVersionDiffSegment[];
      status: "ready";
    }
  | {
      reason: "input" | "result";
      requestId: number;
      status: "limited";
    }
  | {
      requestId: number;
      status: "error";
    };

export function computeDocumentVersionDiff(
  request: DocumentVersionDiffRequest,
): DocumentVersionDiffResponse {
  if (
    !isEditorVersionDiffWithinBudget({
      previous: request.previous,
      current: request.current,
    })
  ) {
    return { requestId: request.requestId, status: "limited", reason: "input" };
  }

  try {
    const startedAt = performance.now();
    const value = computeEditorVersionDiffCore({
      previous: request.previous,
      current: request.current,
    });

    if (!isEditorVersionValueWithinBudget(value, EDITOR_VERSION_DIFF_RESULT_BUDGET)) {
      return { requestId: request.requestId, status: "limited", reason: "result" };
    }

    return {
      requestId: request.requestId,
      status: "ready",
      durationMs: performance.now() - startedAt,
      segments: getEditorVersionDiffSegments(value),
    };
  } catch {
    return { requestId: request.requestId, status: "error" };
  }
}
