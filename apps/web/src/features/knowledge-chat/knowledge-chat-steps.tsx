// 渲染一次回答的工作过程。进行中默认展开，完成后自动折叠成一行摘要，可点开回看。
import type { AiRunStep } from "@sharebrain/contracts";
import { m } from "@sharebrain/i18n";
import { Check, ChevronRight, CircleAlert, Loader2 } from "lucide-react";
import { memo } from "react";

const STEP_LABEL: Record<AiRunStep["kind"], () => string> = {
  scope: () => m.chat_step_scope(),
  recall: () => m.chat_step_recall(),
  graph: () => m.chat_step_graph(),
  context: () => m.chat_step_context(),
  generation: () => m.chat_step_generation(),
};

function stepDetail(step: AiRunStep): string | null {
  const detail = step.detail;
  if (step.status === "running") return null;
  switch (step.kind) {
    case "scope":
      return detail.projectName ?? m.chat_scope_global();
    case "recall":
      return m.chat_step_recall_detail({
        fts: detail.ftsCount ?? 0,
        vector: detail.vectorCount ?? 0,
        concept: detail.conceptCount ?? 0,
      });
    case "graph":
      return m.chat_step_graph_detail({ count: detail.graphCount ?? 0 });
    case "context":
      return m.chat_step_context_detail({
        count: detail.citationCount ?? 0,
        tokens: detail.tokenCount ?? 0,
      });
    default:
      return null;
  }
}

function StepIcon({ status }: { status: AiRunStep["status"] }) {
  if (status === "running") {
    // 唯一的持续动画，只作用在 12px 图标上，面积可忽略。
    return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "failed") return <CircleAlert className="size-3 shrink-0 text-destructive" />;
  return <Check className="size-3 shrink-0 text-muted-foreground" />;
}

export const ChatSteps = memo(function ChatSteps({ steps }: { steps: AiRunStep[] }) {
  if (steps.length === 0) return null;
  const running = steps.some((step) => step.status === "running");
  const failed = steps.some((step) => step.status === "failed");
  const totalMs = steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);

  return (
    // 进行中由 open 强制展开；结束后不再传 open，用户自己的折叠状态就能保留。
    <details className="group mt-2 rounded-md border border-border bg-muted/20" {...(running ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        <StepIcon status={running ? "running" : failed ? "failed" : "complete"} />
        <span className="truncate font-medium">
          {running
            ? STEP_LABEL[steps[steps.length - 1]?.kind ?? "scope"]()
            : m.chat_steps_summary({ count: steps.length, seconds: (totalMs / 1000).toFixed(1) })}
        </span>
      </summary>
      <ol className="grid gap-1.5 border-t border-border px-2.5 py-2">
        {steps.map((step) => {
          const detail = stepDetail(step);
          return (
            <li className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4" key={step.kind}>
              <StepIcon status={step.status} />
              <span className="shrink-0 text-foreground">{STEP_LABEL[step.kind]()}</span>
              {detail ? <span className="truncate text-muted-foreground">{detail}</span> : null}
              {step.durationMs !== null && step.status !== "running" ? (
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
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
