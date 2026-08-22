// 消费 AI SDK UI-message SSE，并把 scope、引用、run 与正文增量转换为稳定回调。
import type {
  AiAssistantRun,
  AiCitation,
  AiChatDebugTrace,
  AiChatRequest,
  AiRunStep,
  KnowledgeScope,
} from "@sharebrain/contracts";

import { ApiClientError } from "../../lib/api-client";
import { runtimeEnv } from "../../lib/runtime-env";

export type KnowledgeChatStreamHandlers = {
  onRun?: (run: Pick<AiAssistantRun, "id" | "conversationId" | "status">) => void;
  onScope?: (scope: KnowledgeScope) => void;
  onStep?: (step: AiRunStep) => void;
  onCitations?: (citations: AiCitation[]) => void;
  onDebug?: (trace: AiChatDebugTrace) => void;
  onText?: (delta: string) => void;
  onFinish?: (usage: Record<string, unknown>) => void;
  onError?: (error: { code: string; message: string }) => void;
};

export async function streamKnowledgeChat(
  input: AiChatRequest,
  handlers: KnowledgeChatStreamHandlers,
  signal?: AbortSignal,
) {
  return consumeKnowledgeChatStream("/api/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  }, handlers);
}

export async function retryKnowledgeChat(
  runId: string,
  handlers: KnowledgeChatStreamHandlers,
  signal?: AbortSignal,
) {
  return consumeKnowledgeChatStream(`/api/ai/runs/${runId}/retry`, {
    method: "POST",
    credentials: "include",
    ...(signal ? { signal } : {}),
  }, handlers);
}

async function consumeKnowledgeChatStream(
  path: string,
  init: RequestInit,
  handlers: KnowledgeChatStreamHandlers,
) {
  const response = await fetch(`${runtimeEnv.WEB_PUBLIC_API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      code?: string;
      message?: string;
      details?: unknown;
    } | null;
    throw new ApiClientError(
      payload?.code ?? "CHAT_REQUEST_FAILED",
      payload?.message ?? "Chat request failed",
      payload?.details,
    );
  }
  if (!response.body) throw new ApiClientError("CHAT_STREAM_MISSING", "Chat stream is unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) dispatchUiStreamLine(line, handlers);
    if (done) break;
  }
  if (buffer) dispatchUiStreamLine(buffer, handlers);
}

export function dispatchUiStreamLine(
  line: string,
  handlers: KnowledgeChatStreamHandlers,
) {
  if (!line.startsWith("data: ")) return;
  const value = line.slice(6).trim();
  if (!value || value === "[DONE]") return;
  let chunk: Record<string, unknown>;
  try {
    chunk = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return;
  }
  if (chunk.type === "data-run") {
    handlers.onRun?.(chunk.data as Pick<AiAssistantRun, "id" | "conversationId" | "status">);
  } else if (chunk.type === "data-scope") {
    handlers.onScope?.(chunk.data as KnowledgeScope);
  } else if (chunk.type === "data-step") {
    handlers.onStep?.(chunk.data as AiRunStep);
  } else if (chunk.type === "data-citations") {
    handlers.onCitations?.(chunk.data as AiCitation[]);
  } else if (chunk.type === "data-debug") {
    handlers.onDebug?.(chunk.data as AiChatDebugTrace);
  } else if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
    handlers.onText?.(chunk.delta);
  } else if (chunk.type === "data-finish") {
    const data = chunk.data as { usage?: Record<string, unknown> } | undefined;
    handlers.onFinish?.(data?.usage ?? {});
  } else if (chunk.type === "data-error") {
    handlers.onError?.(chunk.data as { code: string; message: string });
  }
}
