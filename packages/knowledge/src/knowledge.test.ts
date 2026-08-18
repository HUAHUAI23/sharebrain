import { describe, expect, test } from "bun:test";

import {
  chunkPlateDocument,
  estimateTokens,
  feedbackMultiplier,
  isConceptStopword,
  normalizeConceptName,
  reciprocalRankFuse,
  toSimpleTsQuery,
  tokenizeForSearch,
  tokenizeQueryTerms,
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

  test("自然语言提问剥掉疑问词和功能词", () => {
    expect(tokenizeQueryTerms("容器健康检查怎么配置？")).toEqual(["容器", "健康", "检查", "配置"]);
    expect(tokenizeQueryTerms("How do I configure the readiness probe?"))
      .toEqual(["configure", "readiness", "probe"]);
  });

  test("全是功能词时保留原始词，不返回空查询", () => {
    expect(tokenizeQueryTerms("这是什么")).toEqual(["这", "是", "什么"]);
  });

  test("any 模式让整句提问不会因为一个词落空", () => {
    expect(toSimpleTsQuery("容器健康检查怎么配置")).toBe("容器 & 健康 & 检查 & 配置");
    expect(toSimpleTsQuery("容器健康检查怎么配置", "any")).toBe("容器 | 健康 | 检查 | 配置");
  });

  test("tsquery 元字符不会漏进查询串", () => {
    expect(toSimpleTsQuery("redis&nginx !k8s (pg)")).toBe("redis & nginx & k8s & pg");
  });

  test("查询端与索引端对同一个技术词给出同一串 token", () => {
    const indexed = tokenizeForSearch("registry.example/app:v1.2");
    for (const term of tokenizeQueryTerms("registry.example")) {
      expect(indexed).toContain(term);
    }
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

  test("重叠尾部不夺走后一块的章节路径和锚点", () => {
    const chunks = chunkPlateDocument({
      projectName: "P",
      documentTitle: "D",
      value: [
        { id: "h1", type: "h1", children: [{ text: "第一章" }] },
        { id: "p1", type: "p", children: [{ text: "部署内容".repeat(60) }] },
        { id: "h2", type: "h1", children: [{ text: "第二章" }] },
        { id: "p2", type: "p", children: [{ text: "监控内容".repeat(60) }] },
      ],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.headingPath).toEqual(["第二章"]);
    expect(chunks[1]?.blockIds).toEqual(["h2", "p2"]);
    expect(chunks[1]?.embedText).toContain("章节：第二章");
    // 重叠正文仍然保留，只是不再算作本块的归属。
    expect(chunks[1]?.content).toContain("部署内容");
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
