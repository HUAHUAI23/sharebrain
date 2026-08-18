// 为有界知识图生成确定性力导向坐标，供 SVG 视图和单元测试共享。
import type { KnowledgeGraph } from "@sharebrain/contracts";

export type PositionedKnowledgeNode = KnowledgeGraph["nodes"][number] & {
  x: number;
  y: number;
};

export function layoutKnowledgeGraph(
  graph: KnowledgeGraph,
  width = 900,
  height = 520,
): PositionedKnowledgeNode[] {
  if (graph.nodes.length === 0) return [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.32;
  const nodes = graph.nodes.map((node, index) => {
    const angle = (index / graph.nodes.length) * Math.PI * 2 + hashUnit(node.id) * 0.4;
    const typeRadius = node.type === "concept" ? radius * 0.58 : radius;
    return {
      ...node,
      x: centerX + Math.cos(angle) * typeRadius,
      y: centerY + Math.sin(angle) * typeRadius,
    };
  });
  const byId = new Map(nodes.map((node, index) => [node.id, index]));

  for (let iteration = 0; iteration < 72; iteration += 1) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        if (!a || !b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSquared = Math.max(64, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const strength = 1500 / distanceSquared;
        const fx = (dx / distance) * strength;
        const fy = (dy / distance) * strength;
        forces[left]!.x += fx;
        forces[left]!.y += fy;
        forces[right]!.x -= fx;
        forces[right]!.y -= fy;
      }
    }
    for (const edge of graph.edges) {
      const sourceIndex = byId.get(edge.sourceId);
      const targetIndex = byId.get(edge.targetId);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      const source = nodes[sourceIndex]!;
      const target = nodes[targetIndex]!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ideal = edge.relation === "mentions" ? 92 : 118;
      const strength = (distance - ideal) * 0.0025 * Math.max(0.25, edge.weight);
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      forces[sourceIndex]!.x += fx;
      forces[sourceIndex]!.y += fy;
      forces[targetIndex]!.x -= fx;
      forces[targetIndex]!.y -= fy;
    }
    const cooling = 1 - iteration / 90;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      const force = forces[index]!;
      force.x += (centerX - node.x) * 0.0015;
      force.y += (centerY - node.y) * 0.0015;
      node.x = clamp(node.x + force.x * cooling, 28, width - 28);
      node.y = clamp(node.y + force.y * cooling, 28, height - 28);
    }
  }
  return nodes;
}

function hashUnit(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
