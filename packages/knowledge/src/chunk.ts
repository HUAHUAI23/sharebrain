import { estimateTokens, truncateToTokenBudget } from "./tokens";

export type KnowledgeChunk = {
  blockIds: string[];
  chunkIndex: number;
  content: string;
  embedText: string;
  headingPath: string[];
  metadata: { truncated?: boolean };
  tokenCount: number;
};

export type ChunkDocumentInput = {
  documentTitle: string;
  projectName: string;
  value: unknown;
};

type TextBlock = {
  blockId: string;
  content: string;
  headingPath: string[];
  isolated: boolean;
  truncated: boolean;
  tokenCount: number;
};

type ChunkOptions = {
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
};

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  heading_one: 1,
  heading_two: 2,
  heading_three: 3,
};
const ISOLATED_TYPES = new Set(["code_block", "codeblock", "table"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableBlockFingerprint(type: string, text: string) {
  let hash = 0x811c9dc5;
  const input = `${type}\0${text}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function extractPlateText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractPlateText).filter(Boolean).join("\n");
  }
  if (!isRecord(value)) return "";

  const ownText = typeof value.text === "string" ? value.text : "";
  const children = extractPlateText(value.children);
  return ownText && children ? `${ownText}${children}` : ownText || children;
}

function toBlocks(value: unknown, maxTokens: number): TextBlock[] {
  if (!Array.isArray(value)) return [];

  const headings: string[] = [];
  const blocks: TextBlock[] = [];
  const fallbackOccurrences = new Map<string, number>();
  value.forEach((node) => {
    if (!isRecord(node)) return;
    const type = typeof node.type === "string" ? node.type : "paragraph";
    const text = extractPlateText(node).replace(/\n{3,}/gu, "\n\n").trim();
    if (!text) return;

    const level = HEADING_LEVELS[type];
    if (level) {
      headings.splice(level - 1);
      headings[level - 1] = text;
    }

    const isolated = ISOLATED_TYPES.has(type);
    const tokenCount = estimateTokens(text);
    const truncated = isolated && tokenCount > maxTokens;
    const content = truncated ? truncateToTokenBudget(text, maxTokens) : text;
    const rawId = node.id;
    const fingerprint = stableBlockFingerprint(type, text);
    const occurrence = (fallbackOccurrences.get(fingerprint) ?? 0) + 1;
    fallbackOccurrences.set(fingerprint, occurrence);
    blocks.push({
      blockId: typeof rawId === "string" && rawId
        ? rawId
        : `legacy-${fingerprint}-${occurrence}`,
      content,
      headingPath: [...headings],
      isolated,
      truncated,
      tokenCount: estimateTokens(content),
    });
  });
  return blocks;
}

// `blocks` 是进入正文的全部块（含前一组带过来的重叠尾部），`ownBlocks` 才是本块自己的内容。
// 章节路径、锚点和截断标记只能取自 ownBlocks：重叠块属于上一节，用它会把章节标错一节。
function buildChunk(
  input: ChunkDocumentInput,
  blocks: TextBlock[],
  ownBlocks: TextBlock[],
  chunkIndex: number,
): KnowledgeChunk {
  const headingPath = ownBlocks[0]?.headingPath ?? [];
  const content = blocks.map((block) => block.content).join("\n\n");
  const prefix = [
    `项目：${input.projectName}`,
    `文档：${input.documentTitle}`,
    headingPath.length > 0 ? `章节：${headingPath.join(" > ")}` : "",
  ].filter(Boolean).join("\n");

  return {
    blockIds: [...new Set(ownBlocks.map((block) => block.blockId))],
    chunkIndex,
    content,
    embedText: `${prefix}\n\n${content}`,
    headingPath,
    metadata: ownBlocks.some((block) => block.truncated) ? { truncated: true } : {},
    tokenCount: estimateTokens(content),
  };
}

export function chunkPlateDocument(
  input: ChunkDocumentInput,
  options: ChunkOptions = {},
): KnowledgeChunk[] {
  const maxTokens = options.maxTokens ?? 800;
  const minTokens = options.minTokens ?? 120;
  const overlapTokens = options.overlapTokens ?? 100;
  const blocks = toBlocks(input.value, maxTokens);
  if (blocks.length === 0) return [];

  const groups: TextBlock[][] = [];
  let current: TextBlock[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
    currentTokens = 0;
  };

  for (const block of blocks) {
    const headingChanged = current.length > 0 && block.headingPath.join("\0") !== current[0]?.headingPath.join("\0");
    if (block.isolated) {
      flush();
      groups.push([block]);
      continue;
    }
    if (current.length > 0 && (currentTokens + block.tokenCount > maxTokens || headingChanged)) {
      flush();
    }
    current.push(block);
    currentTokens += block.tokenCount;
  }
  flush();

  for (let index = groups.length - 1; index > 0; index -= 1) {
    const group = groups[index];
    const previous = groups[index - 1];
    if (!group || !previous || group.some((block) => block.isolated)) continue;
    const total = group.reduce((sum, block) => sum + block.tokenCount, 0);
    const previousTotal = previous.reduce((sum, block) => sum + block.tokenCount, 0);
    if (total < minTokens && previousTotal + total <= maxTokens) {
      previous.push(...group);
      groups.splice(index, 1);
    }
  }

  return groups.map((group, index) => {
    if (index === 0 || group.some((block) => block.isolated)) {
      return buildChunk(input, group, group, index);
    }
    const previous = groups[index - 1] ?? [];
    const overlap: TextBlock[] = [];
    let overlapTotal = 0;
    for (let blockIndex = previous.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = previous[blockIndex];
      if (!block || block.isolated || overlapTotal >= overlapTokens) break;
      overlap.unshift(block);
      overlapTotal += block.tokenCount;
    }
    return buildChunk(input, [...overlap, ...group], group, index);
  });
}
