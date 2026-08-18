import { describe, expect, test } from "bun:test";

import {
  chunkPlateDocument,
  estimateTokens,
  feedbackMultiplier,
  isConceptStopword,
  normalizeConceptName,
  reciprocalRankFuse,
  tokenizeForSearch,
} from "./index";

describe("knowledge text primitives", () => {
  test("中文 token 不再按英文四字符估算", () => {
    expect(estimateTokens("中文知识")).toBe(6);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  test("索引和查询共享稳定分词", () => {
    const value = tokenizeForSearch("容器健康检查 React 19");
    expect(value).toContain("容器");
    expect(value).toContain("react");
    expect(value).toContain("19");
  });

  test("概念规范化统一全半角、空格和括号后缀", () => {
    expect(normalizeConceptName("Ｋ8s 集群（旧称）")).toBe("k8s集群");
    expect(isConceptStopword("配置")).toBe(true);
  });
});

describe("chunkPlateDocument", () => {
  test("标题路径和稳定 block id 进入 chunk", () => {
    const chunks = chunkPlateDocument({
      projectName: "ShareBrain",
      documentTitle: "部署",
      value: [
        { id: "heading", type: "h1", children: [{ text: "容器" }] },
        { id: "paragraph", type: "p", children: [{ text: "健康检查配置" }] },
      ],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toEqual(["容器"]);
    expect(chunks[0]?.blockIds).toEqual(["heading", "paragraph"]);
    expect(chunks[0]?.embedText).toContain("项目：ShareBrain");
  });

  test("超长代码块保持单块并显式标记截断", () => {
    const chunks = chunkPlateDocument(
      {
        projectName: "P",
        documentTitle: "D",
        value: [{ id: "code", type: "code_block", children: [{ text: "中".repeat(200) }] }],
      },
      { maxTokens: 40 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata.truncated).toBe(true);
    expect(chunks[0]?.tokenCount).toBeLessThanOrEqual(40);
  });

  test("旧文档缺失节点 id 时插入前置块不会改变既有 block id", () => {
    const input = {
      projectName: "P",
      documentTitle: "D",
      value: [
        { type: "p", children: [{ text: "第一段" }] },
        { type: "p", children: [{ text: "第二段" }] },
      ],
    };
    const before = chunkPlateDocument(input)[0]?.blockIds ?? [];
    const after = chunkPlateDocument({
      ...input,
      value: [{ type: "p", children: [{ text: "新段落" }] }, ...input.value],
    })[0]?.blockIds ?? [];

    expect(after.slice(1)).toEqual(before);
  });
});

describe("retrieval math", () => {
  test("反馈使用贝叶斯平滑", () => {
    expect(feedbackMultiplier(0, 0)).toBe(1);
    expect(feedbackMultiplier(0, 1)).toBeGreaterThanOrEqual(0.8);
  });

  test("RRF 合并不同量纲的排名", () => {
    const scores = reciprocalRankFuse([
      [{ id: "a", rank: 1 }, { id: "b", rank: 2 }],
      [{ id: "b", rank: 1 }],
    ]);
    expect(scores.get("b") ?? 0).toBeGreaterThan(scores.get("a") ?? 0);
  });
});
