import { describe, expect, test } from "bun:test";

import { loadServerEnv, resolveAiChatDebugTrace } from "./index";

describe("AI chat debug trace configuration", () => {
  test("defaults to off and forces production off", () => {
    const env = loadServerEnv({ NODE_ENV: "production" });
    expect(env.AI_CHAT_DEBUG_TRACE).toBe("off");
    expect(resolveAiChatDebugTrace({
      NODE_ENV: "production",
      AI_CHAT_DEBUG_TRACE: "full",
    })).toBe("off");
  });

  test("keeps safe and full levels outside production", () => {
    expect(resolveAiChatDebugTrace({
      NODE_ENV: "development",
      AI_CHAT_DEBUG_TRACE: "safe",
    })).toBe("safe");
    expect(resolveAiChatDebugTrace({
      NODE_ENV: "test",
      AI_CHAT_DEBUG_TRACE: "full",
    })).toBe("full");
  });
});
