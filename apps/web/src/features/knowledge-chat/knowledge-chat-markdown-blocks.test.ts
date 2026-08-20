import { describe, expect, test } from "bun:test";

import { parseChatMarkdown } from "./knowledge-chat-markdown-blocks";

describe("parseChatMarkdown", () => {
  test("切出顶层块并丢掉纯空白块", () => {
    const tokens = parseChatMarkdown("# 标题\n\n段落\n\n- 一\n- 二\n");
    expect(tokens.map((token) => token.type)).toEqual(["heading", "paragraph", "list"]);
  });

  test("已完成的块在续写后 raw 保持不变，记忆化才能生效", () => {
    const first = parseChatMarkdown("第一段\n\n第二");
    const second = parseChatMarkdown("第一段\n\n第二段还在写");
    expect(second[0]?.raw).toBe(first[0]?.raw);
    expect(second[1]?.raw).not.toBe(first[1]?.raw);
  });

  test("流式中途的未闭合围栏按代码块兜底，不抛错", () => {
    const tokens = parseChatMarkdown("说明\n\n```ts\nconst a = 1;");
    expect(tokens.map((token) => token.type)).toEqual(["paragraph", "code"]);
  });

  test("空正文返回空数组", () => {
    expect(parseChatMarkdown("")).toEqual([]);
  });
});
