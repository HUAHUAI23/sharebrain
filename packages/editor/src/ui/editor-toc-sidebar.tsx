// 按渲染模式从已提交 DOM 或完整 Slate model 构建大纲，并保持滚动定位增量化。
import { isHeading } from '@platejs/toc';
import { ElementApi, NodeApi, type Value } from 'platejs';
import {
  type PlateEditor,
  useEditorRef,
  useEditorVersion,
  useScrollRef,
} from 'platejs/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

import { m } from '@sharebrain/i18n';
import { cn } from '@sharebrain/ui/lib/utils';

import { useEditableChunkWindow } from './editable-chunk-window';

export type EditorTocSidebarProps = {
  className?: string;
};

type TocHeadingElement = {
  element: Element;
  key: string;
};

type TocHeading = {
  depth: number;
  element?: HTMLElement;
  id: string;
  path?: number[];
  title: string;
  type: string;
};

type TocModelIndex = {
  blockPaths: Map<string, number[]>;
  headings: TocHeading[];
};

const depthMarkerWidth: Record<number, string> = {
  1: 'w-6',
  2: 'w-5',
  3: 'w-4',
};

const depthIndent: Record<number, string> = {
  1: 'pl-2',
  2: 'pl-5',
  3: 'pl-8',
};

const headingDepth: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const tocTopOffset = 88;
const tocListComfortStart = 0.4;
const tocListComfortEnd = 0.6;
const tocListTailMinimumItems = 12;
const tocScrollSettleDelayMs = 160;

const headingSelector = [1, 2, 3, 4, 5, 6]
  .map((depth) => `h${depth}[data-block-id]`)
  .join(',');

const getItemKey = (item: TocHeading) =>
  item.path ? `${item.id}:${item.path.join('.')}` : item.id;

export const resolveActiveTocItemKey = (
  itemKeys: readonly string[],
  activeItemKey: string | null
) =>
  activeItemKey && itemKeys.includes(activeItemKey)
    ? activeItemKey
    : itemKeys[0] ?? null;

export const getTocListScrollTop = ({
  clientHeight,
  currentScrollTop,
  itemHeight,
  itemTop,
  scrollHeight,
}: {
  clientHeight: number;
  currentScrollTop: number;
  itemHeight: number;
  itemTop: number;
  scrollHeight: number;
}) => {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  const clampedScrollTop = Math.min(
    maximumScrollTop,
    Math.max(0, currentScrollTop)
  );
  const itemCenter = itemTop + itemHeight / 2;
  const comfortTop = clampedScrollTop + clientHeight * tocListComfortStart;
  const comfortBottom = clampedScrollTop + clientHeight * tocListComfortEnd;

  if (itemCenter >= comfortTop && itemCenter <= comfortBottom) {
    return clampedScrollTop;
  }

  return Math.min(
    maximumScrollTop,
    Math.max(0, itemCenter - clientHeight / 2)
  );
};

const getHeadingListFromDom = (editorElement: HTMLElement): TocHeading[] =>
  Array.from(editorElement.querySelectorAll<HTMLElement>(headingSelector)).flatMap(
    (element) => {
      const type = element.tagName.toLowerCase();
      const depth = headingDepth[type];
      const id = element.dataset.blockId;
      const title = element.textContent?.trim();

      return depth && id && title
        ? [{ depth, element, id, title, type }]
        : [];
    }
  );

export const getTocModelIndex = (value: Value): TocModelIndex => {
  const blockPaths = new Map<string, number[]>();
  const headings: TocHeading[] = [];

  const visit = (node: unknown, path: number[]) => {
    if (!ElementApi.isElement(node)) return;

    const id = typeof node.id === 'string' ? node.id : null;
    const type = typeof node.type === 'string' ? node.type : '';
    const depth = headingDepth[type];

    if (id) blockPaths.set(id, path);
    if (id && depth) {
      const title = NodeApi.string(node).trim();
      if (title) headings.push({ depth, id, path, title, type });
    }

    node.children.forEach((child, index) => visit(child, [...path, index]));
  };

  value.forEach((node, index) => visit(node, [index]));

  return { blockPaths, headings };
};

const areHeadingListsEqual = (left: TocHeading[], right: TocHeading[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index];

    return (
      other !== undefined &&
      item.depth === other.depth &&
      item.element === other.element &&
      item.id === other.id &&
      (item.path === other.path ||
        (item.path !== undefined &&
          other.path !== undefined &&
          item.path.length === other.path.length &&
          item.path.every((value, pathIndex) => value === other.path![pathIndex]))) &&
      item.title === other.title &&
      item.type === other.type
    );
  });

type EditorOperation = PlateEditor['operations'][number];

const nodeContainsHeading = (node: unknown): boolean => {
  if (!ElementApi.isElement(node)) return false;
  if (isHeading(node)) return true;

  return node.children.some(nodeContainsHeading);
};

const propertiesContainHeadingType = (properties: unknown) =>
  Boolean(
    properties &&
      typeof properties === 'object' &&
      'type' in properties &&
      typeof properties.type === 'string' &&
      headingDepth[properties.type]
  );

const pathTouchesHeading = (editor: PlateEditor, path: number[]) => {
  for (let length = 1; length <= path.length; length += 1) {
    const node = NodeApi.getIf(editor, path.slice(0, length));

    if (node && isHeading(node)) return true;
  }

  return false;
};

export const shouldRefreshTocHeadingList = (
  editor: PlateEditor,
  operations: EditorOperation[] = editor.operations
) => {
  if (operations.length === 0) return true;

  return operations.some((operation) => {
    if (operation.type === 'set_selection') return false;

    if (operation.type === 'insert_text' || operation.type === 'remove_text') {
      return pathTouchesHeading(editor, operation.path);
    }

    if (operation.type === 'insert_node' || operation.type === 'remove_node') {
      return nodeContainsHeading(operation.node);
    }

    if (operation.type === 'split_node') {
      return pathTouchesHeading(editor, operation.path);
    }

    if (operation.type === 'move_node') {
      const movedNode = NodeApi.getIf(editor, operation.newPath);

      return movedNode ? nodeContainsHeading(movedNode) : true;
    }

    if (operation.type === 'set_node') {
      return (
        pathTouchesHeading(editor, operation.path) ||
        propertiesContainHeadingType(operation.properties) ||
        propertiesContainHeadingType(operation.newProperties)
      );
    }

    return true;
  });
};

const DOCUMENT_POSITION_FOLLOWING = 4;

export const getActiveTocItemKeyFromDom = (
  headingElements: TocHeadingElement[],
  currentBlock: Element
): string | null => {
  const firstKey = headingElements[0]?.key ?? null;

  if (!firstKey) return null;

  let activeKey = firstKey;

  for (const item of headingElements) {
    if (
      item.element === currentBlock ||
      (item.element.compareDocumentPosition(currentBlock) &
        DOCUMENT_POSITION_FOLLOWING) !==
        0
    ) {
      activeKey = item.key;
      continue;
    }

    break;
  }

  return activeKey;
};

const comparePaths = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }

  return left.length - right.length;
};

export const getActiveTocItemKeyFromPath = (
  headings: TocHeading[],
  currentPath: number[]
) => {
  const first = headings[0];

  if (!first) return null;

  let activeKey = getItemKey(first);

  for (const heading of headings) {
    if (!heading.path || comparePaths(heading.path, currentPath) > 0) break;
    activeKey = getItemKey(heading);
  }

  return activeKey;
};

const getScrollRoot = (scrollElement: HTMLDivElement | null) =>
  scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight
    ? scrollElement
    : null;

type ViewportChunkBounds = {
  bottom: number;
  top: number;
};

export const getViewportChunkIndex = (
  chunkCount: number,
  pointY: number,
  getBounds: (index: number) => ViewportChunkBounds
) => {
  let lower = 0;
  let upper = chunkCount - 1;
  let precedingIndex: number | null = null;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const bounds = getBounds(middle);

    if (
      !Number.isFinite(bounds.top) ||
      !Number.isFinite(bounds.bottom) ||
      bounds.bottom < bounds.top
    ) {
      return null;
    }

    if (pointY < bounds.top) {
      upper = middle - 1;
      continue;
    }

    precedingIndex = middle;
    if (pointY < bounds.bottom) return middle;
    lower = middle + 1;
  }

  return precedingIndex;
};

const getCurrentChunkPathFromDom = (
  currentBlock: Element,
  currentChunk: HTMLElement | null
): number[] | undefined => {
  const chunkStart = Number(currentChunk?.dataset.editorChunkStart);

  if (!currentChunk || !Number.isInteger(chunkStart)) return undefined;

  let topLevelBlock = currentBlock;

  for (
    let parentBlock = topLevelBlock.parentElement?.closest(
      '[data-slate-node="element"]'
    );
    parentBlock && currentChunk.contains(parentBlock);
    parentBlock = topLevelBlock.parentElement?.closest(
      '[data-slate-node="element"]'
    )
  ) {
    topLevelBlock = parentBlock;
  }

  const topLevelBlocks = Array.from(
    currentChunk.querySelectorAll<HTMLElement>('[data-slate-node="element"]')
  ).filter((candidate) => {
    const parentBlock = candidate.parentElement?.closest(
      '[data-slate-node="element"]'
    );

    return !parentBlock || !currentChunk.contains(parentBlock);
  });
  const blockOffset = topLevelBlocks.indexOf(topLevelBlock as HTMLElement);

  return blockOffset >= 0 ? [chunkStart + blockOffset] : [chunkStart];
};

const getChunkAtViewportPoint = (
  editorElement: HTMLElement,
  target: Element | null,
  pointY: number
) => {
  const directChunk = target?.closest<HTMLElement>(
    '[data-editor-chunk-start]'
  );

  if (directChunk) return directChunk;

  const chunks = editorElement.querySelectorAll<HTMLElement>(
    '[data-editor-chunk-start]'
  );
  const chunkIndex = getViewportChunkIndex(chunks.length, pointY, (index) => {
    const rectangle = chunks[index]!.getBoundingClientRect();

    return { bottom: rectangle.bottom, top: rectangle.top };
  });

  return chunkIndex === null ? null : chunks[chunkIndex] ?? null;
};

const getChunkPathAtViewportPoint = (
  currentChunk: HTMLElement | null,
  pointY: number,
  getBlockPathAtChunkOffset: (
    startIndex: number,
    offsetY: number,
    renderedHeight: number
  ) => number[] | null
) => {
  const chunkStart = Number(currentChunk?.dataset.editorChunkStart);

  if (!currentChunk || !Number.isInteger(chunkStart)) return undefined;

  const rectangle = currentChunk.getBoundingClientRect();

  return (
    getBlockPathAtChunkOffset(
      chunkStart,
      pointY - rectangle.top,
      rectangle.height
    ) ?? [chunkStart]
  );
};

function EditorTocOperationObserver({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  const editor = useEditorRef();
  const editorVersion = useEditorVersion();
  const refreshHeadingList =
    editor.operations.length > 0 &&
    shouldRefreshTocHeadingList(editor, editor.operations);

  useEffect(() => {
    if (refreshHeadingList) onRefresh();
  }, [editorVersion, onRefresh, refreshHeadingList]);

  return null;
}

export function EditorTocSidebar({ className }: EditorTocSidebarProps) {
  const editor = useEditorRef();
  const scrollRef = useScrollRef();
  const chunkWindow = useEditableChunkWindow();
  const [headingList, setHeadingList] = useState<TocHeading[]>([]);
  const blockPathsRef = useRef(new Map<string, number[]>());
  const headingRefreshTaskRef = useRef<{
    handle: number;
    type: 'frame' | 'idle';
  } | null>(null);
  const [mouseInToc, setMouseInToc] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const tocListRef = useRef<HTMLDivElement>(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const activeItemKeyRef = useRef<string | null>(null);
  const expanded = mouseInToc || hasFocus;

  const cancelHeadingRefresh = useCallback(() => {
    const task = headingRefreshTaskRef.current;
    if (!task) return;

    if (task.type === 'idle') {
      const idleWindow = window as typeof window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      idleWindow.cancelIdleCallback?.(task.handle);
    } else {
      cancelAnimationFrame(task.handle);
    }
    headingRefreshTaskRef.current = null;
  }, []);
  const refreshHeadingList = useCallback(() => {
    cancelHeadingRefresh();

    const run = () => {
      headingRefreshTaskRef.current = null;
      let nextHeadingList: TocHeading[];

      if (chunkWindow.enabled) {
        const modelIndex = getTocModelIndex(editor.children as Value);
        blockPathsRef.current = modelIndex.blockPaths;
        nextHeadingList = modelIndex.headings;
      } else {
        const editorElement = editor.api.toDOMNode(editor);
        if (!editorElement) return;

        blockPathsRef.current = new Map();
        nextHeadingList = getHeadingListFromDom(editorElement);
      }

      setHeadingList((current) =>
        areHeadingListsEqual(current, nextHeadingList)
          ? current
          : nextHeadingList
      );
    };
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number;
    };

    if (chunkWindow.enabled && idleWindow.requestIdleCallback) {
      headingRefreshTaskRef.current = {
        handle: idleWindow.requestIdleCallback(run, { timeout: 500 }),
        type: 'idle',
      };
      return;
    }

    headingRefreshTaskRef.current = {
      handle: requestAnimationFrame(run),
      type: 'frame',
    };
  }, [cancelHeadingRefresh, chunkWindow.enabled, editor]);

  useEffect(() => {
    refreshHeadingList();
    return cancelHeadingRefresh;
  }, [cancelHeadingRefresh, refreshHeadingList]);

  const setActiveTocItem = useCallback(
    (nextActiveKey: string | null) => {
      if (!nextActiveKey || activeItemKeyRef.current === nextActiveKey) return;

      activeItemKeyRef.current = nextActiveKey;
      setActiveItemKey(nextActiveKey);
    },
    []
  );

  useEffect(() => {
    const firstKey = headingList[0] ? getItemKey(headingList[0]) : null;

    if (!firstKey) return;

    const currentKey = activeItemKeyRef.current;
    const initialActiveKey =
      currentKey && headingList.some((item) => getItemKey(item) === currentKey)
        ? currentKey
        : firstKey;

    if (initialActiveKey !== currentKey) {
      activeItemKeyRef.current = null;
      setActiveTocItem(initialActiveKey);
    }

    const scrollElement = scrollRef.current;
    const editorElement = editor.api.toDOMNode(editor);

    if (!editorElement) return;

    const headingElements: TocHeadingElement[] = headingList.flatMap((item) => {
      return item.element?.isConnected
        ? [{ element: item.element, key: getItemKey(item) }]
        : [];
    });
    let editorPointX: number | null = null;
    let animationFrame = 0;
    let pendingScrollRoot: HTMLDivElement | null = null;
    let scrollSettleTimer = 0;

    const update = () => {
      animationFrame = 0;
      const scrollRoot = pendingScrollRoot;
      const editorRect = editorPointX === null
        ? editorElement.getBoundingClientRect()
        : null;

      if (editorRect) {
        editorPointX = Math.min(
          editorRect.right - 1,
          editorRect.left + Math.max(1, editorRect.width / 2)
        );
      }

      const scrollRootRect = scrollRoot?.getBoundingClientRect();
      const pointY = scrollRootRect
        ? Math.min(
            scrollRootRect.bottom - 1,
            scrollRootRect.top + tocTopOffset
          )
        : tocTopOffset;

      if (editorPointX === null) return;

      const setBoundaryActiveItem = () => {
        const currentEditorRect = editorElement.getBoundingClientRect();

        // 参考线可能落在标题输入区或正文尾部留白，此时仍需稳定选中边界标题。
        if (pointY < currentEditorRect.top) {
          setActiveTocItem(
            headingList[0] ? getItemKey(headingList[0]) : null
          );
        } else if (pointY >= currentEditorRect.bottom) {
          const lastHeading = headingList.at(-1);
          setActiveTocItem(lastHeading ? getItemKey(lastHeading) : null);
        }
      };

      const target = document.elementFromPoint(editorPointX, pointY);
      const editorTarget = target && editorElement.contains(target) ? target : null;
      const currentChunk = chunkWindow.enabled
        ? getChunkAtViewportPoint(editorElement, editorTarget, pointY)
        : null;
      const setChunkActiveItem = () => {
        if (!chunkWindow.enabled) return false;

        const currentPath = getChunkPathAtViewportPoint(
          currentChunk,
          pointY,
          chunkWindow.getBlockPathAtChunkOffset
        );

        if (!currentPath) return false;

        setActiveTocItem(
          getActiveTocItemKeyFromPath(headingList, currentPath)
        );
        return true;
      };

      // wheel 命中层可能短暂覆盖正文；窗口模式仍可按 chunk 几何定位。
      if (!editorTarget) {
        if (!setChunkActiveItem()) setBoundaryActiveItem();
        return;
      }

      let currentBlock = editorTarget.closest('[data-block-id]');

      if (!currentBlock) {
        if (!setChunkActiveItem()) setBoundaryActiveItem();
        return;
      }

      if (chunkWindow.enabled) {
        const blockId = currentBlock.getAttribute('data-block-id');
        const chunkPath = getCurrentChunkPathFromDom(
          currentBlock,
          currentChunk
        );
        let currentPath: number[] | undefined;

        try {
          const slateNode = editor.api.toSlateNode(currentBlock);
          currentPath = slateNode
            ? editor.api.findPath(slateNode) ?? undefined
            : undefined;
        } catch {
          currentPath = undefined;
        }

        if (!currentPath && blockId) {
          currentPath = blockPathsRef.current.get(blockId);
        }

        // Slate 的 DOM weak map 在 chunk 换入后可能短暂保留旧 path，以连续 chunk
        // 范围校验顶层索引，避免目录高亮错误地停在文档开头。
        if (
          chunkPath &&
          (!currentPath || currentPath[0] !== chunkPath[0])
        ) {
          currentPath = chunkPath;
        }

        if (currentPath) {
          setActiveTocItem(
            getActiveTocItemKeyFromPath(headingList, currentPath)
          );
        }
        return;
      }

      for (
        let parentBlock = currentBlock.parentElement?.closest('[data-block-id]');
        parentBlock && editorElement.contains(parentBlock);
        parentBlock = currentBlock.parentElement?.closest('[data-block-id]')
      ) {
        currentBlock = parentBlock;
      }

      setActiveTocItem(
        getActiveTocItemKeyFromDom(headingElements, currentBlock)
      );
    };
    const scheduleUpdate = (scrollRoot: HTMLDivElement | null) => {
      pendingScrollRoot = scrollRoot;

      if (animationFrame !== 0) return;

      animationFrame = requestAnimationFrame(update);
    };
    const scheduleScrollUpdate = (scrollRoot: HTMLDivElement | null) => {
      scheduleUpdate(scrollRoot);
      window.clearTimeout(scrollSettleTimer);
      scrollSettleTimer = window.setTimeout(
        () => scheduleUpdate(scrollRoot),
        tocScrollSettleDelayMs
      );
    };
    const handleWindowScroll = () => scheduleScrollUpdate(null);
    const handleEditorScroll = () => scheduleScrollUpdate(scrollElement);
    const handleResize = () => {
      editorPointX = null;
      scheduleUpdate(getScrollRoot(scrollElement));
    };
    const resizeObserver = chunkWindow.enabled
      ? new ResizeObserver(() => scheduleUpdate(getScrollRoot(scrollElement)))
      : null;

    scrollElement?.addEventListener('scroll', handleEditorScroll, {
      passive: true,
    });
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    resizeObserver?.observe(editorElement);
    scheduleUpdate(getScrollRoot(scrollElement));

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(scrollSettleTimer);
      scrollElement?.removeEventListener('scroll', handleEditorScroll);
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [chunkWindow.enabled, editor, headingList, scrollRef, setActiveTocItem]);

  const onContentClick = useCallback(
    async (
      event: MouseEvent<HTMLButtonElement>,
      item: TocHeading,
      behavior: ScrollBehavior = 'smooth'
    ) => {
      event.preventDefault();

      const element = chunkWindow.enabled
        ? await chunkWindow.revealBlock(item.id, item.path)
        : item.element;

      if (!element?.isConnected) return;

      const scrollToElement = (nextBehavior: ScrollBehavior) => {
        const scrollRoot = getScrollRoot(scrollRef.current);

        if (scrollRoot) {
          const rootRect = scrollRoot.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();

          scrollRoot.scrollTo({
            behavior: nextBehavior,
            top:
              scrollRoot.scrollTop +
              elementRect.top -
              rootRect.top -
              tocTopOffset,
          });
        } else {
          window.scrollTo({
            behavior: nextBehavior,
            top:
              window.scrollY + element.getBoundingClientRect().top - tocTopOffset,
          });
        }
      };

      setActiveTocItem(getItemKey(item));
      scrollToElement(chunkWindow.enabled ? 'auto' : behavior);

      if (chunkWindow.enabled) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        scrollToElement('auto');
      }
    },
    [
      chunkWindow.enabled,
      chunkWindow.revealBlock,
      scrollRef,
      setActiveTocItem,
    ]
  );

  const resolvedActiveItemKey = resolveActiveTocItemKey(
    headingList.map(getItemKey),
    activeItemKey
  );

  useEffect(() => {
    const list = tocListRef.current;
    const activeItem = list?.querySelector<HTMLElement>('[data-active="true"]');

    if (!list || !activeItem) return;

    const nextScrollTop = getTocListScrollTop({
      clientHeight: list.clientHeight,
      currentScrollTop: list.scrollTop,
      itemHeight: activeItem.offsetHeight,
      itemTop: activeItem.offsetTop,
      scrollHeight: list.scrollHeight,
    });

    if (Math.abs(nextScrollTop - list.scrollTop) > 0.5) {
      list.scrollTo({ top: nextScrollTop });
    }
  }, [expanded, resolvedActiveItemKey]);

  return (
    <>
      <EditorTocOperationObserver onRefresh={refreshHeadingList} />
      {headingList.length > 0 ? (
        <nav
          aria-label={m.editor_block_toc()}
          className={cn(
            'fixed top-[30vh] right-5 z-20 hidden min-[1280px]:block',
            className
          )}
          onMouseEnter={() => setMouseInToc(true)}
          onMouseLeave={() => setMouseInToc(false)}
          onFocusCapture={() => setHasFocus(true)}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setHasFocus(false);
            }
          }}
        >
          <div
            className={cn(
              'overflow-hidden transition-[width,padding,background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
              expanded
                ? 'w-[clamp(14rem,18vw,15rem)] rounded-md border border-border/80 bg-popover p-2 shadow-[0_10px_30px_rgba(15,15,15,0.10)]'
                : 'w-10 rounded-md border border-transparent bg-transparent px-2 py-1.5'
            )}
          >
            <div
              ref={tocListRef}
              className="max-h-[56vh] space-y-px overflow-y-auto overscroll-contain scrollbar-none"
            >
              {headingList.map((item) => {
                const depth = Math.min(item.depth, 3);
                const itemKey = getItemKey(item);
                const active = itemKey === resolvedActiveItemKey;

                return (
                  <button
                    key={itemKey}
                    type="button"
                    data-active={active || undefined}
                    aria-current={active ? 'location' : undefined}
                    aria-label={item.title}
                    title={expanded ? undefined : item.title}
                    className={cn(
                      'group/toc-item flex h-8 w-full min-w-0 items-center text-sm leading-5 outline-none transition-colors',
                      expanded
                        ? cn(
                            'rounded-sm pr-2 text-left focus-visible:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/40',
                            depthIndent[depth],
                            'font-normal text-muted-foreground hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-primary data-[active=true]:hover:text-primary'
                          )
                        : 'justify-end px-0'
                    )}
                    onClick={(event) => onContentClick(event, item)}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate transition-opacity duration-100 motion-reduce:transition-none',
                        expanded
                          ? 'opacity-100 delay-75'
                          : 'pointer-events-none opacity-0'
                      )}
                    >
                      {item.title}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-0.5 shrink-0 rounded-full transition-[width,opacity,background-color] duration-100 motion-reduce:transition-none',
                        expanded
                          ? 'w-0 opacity-0'
                          : cn(depthMarkerWidth[depth], 'opacity-100'),
                        'bg-border group-data-[active=true]/toc-item:bg-foreground'
                      )}
                    />
                  </button>
                );
              })}
              {headingList.length >= tocListTailMinimumItems ? (
                <div
                  aria-hidden="true"
                  className="h-[calc(28vh-1rem)] min-h-24 shrink-0"
                  data-toc-scroll-tail="true"
                />
              ) : null}
            </div>
          </div>
        </nav>
      ) : null}
    </>
  );
}
