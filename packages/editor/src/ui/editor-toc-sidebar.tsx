// 从已提交的标题 DOM 构建轻量大纲，避免在编辑器渲染期遍历整棵 Slate 树。
import { isHeading } from '@platejs/toc';
import { ElementApi, NodeApi } from 'platejs';
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

export type EditorTocSidebarProps = {
  className?: string;
};

type TocHeadingElement = {
  element: Element;
  key: string;
};

type TocHeading = {
  depth: number;
  element: HTMLElement;
  id: string;
  title: string;
  type: string;
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
const tocItemStep = 33;
const tocActiveItemLead = 96;

const headingSelector = [1, 2, 3, 4, 5, 6]
  .map((depth) => `h${depth}[data-block-id]`)
  .join(',');

const getItemKey = (item: TocHeading) => item.id;

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

const areHeadingListsEqual = (left: TocHeading[], right: TocHeading[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index];

    return (
      other !== undefined &&
      item.depth === other.depth &&
      item.element === other.element &&
      item.id === other.id &&
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

const getScrollRoot = (scrollElement: HTMLDivElement | null) =>
  scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight
    ? scrollElement
    : null;

export function EditorTocSidebar({ className }: EditorTocSidebarProps) {
  const editor = useEditorRef();
  const scrollRef = useScrollRef();
  const editorVersion = useEditorVersion();
  const [headingList, setHeadingList] = useState<TocHeading[]>([]);
  const headingListInitializedRef = useRef(false);
  const refreshHeadingList =
    !headingListInitializedRef.current ||
    shouldRefreshTocHeadingList(editor, editor.operations);
  const [mouseInToc, setMouseInToc] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const tocListRef = useRef<HTMLDivElement>(null);
  const tocItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeItemKeyRef = useRef<string | null>(null);
  const expanded = mouseInToc || hasFocus;

  useEffect(() => {
    if (!refreshHeadingList) return;

    const animationFrame = requestAnimationFrame(() => {
      const editorElement = editor.api.toDOMNode(editor);

      if (!editorElement) return;

      headingListInitializedRef.current = true;
      const nextHeadingList = getHeadingListFromDom(editorElement);

      setHeadingList((current) =>
        areHeadingListsEqual(current, nextHeadingList)
          ? current
          : nextHeadingList
      );
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [editor, editorVersion, refreshHeadingList]);

  const setActiveTocItem = useCallback(
    (nextActiveKey: string | null) => {
      if (!nextActiveKey || activeItemKeyRef.current === nextActiveKey) return;

      const previousElement = activeItemKeyRef.current
        ? tocItemRefs.current.get(activeItemKeyRef.current)
        : null;
      const nextElement = tocItemRefs.current.get(nextActiveKey);

      previousElement?.removeAttribute('data-active');
      previousElement?.removeAttribute('aria-current');
      nextElement?.setAttribute('data-active', 'true');
      nextElement?.setAttribute('aria-current', 'location');
      activeItemKeyRef.current = nextActiveKey;

      const activeIndex = headingList.findIndex(
        (item) => getItemKey(item) === nextActiveKey
      );

      if (activeIndex >= 0) {
        tocListRef.current?.scrollTo({
          top: Math.max(0, activeIndex * tocItemStep - tocActiveItemLead),
        });
      }
    },
    [headingList]
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
      return item.element.isConnected
        ? [{ element: item.element, key: getItemKey(item) }]
        : [];
    });
    let editorPointX: number | null = null;
    let animationFrame = 0;
    let pendingScrollRoot: HTMLDivElement | null = null;

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

      const target = document.elementFromPoint(editorPointX, pointY);

      if (!target || !editorElement.contains(target)) return;

      let currentBlock = target.closest('[data-block-id]');

      if (!currentBlock) return;

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
    const handleWindowScroll = () => scheduleUpdate(null);
    const handleEditorScroll = () => scheduleUpdate(scrollElement);
    const handleResize = () => {
      editorPointX = null;
    };

    scrollElement?.addEventListener('scroll', handleEditorScroll, {
      passive: true,
    });
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      scrollElement?.removeEventListener('scroll', handleEditorScroll);
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [editor, headingList, scrollRef, setActiveTocItem]);

  const onContentClick = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      item: TocHeading,
      behavior: ScrollBehavior = 'smooth'
    ) => {
      event.preventDefault();

      const element = item.element;

      if (!element.isConnected) return;

      const scrollRoot = getScrollRoot(scrollRef.current);

      if (scrollRoot) {
        const rootRect = scrollRoot.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        scrollRoot.scrollTo({
          behavior,
          top:
            scrollRoot.scrollTop +
            elementRect.top -
            rootRect.top -
            tocTopOffset,
        });
      } else {
        window.scrollTo({
          behavior,
          top: window.scrollY + element.getBoundingClientRect().top - tocTopOffset,
        });
      }

    },
    [scrollRef]
  );

  if (headingList.length === 0) return null;

  return (
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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
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
          className={cn(
            'max-h-[56vh] overflow-y-auto overscroll-contain scrollbar-none',
            expanded ? 'space-y-px' : 'space-y-1'
          )}
        >
          {headingList.map((item) => {
            const depth = Math.min(item.depth, 3);
            const itemKey = getItemKey(item);
            const active =
              itemKey ===
              (activeItemKeyRef.current ??
                (headingList[0] ? getItemKey(headingList[0]) : null));

            return (
              <button
                ref={(element) => {
                  if (element) {
                    tocItemRefs.current.set(itemKey, element);
                  } else {
                    tocItemRefs.current.delete(itemKey);
                  }
                }}
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
        </div>
      </div>
    </nav>
  );
}
