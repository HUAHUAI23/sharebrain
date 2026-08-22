// 验证关系图布局可复现，并始终把节点约束在稳定画布内。
import { describe, expect, test } from "bun:test";
import type { KnowledgeGraph } from "@sharebrain/contracts";

import { layoutKnowledgeGraph } from "./knowledge-graph-layout";

const graph: KnowledgeGraph = {
  nodes: [
    { id: "00000000-0000-4000-8000-000000000001", type: "concept", label: "健康检查", projectId: null, weight: 1 },
    { id: "00000000-0000-4000-8000-000000000002", type: "document", label: "探针手册", projectId: "00000000-0000-4000-8000-000000000004", weight: 1 },
    { id: "00000000-0000-4000-8000-000000000003", type: "project", label: "平台项目", projectId: "00000000-0000-4000-8000-000000000004", weight: 1 },
  ],
  edges: [{
    id: "00000000-0000-4000-8000-000000000005",
    sourceId: "00000000-0000-4000-8000-000000000002",
    targetId: "00000000-0000-4000-8000-000000000001",
    relation: "mentions",
    weight: 1,
    status: "active",
  }],
  truncated: false,
};

describe("knowledge graph layout", () => {
  test("is deterministic and bounded", () => {
    const first = layoutKnowledgeGraph(graph, 640, 360);
    const second = layoutKnowledgeGraph(graph, 640, 360);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    for (const node of first) {
      expect(node.x).toBeGreaterThanOrEqual(28);
      expect(node.x).toBeLessThanOrEqual(612);
      expect(node.y).toBeGreaterThanOrEqual(28);
      expect(node.y).toBeLessThanOrEqual(332);
    }
  });
});
