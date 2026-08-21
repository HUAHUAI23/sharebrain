// 验证 UI-message 流中自定义数据和标准正文增量的解析边界。
import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";

import {
  dispatchUiStreamLine,
  retryKnowledgeChat,
} from "./knowledge-chat.client";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("knowledge chat stream parser", () => {
  test("dispatches scope, citations and text without treating control lines as content", () => {
    const events: string[] = [];
    dispatchUiStreamLine(
      'data: {"type":"data-scope","data":{"activeProjectId":null,"resolution":"none","projectName":null,"ambiguousProjects":[]}}',
      { onScope: () => events.push("scope") },
    );
    dispatchUiStreamLine(
      'data: {"type":"data-citations","data":[]}',
      { onCitations: () => events.push("citations") },
    );
    dispatchUiStreamLine(
      'data: {"type":"text-delta","id":"message","delta":"answer"}',
      { onText: (value) => events.push(value) },
    );
    dispatchUiStreamLine("data: [DONE]", { onText: () => events.push("done") });
    expect(events).toEqual(["scope", "citations", "answer"]);
  });

  test("dispatches finish usage and structured stream errors", () => {
    const events: unknown[] = [];
    dispatchUiStreamLine(
      'data: {"type":"data-finish","data":{"usage":{"totalTokens":42}}}',
      { onFinish: (usage) => events.push(usage) },
    );
    dispatchUiStreamLine(
      'data: {"type":"data-error","data":{"code":"MODEL_FAILED","message":"retry later"}}',
      { onError: (error) => events.push(error) },
    );

    expect(events).toEqual([
      { totalTokens: 42 },
      { code: "MODEL_FAILED", message: "retry later" },
    ]);
  });

  test("dispatches optional debug trace without treating it as answer text", () => {
    const traces: unknown[] = [];
    dispatchUiStreamLine(
      'data: {"type":"data-debug","data":{"level":"safe","queryTerms":["readiness","probe"]}}',
      { onDebug: (trace) => traces.push(trace) },
    );
    expect(traces).toEqual([{ level: "safe", queryTerms: ["readiness", "probe"] }]);
  });

  test("posts retry requests and parses chunked UI-message events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"data-run","data":{"id":"run-1","status":"running"}}\n' +
              'data: {"type":"text-delta","delta":"ret',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'ried"}\ndata: {"type":"data-finish","data":{"usage":{"totalTokens":7}}}\ndata: [DONE]\n',
          ),
        );
        controller.close();
      },
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const events: unknown[] = [];

    await retryKnowledgeChat("run-1", {
      onRun: (run) => events.push(run),
      onText: (delta) => events.push(delta),
      onFinish: (usage) => events.push(usage),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/ai/runs/run-1/retry");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(events).toEqual([
      { id: "run-1", status: "running" },
      "retried",
      { totalTokens: 7 },
    ]);
  });
});
