// 提供可在主线程或 Web Worker 中运行的版本预算、Diff 计算和上下文投影能力。
import { computeDiff } from '@platejs/diff';
import { KEYS, type EditorApi, type TElement, type TText, type Value } from 'platejs';

export type EditorVersionValueEstimate = {
  bytes: number;
  nodes: number;
};

export type EditorVersionValueBudget = {
  maxBytes: number;
  maxNodes: number;
};

export type EditorVersionDiffSegment = {
  endIndex: number;
  omittedAfter: number;
  omittedBefore: number;
  startIndex: number;
  value: Value;
};

export const EDITOR_VERSION_DIFF_INPUT_BUDGET: EditorVersionValueBudget = {
  maxBytes: 5 * 1024 * 1024,
  maxNodes: 50_000,
};

export const EDITOR_VERSION_DIFF_RESULT_BUDGET: EditorVersionValueBudget = {
  maxBytes: 10 * 1024 * 1024,
  maxNodes: 100_000,
};

const editorVersionInlineTypes: ReadonlySet<string> = new Set([
  KEYS.inlineEquation,
  KEYS.link,
  KEYS.mention,
]);

export function isEditorVersionInlineNode<N extends TElement | TText>(node: N) {
  return (
    'type' in node &&
    typeof node.type === 'string' &&
    editorVersionInlineTypes.has(node.type)
  );
}

export function cloneEditorVersionValue(value: Value): Value {
  return structuredClone(value);
}

export function estimateEditorVersionValue(value: Value): EditorVersionValueEstimate {
  let nodes = 0;
  const visit = (input: unknown) => {
    if (!input || typeof input !== 'object') return;
    nodes += 1;
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    Object.values(input).forEach(visit);
  };
  visit(value);
  return {
    bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
    nodes,
  };
}

export function isEditorVersionValueWithinBudget(
  value: Value,
  budget: EditorVersionValueBudget
) {
  const estimate = estimateEditorVersionValue(value);

  return estimate.nodes <= budget.maxNodes && estimate.bytes <= budget.maxBytes;
}

export function isEditorVersionDiffWithinBudget({
  previous,
  current,
  budget = EDITOR_VERSION_DIFF_INPUT_BUDGET,
}: {
  previous: Value;
  current: Value;
  budget?: EditorVersionValueBudget;
}) {
  return (
    isEditorVersionValueWithinBudget(previous, budget) &&
    isEditorVersionValueWithinBudget(current, budget)
  );
}

const isDiffOperation = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;

  const type = (value as { type?: unknown }).type;
  return type === 'delete' || type === 'insert' || type === 'update';
};

export function hasEditorVersionDiff(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  if (
    'diffOperation' in value &&
    isDiffOperation((value as { diffOperation?: unknown }).diffOperation)
  ) {
    return true;
  }

  if (Array.isArray(value)) return value.some(hasEditorVersionDiff);

  return Object.values(value).some(hasEditorVersionDiff);
}

export function getEditorVersionDiffSegments(
  value: Value,
  { contextBlocks = 1 }: { contextBlocks?: number } = {}
): EditorVersionDiffSegment[] {
  const context = Math.max(0, Math.floor(contextBlocks));
  const windows = value.flatMap((node, index) => {
    if (!hasEditorVersionDiff(node)) return [];

    return [
      {
        endIndex: Math.min(value.length, index + context + 1),
        startIndex: Math.max(0, index - context),
      },
    ];
  });

  if (windows.length === 0) return [];

  const mergedWindows: Array<{ endIndex: number; startIndex: number }> = [];

  windows.forEach((window) => {
    const previous = mergedWindows.at(-1);

    if (previous && window.startIndex <= previous.endIndex) {
      previous.endIndex = Math.max(previous.endIndex, window.endIndex);
      return;
    }

    mergedWindows.push({ ...window });
  });

  return mergedWindows.map((window, index) => {
    const previousEnd = mergedWindows[index - 1]?.endIndex ?? 0;
    const nextStart = mergedWindows[index + 1]?.startIndex ?? value.length;

    return {
      ...window,
      omittedBefore: window.startIndex - previousEnd,
      omittedAfter: nextStart - window.endIndex,
      value: value.slice(window.startIndex, window.endIndex),
    };
  });
}

export function computeEditorVersionDiffCore(input: {
  previous: Value;
  current: Value;
  isInline?: EditorApi['isInline'];
  lineBreakChar?: string;
}): Value {
  return computeDiff(
    cloneEditorVersionValue(input.previous),
    cloneEditorVersionValue(input.current),
    {
      isInline: input.isInline ?? isEditorVersionInlineNode,
      lineBreakChar: input.lineBreakChar ?? '¶',
    }
  ) as Value;
}
