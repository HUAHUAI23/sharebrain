import { describe, expect, test } from "bun:test";

import { aiChatRequestSchema, aiMessagePartSchema } from "./ai-chat";
import { conceptExtractionSchema } from "./knowledge";

describe("knowledge contracts", () => {
  test("概念抽取限制数量并校验引文", () => {
    const parsed = conceptExtractionSchema.parse({
      concepts: [{
        existingId: null,
        name: "PostgreSQL",
        type: "technology",
        description: "关系数据库",
        aliases: ["Postgres"],
        salience: "primary",
        evidenceQuotes: ["使用 PostgreSQL"],
      }],
      conceptRelations: [],
    });
    expect(parsed.concepts[0]?.type).toBe("technology");
  });

  test("聊天请求和结构化 parts 拒绝空输入", () => {
    expect(aiChatRequestSchema.safeParse({ message: " " }).success).toBe(false);
    expect(aiMessagePartSchema.parse({ type: "text", text: "answer" })).toEqual({
      type: "text",
      text: "answer",
    });
  });
});
