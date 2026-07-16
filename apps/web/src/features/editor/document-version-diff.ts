// 管理可取消的大文档 Diff Worker 生命周期，并向历史内容组件暴露稳定状态。
import type { EditorVersionDiffSegment } from "@sharebrain/editor/version-history-core";
import type { Value } from "platejs";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DocumentVersionDiffRequest,
  DocumentVersionDiffResponse,
} from "./document-version-diff.worker-core";

type DocumentVersionDiffState =
  | { status: "idle" }
  | { status: "computing" }
  | { status: "limited" }
  | { status: "error" }
  | {
      durationMs: number;
      segments: EditorVersionDiffSegment[];
      status: "ready";
    };

let nextRequestId = 1;
const documentVersionDiffTimeoutMs = 15_000;

export function useDocumentVersionDiff({
  current,
  enabled,
  previous,
}: {
  current: Value;
  enabled: boolean;
  previous?: Value;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DocumentVersionDiffState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !previous) {
      setState({ status: "idle" });
      return;
    }

    if (typeof Worker === "undefined") {
      setState({ status: "error" });
      return;
    }

    const requestId = nextRequestId++;
    const worker = new Worker(
      new URL("./document-version-diff.worker.ts", import.meta.url),
      { type: "module" },
    );
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setState({ status: "error" });
      worker.terminate();
    }, documentVersionDiffTimeoutMs);

    setState({ status: "computing" });
    worker.addEventListener("message", (event: MessageEvent<DocumentVersionDiffResponse>) => {
      if (!active || event.data.requestId !== requestId) return;

      active = false;
      window.clearTimeout(timeout);
      if (event.data.status === "ready") {
        setState({
          status: "ready",
          durationMs: event.data.durationMs,
          segments: event.data.segments,
        });
      } else if (event.data.status === "limited") {
        setState({ status: "limited" });
      } else {
        setState({ status: "error" });
      }
      worker.terminate();
    });
    worker.addEventListener("error", () => {
      if (!active) return;
      active = false;
      window.clearTimeout(timeout);
      setState({ status: "error" });
      worker.terminate();
    });

    const request: DocumentVersionDiffRequest = { requestId, previous, current };
    worker.postMessage(request);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      worker.terminate();
    };
  }, [attempt, current, enabled, previous]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return useMemo(() => ({ ...state, retry }), [retry, state]);
}
