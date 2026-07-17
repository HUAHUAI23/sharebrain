// 在保留完整 Slate value 的前提下窗口化 lowest chunk DOM，并提供按 block ID 唤醒能力。
import * as React from 'react';
import {
  DRAG_ITEM_BLOCK,
  type ElementDragItemNode,
} from '@platejs/dnd';
import { NodeApi } from 'platejs';
import { useDrop, type DropTargetMonitor } from 'react-dnd';
import {
  useEditorComposing,
  useEditorRef,
  useEditorSelector,
  useScrollRef,
  type PlateChunkProps,
} from 'platejs/react';

import {
  EDITABLE_CHUNK_WINDOW_OVERSCAN_PX,
  type EditableChunkDescriptor,
  type EditableChunkRange,
  type EditableChunkScrollAnchor,
  type EditableChunkSelectionRange,
  getEditableChunkBlockPathAtOffset,
  getEditableChunkHydrationOrder,
  getEditableChunkRenderMode,
  getEditableChunkScrollAdjustment,
  getEditableChunkScrollAnchor,
  getEditableChunkSelectionRange,
  getEditableVirtualDropBoundary,
  getEditableVirtualDropTarget,
  isEditableChunkEligibleForPrehydration,
  resolveEditableVirtualDropMove,
  selectionRangePinsEditableChunk,
  shouldPrehydrateEditableChunk,
} from '../lib/editable-chunk-window-core';
import {
  EDITABLE_WINDOW_METRIC_EVENT,
  createEditableWindowCircuitState,
  createEditableWindowMetric,
  readEditableWindowCircuit,
  reduceEditableWindowCircuit,
  writeEditableWindowCircuit,
  type EditableWindowCircuitSignal,
} from '../lib/editable-window-observability-core';

type EditableChunkWindowProviderProps = {
  children: React.ReactNode;
  documentKey?: string;
  enabled?: boolean;
  longTaskThresholdMs?: number;
  maxFallbackRatio?: number;
  maxRevealFailures?: number;
  minimumBlockCount?: number;
  overscanPx?: number;
  scrollRoot?: 'editor' | 'viewport';
};

type EditableChunkWindowProps = Pick<
  PlateChunkProps,
  'attributes' | 'children'
> & {
  descriptor: EditableChunkDescriptor;
};

type EditableChunkFallbackProps = Pick<
  PlateChunkProps,
  'attributes' | 'children'
> & {
  range: EditableChunkRange | null;
};

type EditableChunkWindowContextValue = {
  enabled: boolean;
  getBlockPathAtChunkOffset: (
    startIndex: number,
    offsetY: number,
    renderedHeight: number
  ) => number[] | null;
  getMountRevision: () => number;
  overscanPx: number;
  revealBlock: (
    blockId: string,
    path?: number[]
  ) => Promise<HTMLElement | null>;
  store: EditableChunkWindowStore;
  subscribeMounts: (listener: () => void) => () => void;
  scrollRoot: 'editor' | 'viewport';
};

type RegisteredChunk = Pick<
  EditableChunkDescriptor,
  | 'blockPaths'
  | 'containsComplexContent'
  | 'containsReviewContent'
  | 'endIndex'
  | 'estimatedHeight'
  | 'key'
  | 'startIndex'
  | 'topLevelBlocks'
>;

type EditableChunkWindowCoverage = {
  fallbackBlocks: number;
  mountedChunks: number;
  placeholderChunks: number;
};

type EditableChunkWindowAudit =
  | { coverage: EditableChunkWindowCoverage; type: 'coverage' }
  | { type: 'invalid-geometry' }
  | { type: 'invariant' };

const defaultMinimumBlockCount = 800;
const defaultLongTaskThresholdMs = 200;
const defaultMaxFallbackRatio = 0.25;
const defaultMaxRevealFailures = 3;
const forcedRevealDurationMs = 3_000;
const revealFrameBudget = 120;
const scrollSettleDelayMs = 120;
const scrollPrehydrateQuietDelayMs = 32;
const scrollPrehydrateIdleTimeoutMs = 32;
const scrollAnchorFrameBudget = 18;
const scrollAnchorViewportOffsetPx = 88;

type EditableChunkScrollAnchorTarget = EditableChunkScrollAnchor & {
  element: HTMLElement;
};

export const getEditableChunkObservedHeight = (
  entry: Pick<ResizeObserverEntry, 'borderBoxSize' | 'contentRect'>
) => {
  const borderBoxSize = entry.borderBoxSize as
    | ResizeObserverSize
    | readonly ResizeObserverSize[]
    | undefined;
  const firstBorderBox = Array.isArray(borderBoxSize)
    ? borderBoxSize[0]
    : borderBoxSize;
  const borderBoxHeight = firstBorderBox?.blockSize;

  if (Number.isFinite(borderBoxHeight) && borderBoxHeight! > 0) {
    return borderBoxHeight!;
  }

  const contentHeight = entry.contentRect.height;

  return Number.isFinite(contentHeight) && contentHeight > 0
    ? contentHeight
    : null;
};

class EditableChunkWindowStore {
  private readonly blockToChunks = new Map<string, Set<string>>();
  private readonly chunkListeners = new Map<string, Set<() => void>>();
  private readonly chunks = new Map<string, RegisteredChunk>();
  private readonly forcedChunks = new Set<string>();
  private readonly forcedTimers = new Map<string, number>();
  private readonly fallbackBlocks = new Map<string, number>();
  private readonly heights = new Map<string, number>();
  private readonly interactionCounts = new Map<string, number>();
  private readonly interactionReasons = new Map<string, string>();
  private readonly mountedChunks = new Set<string>();
  private readonly mountListeners = new Set<() => void>();
  private readonly prehydrateListeners = new Map<string, Set<() => void>>();
  private readonly prehydratedChunks = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private readonly scrollListeners = new Map<string, Set<() => void>>();
  private readonly viewportChunks = new Set<string>();
  private selectionRange: EditableChunkSelectionRange | null = null;
  private mountRevision = 0;
  private prehydrationConsumed = false;
  private scrolling = false;
  private auditListener: ((audit: EditableChunkWindowAudit) => void) | null =
    null;
  private blockElementResolver:
    | ((blockId: string, path?: number[]) => HTMLElement | null)
    | null = null;

  setBlockElementResolver(
    resolver:
      | ((blockId: string, path?: number[]) => HTMLElement | null)
      | null
  ) {
    this.blockElementResolver = resolver;
  }

  setAuditListener(
    listener: ((audit: EditableChunkWindowAudit) => void) | null
  ) {
    this.auditListener = listener;
    if (listener) this.publishCoverage();
  }

  register(descriptor: RegisteredChunk) {
    this.chunks.set(descriptor.key, descriptor);

    descriptor.blockPaths.forEach(({ id }) => {
      const chunkKeys = this.blockToChunks.get(id) ?? new Set<string>();

      chunkKeys.add(descriptor.key);
      this.blockToChunks.set(id, chunkKeys);
    });
    this.publishCoverage();

    return () => {
      if (this.chunks.get(descriptor.key) !== descriptor) return;

      this.chunks.delete(descriptor.key);
      this.interactionCounts.delete(descriptor.key);
      this.clearPrehydratedChunk(descriptor.key);
      this.viewportChunks.delete(descriptor.key);
      for (const [reason, key] of this.interactionReasons) {
        if (key === descriptor.key) this.interactionReasons.delete(reason);
      }
      descriptor.blockPaths.forEach(({ id }) => {
        const chunkKeys = this.blockToChunks.get(id);

        chunkKeys?.delete(descriptor.key);
        if (chunkKeys?.size === 0) this.blockToChunks.delete(id);
      });
      this.publishCoverage();
    };
  }

  registerFallback(key: string, range: EditableChunkRange | null) {
    if (!range) {
      this.auditListener?.({ type: 'invariant' });
      return () => {};
    }

    this.fallbackBlocks.set(key, Math.max(0, range.endIndex - range.startIndex));
    this.publishCoverage();

    return () => {
      this.fallbackBlocks.delete(key);
      this.publishCoverage();
    };
  }

  subscribe(key: string, listener: () => void) {
    const listeners = this.chunkListeners.get(key) ?? new Set();

    listeners.add(listener);
    this.chunkListeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.chunkListeners.delete(key);
    };
  }

  subscribeScrolling(key: string, listener: () => void) {
    const listeners = this.scrollListeners.get(key) ?? new Set();

    listeners.add(listener);
    this.scrollListeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.scrollListeners.delete(key);
    };
  }

  getScrolling = () => this.scrolling;

  subscribePrehydration(key: string, listener: () => void) {
    const listeners = this.prehydrateListeners.get(key) ?? new Set();

    listeners.add(listener);
    this.prehydrateListeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.prehydrateListeners.delete(key);
    };
  }

  setScrolling(scrolling: boolean) {
    if (this.scrolling === scrolling) return;

    this.scrolling = scrolling;
    if (scrolling) this.prehydrationConsumed = false;
    else this.clearPrehydration();
    const affectedChunks = new Set([
      ...this.mountedChunks,
      ...this.viewportChunks,
    ]);

    affectedChunks.forEach((key) => {
      this.scrollListeners.get(key)?.forEach((listener) => listener());
    });
  }

  setInViewport(key: string, inViewport: boolean) {
    if (inViewport) this.viewportChunks.add(key);
    else {
      this.viewportChunks.delete(key);
      this.clearPrehydratedChunk(key);
    }
  }

  getRevision(key: string) {
    return this.revisions.get(key) ?? 0;
  }

  getMountRevision = () => this.mountRevision;

  subscribeMounts = (listener: () => void) => {
    this.mountListeners.add(listener);
    return () => this.mountListeners.delete(listener);
  };

  setMounted(key: string, mounted: boolean) {
    const currentlyMounted = this.mountedChunks.has(key);

    if (currentlyMounted === mounted) return;

    if (mounted) this.mountedChunks.add(key);
    else this.mountedChunks.delete(key);

    this.mountRevision += 1;
    this.mountListeners.forEach((listener) => listener());
    this.publishCoverage();
  }

  isMounted(key: string) {
    return this.mountedChunks.has(key);
  }

  isPrehydrated(key: string) {
    return this.prehydratedChunks.has(key);
  }

  prehydrate(key: string) {
    const chunk = this.chunks.get(key);

    if (
      !this.scrolling ||
      !chunk ||
      !this.viewportChunks.has(key) ||
      this.mountedChunks.has(key) ||
      this.prehydratedChunks.has(key) ||
      this.prehydrationConsumed ||
      !isEditableChunkEligibleForPrehydration(chunk)
    ) {
      return false;
    }

    this.prehydrationConsumed = true;
    this.prehydratedChunks.add(key);
    this.publishPrehydration(key);
    return true;
  }

  hydrateForSettle(key: string) {
    if (
      !this.scrolling ||
      !this.chunks.has(key) ||
      !this.viewportChunks.has(key) ||
      this.mountedChunks.has(key) ||
      this.prehydratedChunks.has(key)
    ) {
      return false;
    }

    this.prehydratedChunks.add(key);
    this.publishPrehydration(key);
    return true;
  }

  getViewportHydrationKeys(primaryKey?: string) {
    const pending = Array.from(this.viewportChunks).flatMap((key) => {
      const chunk = this.chunks.get(key);

      return chunk &&
        !this.mountedChunks.has(key) &&
        !this.prehydratedChunks.has(key)
        ? [chunk]
        : [];
    });

    return getEditableChunkHydrationOrder(pending, primaryKey).map(
      (chunk) => chunk.key
    );
  }

  cancelPrehydration() {
    this.clearPrehydration();
  }

  pinBlock(blockId: string, path: number[] | undefined, reason: string) {
    const key = this.getChunkKey(blockId, path);

    if (!key) return false;

    const previousKey = this.interactionReasons.get(reason);

    if (previousKey === key) return true;
    if (previousKey) this.releaseInteraction(reason);

    this.interactionReasons.set(reason, key);
    this.interactionCounts.set(key, (this.interactionCounts.get(key) ?? 0) + 1);
    this.publish(key);
    return true;
  }

  releaseInteraction(reason: string) {
    const key = this.interactionReasons.get(reason);

    if (!key) return;

    this.interactionReasons.delete(reason);
    const nextCount = Math.max(0, (this.interactionCounts.get(key) ?? 1) - 1);

    if (nextCount === 0) this.interactionCounts.delete(key);
    else this.interactionCounts.set(key, nextCount);

    this.publish(key);
  }

  isInteractionPinned(key: string) {
    return (this.interactionCounts.get(key) ?? 0) > 0;
  }

  setSelectionRange(selectionRange: EditableChunkSelectionRange | null) {
    const previousRange = this.selectionRange;

    if (
      previousRange?.startIndex === selectionRange?.startIndex &&
      previousRange?.endIndex === selectionRange?.endIndex
    ) {
      return;
    }

    this.selectionRange = selectionRange;

    for (const chunk of this.chunks.values()) {
      if (
        selectionRangePinsEditableChunk(previousRange, chunk) !==
        selectionRangePinsEditableChunk(selectionRange, chunk)
      ) {
        this.publish(chunk.key);
      }
    }
  }

  isSelectionPinned(
    descriptor: Pick<EditableChunkDescriptor, 'endIndex' | 'startIndex'>
  ) {
    return selectionRangePinsEditableChunk(this.selectionRange, descriptor);
  }

  getHeight(key: string, fallback: number) {
    return this.heights.get(key) ?? fallback;
  }

  getBlockPathAtChunkOffset = (
    startIndex: number,
    offsetY: number,
    renderedHeight: number
  ) => {
    if (!Number.isInteger(startIndex)) return null;

    const chunk = Array.from(this.chunks.values()).find(
      (candidate) => candidate.startIndex === startIndex
    );

    return chunk
      ? getEditableChunkBlockPathAtOffset(
          chunk.topLevelBlocks,
          offsetY,
          renderedHeight
        )
      : null;
  };

  setHeight(key: string, height: number) {
    if (!Number.isFinite(height)) {
      this.auditListener?.({ type: 'invalid-geometry' });
      return;
    }
    if (height <= 0) return;

    const nextHeight = Math.max(1, Math.ceil(height));

    if (this.heights.get(key) === nextHeight) return;

    this.heights.set(key, nextHeight);
    this.publish(key);
  }

  isForced(key: string) {
    return this.forcedChunks.has(key);
  }

  forceChunk(key: string) {
    if (!this.chunks.has(key)) return false;

    this.forcedChunks.add(key);
    this.publish(key);

    const existingTimer = this.forcedTimers.get(key);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);

    this.forcedTimers.set(
      key,
      window.setTimeout(() => this.releaseForced(key), forcedRevealDurationMs)
    );
    return true;
  }

  forceChunkAtIndex(topLevelIndex: number) {
    if (!Number.isInteger(topLevelIndex)) return false;

    const key = Array.from(this.chunks.values()).find(
      (chunk) =>
        chunk.startIndex <= topLevelIndex && chunk.endIndex > topLevelIndex
    )?.key;

    return key ? this.forceChunk(key) : false;
  }

  releaseForced(key: string) {
    const timer = this.forcedTimers.get(key);

    if (timer !== undefined) window.clearTimeout(timer);
    this.forcedTimers.delete(key);

    if (!this.forcedChunks.delete(key)) return;
    this.publish(key);
  }

  async revealBlock(blockId: string, path?: number[]) {
    const existingElement = this.blockElementResolver?.(blockId, path) ?? null;

    if (existingElement) return existingElement;

    const key = this.getChunkKey(blockId, path);

    if (!key) return null;

    this.forceChunk(key);

    for (let frame = 0; frame < revealFrameBudget; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const element = this.blockElementResolver?.(blockId, path) ?? null;

      if (element) return element;
    }

    return null;
  }

  private getChunkKey(blockId: string, path?: number[]) {
    const topLevelIndex = path?.[0];

    if (Number.isInteger(topLevelIndex)) {
      return Array.from(this.chunks.values()).find(
        (chunk) =>
          chunk.startIndex <= topLevelIndex! && chunk.endIndex > topLevelIndex!
      )?.key;
    }

    const chunkKeys = this.blockToChunks.get(blockId);

    if (!chunkKeys) return undefined;

    // 无 path 的焦点/指针事件来自已挂载 DOM；重复 ID 时优先固定当前可见 chunk。
    return (
      Array.from(chunkKeys).find((key) => this.mountedChunks.has(key)) ??
      chunkKeys.values().next().value
    );
  }

  private publish(key: string) {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.chunkListeners.get(key)?.forEach((listener) => listener());
  }

  private clearPrehydratedChunk(key: string) {
    if (!this.prehydratedChunks.delete(key)) return;
    this.publishPrehydration(key);
  }

  private clearPrehydration() {
    const keys = Array.from(this.prehydratedChunks);

    this.prehydratedChunks.clear();
    keys.forEach((key) => this.publishPrehydration(key));
  }

  private publishPrehydration(key: string) {
    this.prehydrateListeners.get(key)?.forEach((listener) => listener());
  }

  private publishCoverage() {
    this.auditListener?.({
      coverage: {
        fallbackBlocks: Array.from(this.fallbackBlocks.values()).reduce(
          (total, count) => total + count,
          0
        ),
        mountedChunks: this.mountedChunks.size,
        placeholderChunks: Math.max(
          0,
          this.chunks.size - this.mountedChunks.size
        ),
      },
      type: 'coverage',
    });
  }
}

const EditableChunkWindowContext = React.createContext<
  EditableChunkWindowContextValue | undefined
>(undefined);

function EditableChunkSelectionObserver({
  enabled,
  store,
}: {
  enabled: boolean;
  store: EditableChunkWindowStore;
}) {
  const editor = useEditorRef();
  const composing = useEditorComposing();
  const selectionKey = useEditorSelector((editor) => {
    const range = getEditableChunkSelectionRange(editor.selection);
    return range ? `${range.startIndex}:${range.endIndex}` : '';
  }, []);
  const compositionRangeRef = React.useRef<EditableChunkSelectionRange | null>(
    null
  );

  React.useLayoutEffect(() => {
    const currentRange = getEditableChunkSelectionRange(editor.selection);

    if (currentRange) compositionRangeRef.current = currentRange;
    else if (!composing) compositionRangeRef.current = null;

    store.setSelectionRange(enabled ? compositionRangeRef.current : null);
  }, [composing, editor, enabled, selectionKey, store]);

  React.useEffect(
    () => () => {
      store.setSelectionRange(null);
    },
    [store]
  );

  return null;
}

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function EditableChunkWindowProvider({
  children,
  documentKey = '',
  enabled = true,
  longTaskThresholdMs = defaultLongTaskThresholdMs,
  maxFallbackRatio = defaultMaxFallbackRatio,
  maxRevealFailures = defaultMaxRevealFailures,
  minimumBlockCount = defaultMinimumBlockCount,
  overscanPx = EDITABLE_CHUNK_WINDOW_OVERSCAN_PX,
  scrollRoot = 'editor',
}: EditableChunkWindowProviderProps) {
  const editor = useEditorRef();
  const scrollRef = useScrollRef();
  const blockCount = useEditorSelector((editor) => editor.children.length, []);
  const [store] = React.useState(() => new EditableChunkWindowStore());
  const [circuitReason, setCircuitReason] = React.useState(() =>
    readEditableWindowCircuit(
      getSessionStorage(),
      documentKey
    )
  );
  const circuitStateRef = React.useRef(
    createEditableWindowCircuitState(circuitReason)
  );
  const browserSupported =
    typeof IntersectionObserver !== 'undefined' &&
    typeof ResizeObserver !== 'undefined';
  const windowingEligible =
    enabled &&
    browserSupported &&
    blockCount >= Math.max(1, Math.floor(minimumBlockCount));
  const windowingEnabled = windowingEligible && circuitReason === null;

  const emitMetric = React.useCallback(
    (
      input: Omit<
        Parameters<typeof createEditableWindowMetric>[0],
        'documentKey'
      >
    ) => {
      if (typeof window === 'undefined' || !documentKey) return;

      window.dispatchEvent(
        new CustomEvent(EDITABLE_WINDOW_METRIC_EVENT, {
          detail: createEditableWindowMetric({ documentKey, ...input }),
        })
      );
    },
    [documentKey]
  );
  const recordCircuitSignal = React.useCallback(
    (signal: EditableWindowCircuitSignal) => {
      const previous = circuitStateRef.current;
      const next = reduceEditableWindowCircuit(previous, signal, {
        maxFallbackRatio,
        maxRevealFailures,
      });

      circuitStateRef.current = next;
      if (!previous.reason && next.reason) {
        writeEditableWindowCircuit(
          getSessionStorage(),
          documentKey,
          next.reason
        );
        emitMetric({ kind: 'circuit-open', reason: next.reason });
        setCircuitReason(next.reason);
      }
    },
    [documentKey, emitMetric, maxFallbackRatio, maxRevealFailures]
  );

  React.useEffect(() => {
    if (!windowingEligible) return;

    let coverageFrame: number | null = null;
    let pendingCoverage: EditableChunkWindowCoverage | null = null;

    store.setAuditListener((audit) => {
      if (audit.type === 'invariant') {
        recordCircuitSignal({ type: 'invariant' });
        return;
      }
      if (audit.type === 'invalid-geometry') {
        recordCircuitSignal({ type: 'invalid-geometry' });
        return;
      }

      pendingCoverage = audit.coverage;
      if (coverageFrame !== null) return;

      coverageFrame = requestAnimationFrame(() => {
        coverageFrame = null;
        if (!pendingCoverage) return;

        const coverage = pendingCoverage;
        pendingCoverage = null;
        emitMetric({ ...coverage, kind: 'coverage', totalBlocks: blockCount });
        recordCircuitSignal({
          fallbackBlocks: coverage.fallbackBlocks,
          totalBlocks: blockCount,
          type: 'coverage',
        });
      });
    });

    return () => {
      store.setAuditListener(null);
      if (coverageFrame !== null) cancelAnimationFrame(coverageFrame);
    };
  }, [blockCount, emitMetric, recordCircuitSignal, store, windowingEligible]);

  React.useEffect(() => {
    if (!windowingEnabled) return;

    emitMetric({ kind: 'start', totalBlocks: blockCount });
    let firstFrame = 0;
    let readyFrame = 0;

    firstFrame = requestAnimationFrame(() => {
      readyFrame = requestAnimationFrame(() => {
        emitMetric({ kind: 'ready', totalBlocks: blockCount });
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(readyFrame);
    };
  }, [blockCount, emitMetric, windowingEnabled]);

  React.useEffect(() => {
    if (
      !windowingEnabled ||
      typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ) {
      return;
    }

    const threshold = Math.max(50, longTaskThresholdMs);
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration >= threshold) {
          emitMetric({ durationMs: entry.duration, kind: 'long-task' });
        }
      });
    });

    observer.observe({ buffered: true, type: 'longtask' });
    return () => observer.disconnect();
  }, [emitMetric, longTaskThresholdMs, windowingEnabled]);

  React.useEffect(() => {
    if (!windowingEnabled) return;

    const scrollElement = scrollRoot === 'viewport' ? null : scrollRef.current;
    const target = scrollElement ?? window;

    if (scrollRoot !== 'viewport' && !scrollElement) return;

    let settleTimer: number | null = null;
    let prehydrateTimer: number | null = null;
    let prehydrateIdleHandle: number | null = null;
    let prehydrateFrame: number | null = null;
    let settleHydrationIdleHandle: number | null = null;
    let settleHydrationFrame: number | null = null;
    let settleHydrationGeneration = 0;
    let stabilizationFrame: number | null = null;
    let stabilizationFramesRemaining = 0;
    let activeAnchor: EditableChunkScrollAnchorTarget | null = null;
    let expectedScrollPosition: number | null = null;
    let lastScrollAt = 0;
    const idleWindow = window as typeof window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: (deadline: {
          didTimeout?: boolean;
          timeRemaining: () => number;
        }) => void,
        options?: { timeout: number }
      ) => number;
    };
    const getScrollPosition = () =>
      scrollElement ? scrollElement.scrollTop : window.scrollY;
    const getMaximumScrollPosition = () =>
      scrollElement
        ? Math.max(
            0,
            scrollElement.scrollHeight - scrollElement.clientHeight
          )
        : Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
          );
    const cancelStabilization = () => {
      if (stabilizationFrame !== null) {
        cancelAnimationFrame(stabilizationFrame);
        stabilizationFrame = null;
      }
      stabilizationFramesRemaining = 0;
      activeAnchor = null;
      expectedScrollPosition = null;
    };
    const cancelPrehydrateSchedule = () => {
      if (prehydrateTimer !== null) {
        window.clearTimeout(prehydrateTimer);
        prehydrateTimer = null;
      }
      if (prehydrateIdleHandle !== null) {
        idleWindow.cancelIdleCallback?.(prehydrateIdleHandle);
        prehydrateIdleHandle = null;
      }
      if (prehydrateFrame !== null) {
        cancelAnimationFrame(prehydrateFrame);
        prehydrateFrame = null;
      }
    };
    const cancelSettleHydration = () => {
      settleHydrationGeneration += 1;
      if (settleHydrationIdleHandle !== null) {
        idleWindow.cancelIdleCallback?.(settleHydrationIdleHandle);
        settleHydrationIdleHandle = null;
      }
      if (settleHydrationFrame !== null) {
        cancelAnimationFrame(settleHydrationFrame);
        settleHydrationFrame = null;
      }
    };
    const captureScrollAnchor = (): EditableChunkScrollAnchorTarget | null => {
      let editorElement: HTMLElement | null = null;

      try {
        editorElement = editor.api.toDOMNode(editor) ?? null;
      } catch {
        return null;
      }
      if (!editorElement) return null;

      const rootRectangle = scrollElement?.getBoundingClientRect() ?? null;
      const viewportTop = rootRectangle?.top ?? 0;
      const viewportBottom = rootRectangle?.bottom ?? window.innerHeight;
      const viewportY = Math.min(
        viewportBottom - 1,
        viewportTop + scrollAnchorViewportOffsetPx
      );
      const editorRectangle = editorElement.getBoundingClientRect();
      const viewportX = Math.min(
        window.innerWidth - 1,
        Math.max(0, editorRectangle.left + editorRectangle.width / 2)
      );
      const pointChunk = document
        .elementFromPoint(viewportX, viewportY)
        ?.closest<HTMLElement>('[data-editor-chunk-start]');
      let anchorElement =
        pointChunk && editorElement.contains(pointChunk) ? pointChunk : null;

      if (!anchorElement) {
        const chunks = editorElement.querySelectorAll<HTMLElement>(
          '[data-editor-chunk-start]'
        );

        for (const chunk of chunks) {
          const rectangle = chunk.getBoundingClientRect();

          if (rectangle.bottom > viewportY) {
            anchorElement = chunk;
            break;
          }
        }

        if (!anchorElement) anchorElement = chunks.item(chunks.length - 1);
      }
      if (!anchorElement) return null;

      const anchor = getEditableChunkScrollAnchor(
        anchorElement.getBoundingClientRect(),
        viewportY
      );

      return anchor ? { ...anchor, element: anchorElement } : null;
    };
    const stabilize = () => {
      stabilizationFrame = null;
      const anchor = activeAnchor;

      if (
        !anchor ||
        !anchor.element.isConnected ||
        stabilizationFramesRemaining <= 0
      ) {
        cancelStabilization();
        return;
      }

      const adjustment = getEditableChunkScrollAdjustment(
        anchor,
        anchor.element.getBoundingClientRect()
      );

      if (adjustment === null) {
        cancelStabilization();
        return;
      }

      if (adjustment !== 0) {
        const currentPosition = getScrollPosition();
        const nextPosition = Math.min(
          getMaximumScrollPosition(),
          Math.max(0, currentPosition + adjustment)
        );

        if (Math.abs(nextPosition - currentPosition) <= 0.5) {
          cancelStabilization();
          return;
        }

        expectedScrollPosition = nextPosition;
        if (scrollElement) scrollElement.scrollTop = nextPosition;
        else window.scrollBy(0, nextPosition - currentPosition);
      }

      stabilizationFramesRemaining -= 1;
      if (stabilizationFramesRemaining > 0) {
        stabilizationFrame = requestAnimationFrame(stabilize);
      } else {
        cancelStabilization();
      }
    };
    const startStabilization = (
      anchor: EditableChunkScrollAnchorTarget | null
    ) => {
      cancelStabilization();
      if (!anchor) return;

      activeAnchor = anchor;
      stabilizationFramesRemaining = scrollAnchorFrameBudget;
      stabilizationFrame = requestAnimationFrame(stabilize);
    };
    const prehydrateReadingChunk = (idleBudgetMs: number | null) => {
      if (
        !shouldPrehydrateEditableChunk({
          idleBudgetMs,
          quietDurationMs: performance.now() - lastScrollAt,
          scrolling: store.getScrolling(),
          settleDelayMs: scrollSettleDelayMs,
        })
      ) {
        return;
      }

      const anchor = captureScrollAnchor();
      const key = anchor?.element.dataset.editorChunkKey;

      if (!anchor || !key || !store.prehydrate(key)) return;
      startStabilization(anchor);
    };
    const schedulePrehydrate = () => {
      cancelPrehydrateSchedule();
      prehydrateTimer = window.setTimeout(() => {
        prehydrateTimer = null;

        if (idleWindow.requestIdleCallback) {
          prehydrateIdleHandle = idleWindow.requestIdleCallback(
            (deadline) => {
              prehydrateIdleHandle = null;
              prehydrateReadingChunk(deadline.timeRemaining());
            },
            { timeout: scrollPrehydrateIdleTimeoutMs }
          );
          return;
        }

        prehydrateFrame = requestAnimationFrame(() => {
          prehydrateFrame = null;
          prehydrateReadingChunk(null);
        });
      }, scrollPrehydrateQuietDelayMs);
    };
    const settle = () => {
      settleTimer = null;
      cancelPrehydrateSchedule();
      const anchor = activeAnchor ?? captureScrollAnchor();
      const primaryKey = anchor?.element.dataset.editorChunkKey;
      const primaryReady = Boolean(
        primaryKey &&
          (store.isMounted(primaryKey) || store.isPrehydrated(primaryKey))
      );
      const queue = store.getViewportHydrationKeys(primaryKey);

      cancelSettleHydration();
      startStabilization(anchor);
      if (queue.length === 0) {
        store.setScrolling(false);
        return;
      }

      const generation = settleHydrationGeneration;
      const finish = () => {
        if (
          generation !== settleHydrationGeneration ||
          !store.getScrolling()
        ) {
          return;
        }
        store.setScrolling(false);
      };
      const hydrateNext = () => {
        if (
          generation !== settleHydrationGeneration ||
          !store.getScrolling()
        ) {
          return;
        }

        const key = queue.shift();
        if (!key) {
          finish();
          return;
        }
        if (!store.hydrateForSettle(key)) {
          scheduleNext(false);
          return;
        }

        let framesRemaining = 18;
        const waitForCommit = () => {
          settleHydrationFrame = null;
          if (
            generation !== settleHydrationGeneration ||
            !store.getScrolling()
          ) {
            return;
          }
          if (store.isMounted(key) || framesRemaining <= 0) {
            scheduleNext(false);
            return;
          }

          framesRemaining -= 1;
          settleHydrationFrame = requestAnimationFrame(waitForCommit);
        };
        settleHydrationFrame = requestAnimationFrame(waitForCommit);
      };
      const scheduleNext = (immediate: boolean) => {
        if (
          generation !== settleHydrationGeneration ||
          !store.getScrolling()
        ) {
          return;
        }
        if (immediate) {
          hydrateNext();
          return;
        }

        if (idleWindow.requestIdleCallback) {
          settleHydrationIdleHandle = idleWindow.requestIdleCallback(
            (deadline) => {
              settleHydrationIdleHandle = null;
              if (!deadline.didTimeout && deadline.timeRemaining() < 6) {
                scheduleNext(false);
                return;
              }
              hydrateNext();
            },
            { timeout: 120 }
          );
          return;
        }

        settleHydrationFrame = requestAnimationFrame(() => {
          settleHydrationFrame = null;
          hydrateNext();
        });
      };

      scheduleNext(!primaryReady);
    };
    const onScroll = () => {
      if (activeAnchor) {
        const currentPosition = getScrollPosition();

        if (
          expectedScrollPosition !== null &&
          Math.abs(currentPosition - expectedScrollPosition) <= 1
        ) {
          expectedScrollPosition = null;
        }
        return;
      }

      lastScrollAt = performance.now();
      store.setScrolling(true);
      schedulePrehydrate();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, scrollSettleDelayMs);
    };
    const cancelForUserScroll = () => {
      cancelPrehydrateSchedule();
      cancelSettleHydration();
      cancelStabilization();
      store.cancelPrehydration();
      if (store.getScrolling()) {
        if (settleTimer !== null) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(settle, scrollSettleDelayMs);
      }
    };
    const cancelForKeyboardScroll = (event: KeyboardEvent) => {
      if (
        [
          ' ',
          'ArrowDown',
          'ArrowUp',
          'End',
          'Home',
          'PageDown',
          'PageUp',
        ].includes(event.key)
      ) {
        cancelForUserScroll();
      }
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', cancelForUserScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener('touchstart', cancelForUserScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener('pointerdown', cancelForUserScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', cancelForKeyboardScroll, true);

    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', cancelForUserScroll, true);
      window.removeEventListener('touchstart', cancelForUserScroll, true);
      window.removeEventListener('pointerdown', cancelForUserScroll, true);
      window.removeEventListener('keydown', cancelForKeyboardScroll, true);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      cancelPrehydrateSchedule();
      cancelSettleHydration();
      cancelStabilization();
      store.setScrolling(false);
    };
  }, [editor, scrollRef, scrollRoot, store, windowingEnabled]);

  React.useLayoutEffect(() => {
    store.setBlockElementResolver((blockId, path) => {
      if (path) {
        const node = NodeApi.getIf(editor, path);

        if (node) {
          try {
            return editor.api.toDOMNode(node) ?? null;
          } catch {
            return null;
          }
        }
      }

      const editorElement = editor.api.toDOMNode(editor);

      return (
        Array.from(
          editorElement?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []
        ).find((candidate) => candidate.dataset.blockId === blockId) ?? null
      );
    });

    return () => store.setBlockElementResolver(null);
  }, [editor, store]);

  React.useEffect(() => {
    if (!windowingEnabled) return;

    const editorElement = editor.api.toDOMNode(editor);

    if (!editorElement) return;

    const getBlockId = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? ''
        : '';
    const pinTarget = (target: EventTarget | null, reason: string) => {
      const blockId = getBlockId(target);
      if (blockId) store.pinBlock(blockId, undefined, reason);
    };
    const onFocusIn = (event: FocusEvent) => pinTarget(event.target, 'focus');
    const onFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;

      if (!(nextTarget instanceof Node) || !editorElement.contains(nextTarget)) {
        store.releaseInteraction('focus');
      } else {
        pinTarget(nextTarget, 'focus');
      }
    };
    const onPointerDown = (event: PointerEvent) =>
      pinTarget(event.target, 'pointer');
    const releasePointer = () => store.releaseInteraction('pointer');
    const onDragStart = (event: DragEvent) => pinTarget(event.target, 'drag');
    const releaseDrag = () => store.releaseInteraction('drag');
    const onPlay = (event: Event) =>
      pinTarget(event.target, `media:${getBlockId(event.target)}`);
    const releaseMedia = (event: Event) => {
      const blockId = getBlockId(event.target);
      if (blockId) store.releaseInteraction(`media:${blockId}`);
    };

    editorElement.addEventListener('focusin', onFocusIn);
    editorElement.addEventListener('focusout', onFocusOut);
    editorElement.addEventListener('pointerdown', onPointerDown);
    editorElement.addEventListener('dragstart', onDragStart);
    editorElement.addEventListener('play', onPlay, true);
    editorElement.addEventListener('pause', releaseMedia, true);
    editorElement.addEventListener('ended', releaseMedia, true);
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('dragend', releaseDrag);
    window.addEventListener('drop', releaseDrag);

    return () => {
      editorElement.removeEventListener('focusin', onFocusIn);
      editorElement.removeEventListener('focusout', onFocusOut);
      editorElement.removeEventListener('pointerdown', onPointerDown);
      editorElement.removeEventListener('dragstart', onDragStart);
      editorElement.removeEventListener('play', onPlay, true);
      editorElement.removeEventListener('pause', releaseMedia, true);
      editorElement.removeEventListener('ended', releaseMedia, true);
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('dragend', releaseDrag);
      window.removeEventListener('drop', releaseDrag);
      store.releaseInteraction('focus');
      store.releaseInteraction('pointer');
      store.releaseInteraction('drag');
    };
  }, [editor, store, windowingEnabled]);

  React.useEffect(() => {
    if (!windowingEnabled) return;

    const revealSelectionCorridor = (event: PointerEvent) => {
      if (
        event.buttons !== 1 ||
        document.body.classList.contains('dragging') ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const placeholder = event.target.closest<HTMLElement>(
        '[data-editor-chunk-placeholder="true"]'
      );
      const startIndex = Number(placeholder?.dataset.editorChunkStart);

      if (Number.isInteger(startIndex)) store.forceChunkAtIndex(startIndex);
    };

    document.addEventListener('pointermove', revealSelectionCorridor, true);
    return () =>
      document.removeEventListener('pointermove', revealSelectionCorridor, true);
  }, [store, windowingEnabled]);

  const revealBlock = React.useCallback(
    async (blockId: string, path?: number[]) => {
      const element = await store.revealBlock(blockId, path);

      if (windowingEnabled) {
        const success = Boolean(element);
        emitMetric({ kind: 'reveal', success });
        recordCircuitSignal({ success, type: 'reveal' });
      }

      return element;
    },
    [emitMetric, recordCircuitSignal, store, windowingEnabled]
  );
  const value = React.useMemo<EditableChunkWindowContextValue>(
    () => ({
      enabled: windowingEnabled,
      getBlockPathAtChunkOffset: store.getBlockPathAtChunkOffset,
      getMountRevision: store.getMountRevision,
      overscanPx: Math.max(0, Math.floor(overscanPx)),
      revealBlock,
      scrollRoot,
      store,
      subscribeMounts: store.subscribeMounts,
    }),
    [overscanPx, revealBlock, scrollRoot, store, windowingEnabled]
  );

  return (
    <EditableChunkWindowContext.Provider value={value}>
      <EditableChunkSelectionObserver enabled={windowingEnabled} store={store} />
      {children}
    </EditableChunkWindowContext.Provider>
  );
}

export function useEditableChunkWindow() {
  const context = React.useContext(EditableChunkWindowContext);

  return (
    context ?? {
      enabled: false,
      getBlockPathAtChunkOffset: () => null,
      getMountRevision: () => 0,
      overscanPx: EDITABLE_CHUNK_WINDOW_OVERSCAN_PX,
      revealBlock: async () => null,
      scrollRoot: 'editor' as const,
      store: null,
      subscribeMounts: () => () => {},
    }
  );
}

export function useEditableChunkMountRevision() {
  const context = React.useContext(EditableChunkWindowContext);

  return React.useSyncExternalStore(
    context?.subscribeMounts ?? (() => () => {}),
    context?.getMountRevision ?? (() => 0),
    () => 0
  );
}

export function EditableChunkFallback({
  attributes,
  children,
  range,
}: EditableChunkFallbackProps) {
  const context = React.useContext(EditableChunkWindowContext);
  const registrationKey = React.useId();

  React.useEffect(() => {
    if (!context?.enabled || !context.store) return;

    return context.store.registerFallback(registrationKey, range);
  }, [context?.enabled, context?.store, range, registrationKey]);

  return (
    <div
      {...attributes}
      data-editor-chunk-fallback="true"
      data-editor-chunk-start={range?.startIndex}
      data-editor-chunk-end={range?.endIndex}
      style={{ contain: 'layout style' }}
    >
      {children}
    </div>
  );
}

export function EditableChunkWindow({
  attributes,
  children,
  descriptor,
}: EditableChunkWindowProps) {
  const context = React.useContext(EditableChunkWindowContext);
  const editor = useEditorRef();
  const scrollRef = useScrollRef();
  const elementRef = React.useRef<HTMLDivElement>(null);
  const [inViewport, setInViewport] = React.useState(
    descriptor.startIndex === 0
  );
  const [prehydrated, setPrehydrated] = React.useState(false);
  const enabled = Boolean(context?.enabled);
  const store = context?.store;
  const [dropLineOffset, setDropLineOffset] = React.useState<number | null>(
    null
  );

  React.useLayoutEffect(() => {
    if (!enabled || !store) return;

    return store.register(descriptor);
  }, [
    descriptor.blockPaths.length,
    descriptor.containsComplexContent,
    descriptor.containsReviewContent,
    descriptor.endIndex,
    descriptor.estimatedHeight,
    descriptor.key,
    descriptor.startIndex,
    enabled,
    store,
  ]);

  React.useEffect(() => {
    const element = elementRef.current;

    if (!enabled || !element || !store) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextInViewport = Boolean(entry?.isIntersecting);

        store.setInViewport(descriptor.key, nextInViewport);
        React.startTransition(() => setInViewport(nextInViewport));
        if (nextInViewport) store.releaseForced(descriptor.key);
      },
      {
        root: context.scrollRoot === 'viewport' ? null : scrollRef.current,
        rootMargin: `${context.overscanPx}px 0px`,
      }
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      store.setInViewport(descriptor.key, false);
    };
  }, [
    context?.overscanPx,
    context?.scrollRoot,
    descriptor.key,
    enabled,
    scrollRef,
    store,
  ]);

  React.useSyncExternalStore(
    React.useCallback(
      (listener) => store?.subscribe(descriptor.key, listener) ?? (() => {}),
      [descriptor.key, store]
    ),
    React.useCallback(
      () => store?.getRevision(descriptor.key) ?? 0,
      [descriptor.key, store]
    ),
    () => 0
  );
  const scrolling = React.useSyncExternalStore(
    React.useCallback(
      (listener) =>
        store?.subscribeScrolling(descriptor.key, listener) ?? (() => {}),
      [descriptor.key, store]
    ),
    store?.getScrolling ?? (() => false),
    () => false
  );

  React.useEffect(() => {
    if (!enabled || !store) {
      setPrehydrated(false);
      return;
    }

    const update = () => {
      const nextPrehydrated = store.isPrehydrated(descriptor.key);

      if (nextPrehydrated) {
        React.startTransition(() => setPrehydrated(true));
      } else {
        setPrehydrated(false);
      }
    };

    update();
    return store.subscribePrehydration(descriptor.key, update);
  }, [descriptor.key, enabled, store]);

  const forced = store?.isForced(descriptor.key) ?? false;
  const interactionPinned =
    store?.isInteractionPinned(descriptor.key) ?? false;
  const selectionPinned = store?.isSelectionPinned(descriptor) ?? false;
  const mounted = store?.isMounted(descriptor.key) ?? false;
  const renderMode = getEditableChunkRenderMode({
    enabled,
    first: descriptor.startIndex === 0,
    forced,
    inViewport,
    interactionPinned,
    mounted,
    prehydrated,
    scrolling,
    selectionPinned,
  });
  let renderReason: string | undefined;

  if (!enabled) renderReason = 'disabled';
  else if (descriptor.startIndex === 0) renderReason = 'first';
  else if (prehydrated) renderReason = 'prehydrate';
  else if (inViewport) renderReason = 'viewport';
  else if (selectionPinned) renderReason = 'selection';
  else if (interactionPinned) renderReason = 'interaction';
  else if (forced) renderReason = 'forced';
  else if (scrolling && mounted) renderReason = 'scroll-cache';
  const shouldRender = renderMode === 'content';
  const shouldPreview = enabled && !shouldRender;

  React.useLayoutEffect(() => {
    if (!enabled || !store) return;

    store.setMounted(descriptor.key, shouldRender);
    return () => store.setMounted(descriptor.key, false);
  }, [descriptor.key, enabled, shouldRender, store]);

  React.useEffect(() => {
    const element = elementRef.current;

    if (!enabled || !element || !store || !shouldRender) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const height = getEditableChunkObservedHeight(entry);
      if (height !== null) store.setHeight(descriptor.key, height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [descriptor.key, enabled, shouldRender, store]);

  const placeholderHeight =
    store?.getHeight(descriptor.key, descriptor.estimatedHeight) ??
    descriptor.estimatedHeight;

  const getVirtualDrop = React.useCallback(
    (
      dragItem: ElementDragItemNode,
      monitor: DropTargetMonitor<ElementDragItemNode, unknown>
    ) => {
      const element = elementRef.current;
      const clientOffset = monitor.getClientOffset();

      if (
        !enabled ||
        shouldRender ||
        !element ||
        !clientOffset ||
        dragItem.editorId !== editor.id
      ) {
        return null;
      }

      const rectangle = element.getBoundingClientRect();
      const boundary = getEditableVirtualDropBoundary(
        descriptor.topLevelBlocks,
        clientOffset.y - rectangle.top,
        rectangle.height
      );
      if (!boundary) return null;

      const stableTarget = getEditableVirtualDropTarget(
        descriptor.topLevelBlocks,
        boundary.boundaryIndex
      );
      if (!stableTarget) return null;

      const targetEntry = editor.api.node({ id: stableTarget.id, at: [] });
      if (!targetEntry || targetEntry[1].length !== 1) return null;

      const draggedIds = Array.from(
        new Set(Array.isArray(dragItem.id) ? dragItem.id : [dragItem.id])
      );
      const sourceEntries = draggedIds
        .map((id) => editor.api.node({ id, at: [] }))
        .filter(
          (entry): entry is NonNullable<typeof entry> =>
            Boolean(entry && entry[1].length === 1)
        );
      if (sourceEntries.length !== draggedIds.length) return null;

      const targetBoundary =
        targetEntry[1][0]! + (stableTarget.side === 'after' ? 1 : 0);
      const move = resolveEditableVirtualDropMove(
        sourceEntries.map((entry) => entry[1][0]!),
        targetBoundary,
        editor.children.length
      );

      return move
        ? {
            draggedIds,
            lineOffset: boundary.offsetPx,
            move,
          }
        : null;
    },
    [
      descriptor.topLevelBlocks,
      editor,
      enabled,
      shouldRender,
    ]
  );

  const [{ isDropOver }, dropRef] = useDrop<
    ElementDragItemNode,
    void,
    { isDropOver: boolean }
  >(
    () => ({
      accept: DRAG_ITEM_BLOCK,
      canDrop: (dragItem, monitor) => Boolean(getVirtualDrop(dragItem, monitor)),
      collect: (monitor) => ({ isDropOver: monitor.isOver({ shallow: true }) }),
      drop: (dragItem, monitor) => {
        const target = getVirtualDrop(dragItem, monitor);

        if (!target) return;

        const draggedIds = new Set(target.draggedIds);

        editor.tf.moveNodes({
          at: [],
          match: (node) =>
            'id' in node &&
            typeof node.id === 'string' &&
            draggedIds.has(node.id),
          mode: 'highest',
          to: target.move.to,
        });
        setDropLineOffset(null);

        const firstDraggedId = target.draggedIds[0];
        if (!firstDraggedId) return;

        requestAnimationFrame(() => {
          const entry = editor.api.node({ id: firstDraggedId, at: [] });
          const path = entry?.[1];

          void context?.revealBlock(firstDraggedId, path).then((element) => {
            element?.scrollIntoView({ block: 'nearest' });
          });
        });
      },
      hover: (dragItem, monitor) => {
        const target = getVirtualDrop(dragItem, monitor);
        setDropLineOffset(target?.lineOffset ?? null);
      },
    }),
    [context, editor, getVirtualDrop]
  );

  React.useEffect(() => {
    if (!isDropOver) setDropLineOffset(null);
  }, [isDropOver]);

  const setElementRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      dropRef(element);
    },
    [dropRef]
  );

  return (
    <div
      {...attributes}
      ref={setElementRef}
      data-editor-chunk-window={enabled ? 'true' : undefined}
      data-editor-chunk-key={enabled ? descriptor.key : undefined}
      data-editor-chunk-start={enabled ? descriptor.startIndex : undefined}
      data-editor-chunk-end={enabled ? descriptor.endIndex : undefined}
      data-editor-chunk-complex={
        enabled && descriptor.containsComplexContent ? 'true' : undefined
      }
      data-editor-chunk-review={
        enabled && descriptor.containsReviewContent ? 'true' : undefined
      }
      data-editor-chunk-placeholder={
        enabled && !shouldRender ? 'true' : undefined
      }
      data-editor-chunk-render-reason={shouldRender ? renderReason : undefined}
      aria-hidden={enabled && !shouldRender ? true : undefined}
      style={
        enabled && !shouldRender
          ? {
              contain: 'strict',
              height: placeholderHeight,
              pointerEvents: 'auto',
              position: 'relative',
            }
          : { contain: 'layout style' }
      }
    >
      {shouldRender ? children : null}
      {shouldPreview ? (
        <EditableChunkScrollPreview
          descriptor={descriptor}
          height={placeholderHeight}
        />
      ) : null}
      {enabled && !shouldRender && dropLineOffset !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-brand/60"
          style={{ top: Math.max(0, dropLineOffset - 1) }}
        />
      ) : null}
    </div>
  );
}

function EditableChunkScrollPreview({
  descriptor,
  height,
}: {
  descriptor: EditableChunkDescriptor;
  height: number;
}) {
  const estimatedTotal = descriptor.topLevelBlocks.reduce(
    (total, block) => total + block.estimatedHeight,
    0
  );
  const scale = estimatedTotal > 0 ? height / estimatedTotal : 1;
  const lineHeight = Math.min(42, Math.max(24, 28 * scale));

  return (
    <div
      aria-hidden="true"
      contentEditable={false}
      data-editor-chunk-scroll-preview="true"
      className="pointer-events-none h-full overflow-hidden whitespace-pre-wrap break-words text-base text-foreground"
      style={{ lineHeight: `${lineHeight}px` }}
    >
      {descriptor.previewText || '\u00a0'}
    </div>
  );
}
