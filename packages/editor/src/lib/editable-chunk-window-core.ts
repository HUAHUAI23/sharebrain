// 隔离 Slate chunk tree 的版本相关结构，并提供可测试的窗口范围与高度估算。
import { isValidElement, type ReactNode } from 'react';
import { ElementApi, NodeApi, type TElement } from 'platejs';

export const EDITABLE_CHUNK_WINDOW_OVERSCAN_PX = 1_600;
export const EDITABLE_CHUNK_ESTIMATE_SCALE = 1.5;

export type EditableChunkBlockPath = {
  id: string;
  path: number[];
};

export type EditableChunkTopLevelBlock = EditableChunkBlockPath & {
  complex: boolean;
  estimatedHeight: number;
  review: boolean;
};

export type EditableChunkDescriptor = {
  blockPaths: EditableChunkBlockPath[];
  containsComplexContent: boolean;
  containsReviewContent: boolean;
  endIndex: number;
  estimatedHeight: number;
  key: string;
  previewText: string;
  startIndex: number;
  topLevelBlocks: EditableChunkTopLevelBlock[];
};

export type EditableChunkRange = Pick<
  EditableChunkDescriptor,
  'endIndex' | 'startIndex'
>;

export type EditableVirtualDropBoundary = {
  boundaryIndex: number;
  offsetPx: number;
};

export type EditableVirtualDropTarget = {
  id: string;
  side: 'after' | 'before';
};

export type EditableVirtualDropMove = {
  finalIndex: number;
  to: number[];
};

type EditableChunkEstimatedBlock = Pick<
  EditableChunkTopLevelBlock,
  'estimatedHeight' | 'path'
>;

type PrivateSlateChunkLeaf = {
  index: number;
  node: unknown;
  type: 'leaf';
};

type PrivateSlateChunkChild = {
  props?: {
    ancestor?: {
      children?: unknown[];
      key?: {
        id?: unknown;
      };
    };
  };
};

type PrivateSlateChunk = {
  key: string | null;
  leaves: PrivateSlateChunkLeaf[];
};

export type EditableChunkSelectionLike = {
  anchor: { path: number[] };
  focus: { path: number[] };
};

export type EditableChunkSelectionRange = {
  endIndex: number;
  startIndex: number;
};

export type EditableChunkScrollAnchor = {
  ratio: number;
  viewportY: number;
};

const complexElementTypes = new Set([
  'audio',
  'code_block',
  'column',
  'column_group',
  'file',
  'img',
  'media_embed',
  'table',
  'toggle',
  'video',
]);

const isPrivateSlateChunkLeaf = (
  value: unknown
): value is PrivateSlateChunkLeaf =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'leaf' &&
      'index' in value &&
      typeof value.index === 'number' &&
      Number.isInteger(value.index) &&
      value.index >= 0 &&
      'node' in value &&
      ElementApi.isElement(value.node)
  );

const getPrivateSlateChunkLeaves = (
  children: ReactNode
): PrivateSlateChunk | null => {
  const child = Array.isArray(children)
    ? children.length === 1
      ? children[0]
      : null
    : children;

  if (!isValidElement(child)) return null;

  const ancestorChildren = (child as PrivateSlateChunkChild).props?.ancestor
    ?.children;

  if (
    !Array.isArray(ancestorChildren) ||
    ancestorChildren.length === 0 ||
    !ancestorChildren.every(isPrivateSlateChunkLeaf)
  ) {
    return null;
  }

  for (let index = 1; index < ancestorChildren.length; index += 1) {
    if (ancestorChildren[index]!.index !== ancestorChildren[index - 1]!.index + 1) {
      return null;
    }
  }

  const privateKey = (child as PrivateSlateChunkChild).props?.ancestor?.key?.id;

  return {
    key:
      typeof privateKey === 'string' || typeof privateKey === 'number'
        ? String(privateKey)
        : null,
    leaves: ancestorChildren,
  };
};

const collectBlockPaths = (
  node: TElement,
  path: number[],
  result: EditableChunkBlockPath[]
) => {
  if (typeof node.id !== 'string' || node.id.length === 0) return false;

  result.push({ id: node.id, path });

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];

    if (
      ElementApi.isElement(child) &&
      !collectBlockPaths(child, [...path, index], result)
    ) {
      return false;
    }
  }

  return true;
};

const hasReviewMetadata = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;

  if (
    Object.keys(value).some(
      (key) =>
        key.startsWith('comment_') || key === 'suggestion' || key === 'suggestions'
    )
  ) {
    return true;
  }

  if (!('children' in value) || !Array.isArray(value.children)) return false;

  return value.children.some(hasReviewMetadata);
};

const hasComplexElement = (value: unknown): boolean => {
  if (!ElementApi.isElement(value)) return false;

  if (
    typeof value.type === 'string' &&
    complexElementTypes.has(value.type)
  ) {
    return true;
  }

  return value.children.some(hasComplexElement);
};

const getWeightedTextLength = (text: string) => {
  let length = 0;

  for (const character of text) {
    length += character.codePointAt(0)! > 0xff ? 2 : 1;
  }

  return length;
};

const estimateEditableBlockHeightFromText = (
  node: TElement,
  text: string
) => {
  const lines = Math.max(
    1,
    text.split('\n').reduce((total, line) => {
      return total + Math.max(1, Math.ceil(getWeightedTextLength(line) / 96));
    }, 0)
  );
  const type = typeof node.type === 'string' ? node.type : 'p';

  if (type === 'h1') return Math.max(64, lines * 38 + 26);
  if (type === 'h2') return Math.max(56, lines * 34 + 20);
  if (type === 'h3') return Math.max(48, lines * 30 + 16);
  if (/^h[4-6]$/.test(type)) return Math.max(40, lines * 28 + 12);
  if (type === 'code_block') return Math.max(96, lines * 24 + 48);
  if (type === 'table') return Math.max(160, node.children.length * 44 + 24);
  if (['audio', 'file'].includes(type)) return 72;
  if (['img', 'media_embed', 'video'].includes(type)) return 360;

  return Math.max(32, lines * 28 + 8);
};

export function estimateEditableBlockHeight(node: TElement) {
  return estimateEditableBlockHeightFromText(node, NodeApi.string(node));
}

export function getEditableChunkDescriptor(
  children: ReactNode
): EditableChunkDescriptor | null {
  const privateChunk = getPrivateSlateChunkLeaves(children);

  if (!privateChunk) return null;

  const { key: privateKey, leaves } = privateChunk;
  const startIndex = leaves[0]!.index;
  const endIndex = leaves.at(-1)!.index + 1;
  const blockPaths: EditableChunkBlockPath[] = [];
  const topLevelBlocks: EditableChunkTopLevelBlock[] = [];
  const previewTextParts: string[] = [];
  let containsComplexContent = false;
  let containsReviewContent = false;
  let estimatedHeight = 0;

  for (const leaf of leaves) {
    const node = leaf.node as TElement;

    if (!collectBlockPaths(node, [leaf.index], blockPaths)) return null;

    const previewText = NodeApi.string(node);
    const blockEstimatedHeight = estimateEditableBlockHeightFromText(
      node,
      previewText
    );
    const complex = hasComplexElement(node);
    const review = hasReviewMetadata(node);

    estimatedHeight += blockEstimatedHeight;
    previewTextParts.push(previewText);
    containsComplexContent ||= complex;
    containsReviewContent ||= review;
    topLevelBlocks.push({
      complex,
      estimatedHeight: blockEstimatedHeight,
      id: node.id as string,
      path: [leaf.index],
      review,
    });
  }

  return {
    blockPaths,
    containsComplexContent,
    containsReviewContent,
    endIndex,
    estimatedHeight: Math.max(
      1,
      Math.ceil(estimatedHeight * EDITABLE_CHUNK_ESTIMATE_SCALE)
    ),
    // 旧文档可能包含重复 block ID。Slate 的 chunk key 在同一编辑器内稳定且
    // 唯一，可避免因为内容 ID 重复而让整个 chunk 退回常驻 DOM。
    key: privateKey ?? `${blockPaths[0]!.id}:${startIndex}:${endIndex}`,
    previewText: previewTextParts.join('\n'),
    startIndex,
    topLevelBlocks,
  };
}

export function getEditableChunkRange(
  children: ReactNode
): EditableChunkRange | null {
  const privateChunk = getPrivateSlateChunkLeaves(children);

  if (!privateChunk) return null;

  const { leaves } = privateChunk;

  return {
    endIndex: leaves.at(-1)!.index + 1,
    startIndex: leaves[0]!.index,
  };
}

export function getEditableChunkSelectionRange(
  selection: EditableChunkSelectionLike | null | undefined,
  adjacentBlocks = 1
): EditableChunkSelectionRange | null {
  const anchorIndex = selection?.anchor.path[0];
  const focusIndex = selection?.focus.path[0];

  if (!Number.isInteger(anchorIndex) || !Number.isInteger(focusIndex)) {
    return null;
  }

  const padding = Math.max(0, Math.floor(adjacentBlocks));
  return {
    endIndex: Math.max(anchorIndex!, focusIndex!) + padding + 1,
    startIndex: Math.max(0, Math.min(anchorIndex!, focusIndex!) - padding),
  };
}

export function selectionRangePinsEditableChunk(
  selectionRange: EditableChunkSelectionRange | null | undefined,
  descriptor: Pick<EditableChunkDescriptor, 'endIndex' | 'startIndex'>
) {
  if (!selectionRange) return false;

  return (
    descriptor.startIndex < selectionRange.endIndex &&
    descriptor.endIndex > selectionRange.startIndex
  );
}

export function selectionPinsEditableChunk(
  selection: EditableChunkSelectionLike | null | undefined,
  descriptor: Pick<EditableChunkDescriptor, 'endIndex' | 'startIndex'>,
  adjacentBlocks = 1
) {
  return selectionRangePinsEditableChunk(
    getEditableChunkSelectionRange(selection, adjacentBlocks),
    descriptor
  );
}

export type EditableChunkRenderMode = 'content' | 'placeholder' | 'preview';

export function getEditableChunkHydrationOrder<
  T extends Pick<EditableChunkDescriptor, 'key' | 'startIndex'>,
>(chunks: readonly T[], primaryKey?: string) {
  const primaryIndex = chunks.find(
    (chunk) => chunk.key === primaryKey
  )?.startIndex;

  return [...chunks].sort((left, right) => {
    if (primaryIndex !== undefined) {
      const leftDistance = Math.abs(left.startIndex - primaryIndex);
      const rightDistance = Math.abs(right.startIndex - primaryIndex);

      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }

    return left.startIndex - right.startIndex;
  });
}

export function isEditableChunkEligibleForPrehydration(
  descriptor: Pick<
    EditableChunkDescriptor,
    'containsComplexContent' | 'containsReviewContent' | 'estimatedHeight'
  >,
  maximumEstimatedHeight = 4_000
) {
  return (
    !descriptor.containsComplexContent &&
    !descriptor.containsReviewContent &&
    Number.isFinite(descriptor.estimatedHeight) &&
    descriptor.estimatedHeight > 0 &&
    descriptor.estimatedHeight <= Math.max(0, maximumEstimatedHeight)
  );
}

export function shouldPrehydrateEditableChunk({
  idleBudgetMs,
  minimumIdleBudgetMs = 6,
  minimumQuietDurationMs = 32,
  quietDurationMs,
  scrolling,
  settleDelayMs,
  settleSafetyMarginMs = 16,
}: {
  idleBudgetMs: number | null;
  minimumIdleBudgetMs?: number;
  minimumQuietDurationMs?: number;
  quietDurationMs: number;
  scrolling: boolean;
  settleDelayMs: number;
  settleSafetyMarginMs?: number;
}) {
  if (
    !scrolling ||
    !Number.isFinite(quietDurationMs) ||
    !Number.isFinite(settleDelayMs) ||
    !Number.isFinite(minimumQuietDurationMs) ||
    !Number.isFinite(minimumIdleBudgetMs) ||
    !Number.isFinite(settleSafetyMarginMs) ||
    quietDurationMs < Math.max(0, minimumQuietDurationMs) ||
    quietDurationMs >=
      Math.max(0, settleDelayMs - Math.max(0, settleSafetyMarginMs))
  ) {
    return false;
  }

  return (
    idleBudgetMs === null ||
    (Number.isFinite(idleBudgetMs) &&
      idleBudgetMs >= Math.max(0, minimumIdleBudgetMs))
  );
}

export function getEditableChunkRenderMode({
  enabled,
  first,
  forced,
  inViewport,
  interactionPinned,
  mounted,
  prehydrated,
  scrolling,
  selectionPinned,
}: {
  enabled: boolean;
  first: boolean;
  forced: boolean;
  inViewport: boolean;
  interactionPinned: boolean;
  mounted: boolean;
  prehydrated: boolean;
  scrolling: boolean;
  selectionPinned: boolean;
}): EditableChunkRenderMode {
  if (
    !enabled ||
    first ||
    forced ||
    interactionPinned ||
    selectionPinned
  ) {
    return 'content';
  }

  if (prehydrated && inViewport) return 'content';

  if (scrolling) {
    if (mounted) return 'content';
    return inViewport ? 'preview' : 'placeholder';
  }

  return inViewport ? 'content' : 'placeholder';
}

export function getEditableChunkScrollAnchor(
  rectangle: Pick<DOMRectReadOnly, 'height' | 'top'>,
  viewportY: number
): EditableChunkScrollAnchor | null {
  if (
    !Number.isFinite(rectangle.top) ||
    !Number.isFinite(rectangle.height) ||
    rectangle.height <= 0 ||
    !Number.isFinite(viewportY)
  ) {
    return null;
  }

  return {
    ratio: Math.min(
      1,
      Math.max(0, (viewportY - rectangle.top) / rectangle.height)
    ),
    viewportY,
  };
}

export function getEditableChunkScrollAdjustment(
  anchor: EditableChunkScrollAnchor,
  rectangle: Pick<DOMRectReadOnly, 'height' | 'top'>,
  tolerance = 0.5
): number | null {
  if (
    !Number.isFinite(anchor.ratio) ||
    !Number.isFinite(anchor.viewportY) ||
    !Number.isFinite(rectangle.top) ||
    !Number.isFinite(rectangle.height) ||
    rectangle.height <= 0
  ) {
    return null;
  }

  const adjustment =
    rectangle.top +
    rectangle.height * Math.min(1, Math.max(0, anchor.ratio)) -
    anchor.viewportY;

  return Math.abs(adjustment) <= Math.max(0, tolerance) ? 0 : adjustment;
}

export function getEditableChunkBlockPathAtOffset(
  blocks: readonly EditableChunkEstimatedBlock[],
  offsetY: number,
  renderedHeight: number
): number[] | null {
  if (
    blocks.length === 0 ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(renderedHeight) ||
    renderedHeight <= 0
  ) {
    return null;
  }

  const estimatedTotal = blocks.reduce(
    (total, block) =>
      total +
      (Number.isFinite(block.estimatedHeight) && block.estimatedHeight > 0
        ? block.estimatedHeight
        : 1),
    0
  );
  const scale = renderedHeight / estimatedTotal;
  const clampedY = Math.min(renderedHeight, Math.max(0, offsetY));
  let blockBottom = 0;

  for (const block of blocks) {
    blockBottom +=
      (Number.isFinite(block.estimatedHeight) && block.estimatedHeight > 0
        ? block.estimatedHeight
        : 1) * scale;

    if (clampedY < blockBottom) return block.path;
  }

  return blocks.at(-1)?.path ?? null;
}

export function getEditableVirtualDropBoundary(
  blocks: readonly Pick<EditableChunkTopLevelBlock, 'estimatedHeight'>[],
  pointerY: number,
  placeholderHeight: number
): EditableVirtualDropBoundary | null {
  if (
    blocks.length === 0 ||
    !Number.isFinite(pointerY) ||
    !Number.isFinite(placeholderHeight) ||
    placeholderHeight <= 0
  ) {
    return null;
  }

  const estimatedTotal = blocks.reduce(
    (total, block) =>
      total +
      (Number.isFinite(block.estimatedHeight) && block.estimatedHeight > 0
        ? block.estimatedHeight
        : 1),
    0
  );
  const scale = placeholderHeight / estimatedTotal;
  const clampedY = Math.min(placeholderHeight, Math.max(0, pointerY));
  let offsetPx = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const estimatedHeight = blocks[index]!.estimatedHeight;
    const blockHeight =
      (Number.isFinite(estimatedHeight) && estimatedHeight > 0
        ? estimatedHeight
        : 1) * scale;

    if (clampedY < offsetPx + blockHeight / 2) {
      return { boundaryIndex: index, offsetPx };
    }

    offsetPx += blockHeight;
  }

  return { boundaryIndex: blocks.length, offsetPx: placeholderHeight };
}

export function getEditableVirtualDropTarget(
  blocks: readonly Pick<EditableChunkTopLevelBlock, 'id'>[],
  boundaryIndex: number
): EditableVirtualDropTarget | null {
  if (
    blocks.length === 0 ||
    !Number.isInteger(boundaryIndex) ||
    boundaryIndex < 0 ||
    boundaryIndex > blocks.length
  ) {
    return null;
  }

  if (boundaryIndex < blocks.length) {
    return { id: blocks[boundaryIndex]!.id, side: 'before' };
  }

  return { id: blocks[blocks.length - 1]!.id, side: 'after' };
}

export function resolveEditableVirtualDropMove(
  sourceIndices: readonly number[],
  boundaryIndex: number,
  blockCount: number
): EditableVirtualDropMove | null {
  if (
    !Number.isInteger(boundaryIndex) ||
    !Number.isInteger(blockCount) ||
    boundaryIndex < 0 ||
    boundaryIndex > blockCount ||
    blockCount <= 0
  ) {
    return null;
  }

  const sortedSources = Array.from(new Set(sourceIndices)).sort(
    (left, right) => left - right
  );

  if (
    sortedSources.length === 0 ||
    sortedSources.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= blockCount
    )
  ) {
    return null;
  }

  const firstSource = sortedSources[0]!;
  const lastSource = sortedSources[sortedSources.length - 1]!;

  // 拖到当前选择范围内部或紧邻边界不会改变模型，直接拒绝。
  if (boundaryIndex >= firstSource && boundaryIndex <= lastSource + 1) {
    return null;
  }

  const removedBeforeTarget = sortedSources.filter(
    (index) => index < boundaryIndex
  ).length;

  return {
    finalIndex: boundaryIndex - removedBeforeTarget,
    // Slate 会用 PathRef 自行修正批量 move_node；这里保留移动前的边界路径。
    to: [boundaryIndex],
  };
}
