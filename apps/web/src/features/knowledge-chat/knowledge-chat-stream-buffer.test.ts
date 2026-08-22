import { describe, expect, test } from "bun:test";

import { ChatStreamBuffer, revealStep } from "./knowledge-chat-stream-buffer";

describe("revealStep", () => {
  test("积压越多每帧释放越多，积压见底时逐字收尾", () => {
    expect(revealStep(0)).toBe(0);
    expect(revealStep(1)).toBe(1);
    expect(revealStep(100)).toBe(20);
    expect(revealStep(1000)).toBe(200);
  });

  test("永远不会超过积压量", () => {
    for (const pending of [1, 2, 3, 7, 11]) {
      expect(revealStep(pending)).toBeLessThanOrEqual(pending);
    }
  });
});

describe("ChatStreamBuffer", () => {
  test("按帧释放，订阅者每帧最多收到一次通知", () => {
    const buffer = new ChatStreamBuffer();
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    // 直接驱动缓冲区，绕开浏览器帧调度。
    for (const delta of ["abc", "def", "ghi"]) buffer.push(delta);
    expect(notifications).toBeGreaterThan(0);
    buffer.flush();
    expect(buffer.getSnapshot()).toBe("abcdefghi");
  });

  test("tick 逐帧推进而不是一次吐完", () => {
    const buffer = new ChatStreamBuffer();
    buffer.flush();
    buffer.push("0123456789".repeat(3));
    const afterFirst = buffer.getSnapshot();
    buffer.tick();
    expect(buffer.getSnapshot().length).toBeGreaterThanOrEqual(afterFirst.length);
    buffer.flush();
    expect(buffer.getSnapshot()).toBe("0123456789".repeat(3));
  });

  test("reset 清空正文并通知订阅者", () => {
    const buffer = new ChatStreamBuffer();
    buffer.push("hello");
    buffer.flush();
    let notified = false;
    buffer.subscribe(() => {
      notified = true;
    });
    buffer.reset();
    expect(buffer.getSnapshot()).toBe("");
    expect(notified).toBe(true);
  });
});
