// 记录一次回答的工作过程。同一份步骤既落库供历史回放，也可选地推给正在监听的流。
import type { AiRunStep, AiRunStepKind } from "@sharebrain/contracts";

type StepDetail = AiRunStep["detail"];
type StepSink = (step: AiRunStep) => void;

/**
 * 两个下游互不知情：`persist` 负责事实，`publish` 负责实时。
 * 后台恢复的 run 没有客户端连着，省略 `publish` 即可，其余逻辑完全一致。
 */
export class RunStepTrail {
  private readonly startedAt = new Map<AiRunStepKind, number>();

  constructor(
    private readonly persist: (step: AiRunStep) => Promise<void>,
    private readonly publish?: StepSink,
  ) {}

  async start(kind: AiRunStepKind, detail: StepDetail = {}) {
    this.startedAt.set(kind, Date.now());
    await this.emit({ kind, status: "running", detail, durationMs: null });
  }

  async complete(kind: AiRunStepKind, detail: StepDetail = {}) {
    await this.emit({ kind, status: "complete", detail, durationMs: this.elapsed(kind) });
  }

  async fail(kind: AiRunStepKind, detail: StepDetail = {}) {
    await this.emit({ kind, status: "failed", detail, durationMs: this.elapsed(kind) });
  }

  /** 步骤是可观测信息，不是回答本身：记录失败绝不能把整条回答带崩。 */
  private async emit(step: AiRunStep) {
    this.publish?.(step);
    try {
      await this.persist(step);
    } catch (error) {
      console.error(JSON.stringify({
        event: "ai.run_step_persist_failed",
        kind: step.kind,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }

  private elapsed(kind: AiRunStepKind) {
    const startedAt = this.startedAt.get(kind);
    return startedAt === undefined ? 0 : Date.now() - startedAt;
  }
}
