// 把网络增量与画面刷新解耦：网络想多快就多快，画面每帧最多变一次。
const MIN_REVEAL_CHARS = 2;
const REVEAL_DIVISOR = 5;

/**
 * 每帧释放积压的一部分而不是全部：
 * 积压多时追得快，积压少时逐字出，provider 成块吐字也能显示得均匀。
 */
export function revealStep(pendingLength: number): number {
  if (pendingLength <= 0) return 0;
  return Math.min(pendingLength, Math.max(MIN_REVEAL_CHARS, Math.ceil(pendingLength / REVEAL_DIVISOR)));
}

type Listener = () => void;

/**
 * 一次流式回答的正文缓冲。刻意不做成 React state：
 * 订阅者只有正在流式输出的那一个气泡，面板和会话列表不会跟着每帧重渲染。
 */
export class ChatStreamBuffer {
  private visible = "";
  private pending = "";
  private frame: number | null = null;
  private readonly listeners = new Set<Listener>();

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.visible;

  push(delta: string) {
    if (!delta) return;
    this.pending += delta;
    this.schedule();
  }

  /** 立即显示全部积压内容，用于流结束或组件卸载前的收尾。 */
  flush() {
    this.cancel();
    if (!this.pending) return;
    this.visible += this.pending;
    this.pending = "";
    this.emit();
  }

  reset() {
    this.cancel();
    this.visible = "";
    this.pending = "";
    this.emit();
  }

  /** 推进一帧。导出给测试直接驱动，无需依赖浏览器的 rAF。 */
  tick() {
    this.frame = null;
    const step = revealStep(this.pending.length);
    if (step === 0) return;
    this.visible += this.pending.slice(0, step);
    this.pending = this.pending.slice(step);
    this.emit();
    if (this.pending.length > 0) this.schedule();
  }

  private schedule() {
    // 没有帧调度（测试、SSR）时不做平滑，直接全量显示，避免无限递归。
    if (typeof requestAnimationFrame !== "function") {
      this.visible += this.pending;
      this.pending = "";
      this.emit();
      return;
    }
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private cancel() {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
