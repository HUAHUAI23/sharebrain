// 工作过程：进行中是一行带秒表的活动指示，完成后折叠成一句结论，可展开回看每一步。
import type { AiRunStep } from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { ChevronRight } from "lucide-react";
import { memo, useEffect, useState } from "react";

const STEP_LABEL: Record<AiRunStep["kind"], () => string> = {
  scope: () => m.chat_step_scope(),
  recall: () => m.chat_step_recall(),
  graph: () => m.chat_step_graph(),
  context: () => m.chat_step_context(),
  generation: () => m.chat_step_generation(),
};

function stepDetail(step: AiRunStep): string | null {
  const detail = step.detail;
  switch (step.kind) {
    case "scope":
      return detail.projectName ?? m.chat_scope_global();
    case "recall":
      return step.status === "running" ? null : m.chat_step_recall_detail({
        fts: detail.ftsCount ?? 0,
        vector: detail.vectorCount ?? 0,
        concept: detail.conceptCount ?? 0,
      });
    case "graph":
      return m.chat_step_graph_detail({ count: detail.graphCount ?? 0 });
    case "context":
      return step.status === "running" ? null : m.chat_step_context_detail({
        count: detail.citationCount ?? 0,
        tokens: detail.tokenCount ?? 0,
      });
    default:
      return null;
  }
}

/** 进行中的步骤没有耗时可显示，用本地秒表补上，否则界面看起来就是卡死的。 */
function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return seconds;
}

function StatusDot({ status }: { status: AiRunStep["status"] }) {
  if (status === "running") {
    return (
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-foreground/40" />
        <span className="relative size-1.5 rounded-full bg-foreground/70" />
      </span>
    );
  }
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${status === "failed" ? "bg-destructive" : "bg-border"}`}
      aria-hidden
    />
  );
}

function formatSeconds(ms: number) {
  return (ms / 1000).toFixed(1);
}

export const ChatSteps = memo(function ChatSteps({ steps }: { steps: AiRunStep[] }) {
  const running = steps.some((step) => step.status === "running");
  const elapsed = useElapsedSeconds(running);
  if (steps.length === 0) return null;

  const failed = steps.some((step) => step.status === "failed");
  const totalMs = steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const current = [...steps].reverse().find((step) => step.status === "running");
  const sources = steps.find((step) => step.kind === "context")?.detail.citationCount ?? 0;

  const summary = running
    ? m.chat_steps_running({ label: STEP_LABEL[current?.kind ?? "scope"](), seconds: String(elapsed) })
    : failed
      ? m.chat_steps_failed()
      : m.chat_steps_done({ count: sources, seconds: formatSeconds(totalMs) });

  return (
    // 进行中强制展开；结束后不再传 open，用户自己的折叠选择得以保留。
    <details className="group mb-2" {...(running ? { open: true } : {})}>
      <summary className="-mx-1 flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-1 py-1 text-[12px] text-muted-foreground hover:bg-muted/60">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        <StatusDot status={running ? "running" : failed ? "failed" : "complete"} />
        <span className="truncate">{summary}</span>
      </summary>
      {/* 左侧细线把过程与正文在视觉上分开，不用边框盒子，减轻重量 */}
      <ol className="mt-1 ml-2.5 grid gap-1.5 border-l border-border pl-3.5">
        {steps.map((step) => {
          const detail = stepDetail(step);
          return (
            <li className="flex min-w-0 items-center gap-2 text-[12px] leading-5" key={step.kind}>
              <StatusDot status={step.status} />
              <span className="shrink-0 text-foreground">{STEP_LABEL[step.kind]()}</span>
              {detail ? <span className="truncate text-muted-foreground">{detail}</span> : null}
              {step.status !== "running" && step.durationMs !== null ? (
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
                  {step.durationMs}ms
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
});
