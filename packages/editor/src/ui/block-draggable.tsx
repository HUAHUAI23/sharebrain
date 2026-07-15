// 提供块级拖拽、插入和上下文菜单，并保持滚动热路径不读取布局。
import * as React from 'react';

import { DndPlugin, useDndNode, useDropLine } from '@platejs/dnd';
import { expandListItemsWithChildren } from '@platejs/list';
import { BlockMenuPlugin, BlockSelectionPlugin } from '@platejs/selection/react';
import { GripVertical, Plus } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { type TElement, isType, KEYS, PathApi } from 'platejs';
import { createPortal } from 'react-dom';
import {
  type PlateEditor,
  type PlateElementProps,
  type RenderNodeWrapper,
  MemoizedChildren,
  useEditorContainerRef,
  useEditorRef,
  useElement,
  usePluginOption,
} from 'platejs/react';
import { useSelected } from 'platejs/react';

import { Button } from '@sharebrain/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@sharebrain/ui/components/tooltip';
import { cn } from '@sharebrain/ui/lib/utils';

import { CARET_CONTEXT_MENU_ID } from './block-context-menu';

const UNDRAGGABLE_KEYS = [KEYS.column, KEYS.tr, KEYS.td];

const BLOCK_TOOLBAR_MARGIN_TOP: Record<string, string> = {
  [KEYS.blockquote]: '0.25rem',
  [KEYS.callout]: '0.25rem',
  [KEYS.equation]: '0.25rem',
  [KEYS.file]: '1px',
  [KEYS.h1]: '3.6rem',
  [KEYS.h2]: '2.1rem',
  [KEYS.h3]: '1.25rem',
  [KEYS.h4]: '0.84375rem',
  [KEYS.h5]: '0.84375rem',
  [KEYS.h6]: '0.75rem',
};

export const getBlockToolbarTop = (type: string): string => {
  const marginTop = BLOCK_TOOLBAR_MARGIN_TOP[type];

  return marginTop ? `calc(${marginTop} + 3px)` : '3px';
};

export function BlockGutterVisibility({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useEditorContainerRef();
  const scrollShieldRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    const scrollShield = scrollShieldRef.current;

    if (!container || !scrollShield) return;

    let activeGutter: HTMLElement | null = null;
    let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
    let shieldActive = false;

    const clearActiveGutter = () => {
      activeGutter?.style.removeProperty('opacity');
      activeGutter = null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      const block =
        target instanceof Element
          ? target.closest<HTMLElement>('.slate-blockShell')
          : null;
      const nextGutter = block?.querySelector<HTMLElement>(
        ':scope > .slate-gutterLeft'
      );

      if (nextGutter === activeGutter) return;

      clearActiveGutter();

      if (nextGutter) {
        nextGutter.style.opacity = '1';
        activeGutter = nextGutter;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      const belongsToEditor =
        target === scrollShield ||
        (target instanceof Node && container.contains(target));

      if (!belongsToEditor) return;

      clearActiveGutter();

      if (!shieldActive) {
        scrollShield.style.pointerEvents = 'auto';
        shieldActive = true;
      }
      if (scrollEndTimer) clearTimeout(scrollEndTimer);

      scrollEndTimer = setTimeout(() => {
        scrollShield.style.removeProperty('pointer-events');
        shieldActive = false;
        scrollEndTimer = null;
      }, 120);
    };

    container.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });
    container.addEventListener('mouseleave', clearActiveGutter);
    window.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: true,
    });

    return () => {
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      clearActiveGutter();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('mouseleave', clearActiveGutter);
      window.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [containerRef]);

  return (
    <>
      {children}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <div
              ref={scrollShieldRef}
              aria-hidden="true"
              className="pointer-events-none fixed inset-0 z-[100]"
              contentEditable={false}
              style={{ contain: 'strict', transform: 'translateZ(0)' }}
            />,
            document.body
          )}
    </>
  );
}

export const BlockDraggable: RenderNodeWrapper = (props) => {
  const { editor, element, path } = props;

  const enabled = React.useMemo(() => {
    if (editor.dom.readOnly) return false;

    if (path.length === 1 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      return true;
    }
    if (path.length === 3 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      const block = editor.api.some({
        at: path,
        match: {
          type: editor.getType(KEYS.column),
        },
      });

      if (block) {
        return true;
      }
    }
    if (path.length === 4 && !isType(editor, element, UNDRAGGABLE_KEYS)) {
      const block = editor.api.some({
        at: path,
        match: {
          type: editor.getType(KEYS.table),
        },
      });

      if (block) {
        return true;
      }
    }

    return false;
  }, [editor, element, path]);

  if (!enabled) return;

  return (props) => <DeferredDraggable {...props} />;
};

function DeferredDraggable(props: PlateElementProps) {
  const { children, editor, element, path } = props;
  const [interactionReady, setInteractionReady] = React.useState(false);
  const [controlsActive, setControlsActive] = React.useState(false);
  const nodeRef = React.useRef<HTMLDivElement>(null);
  const previewRef = React.useRef<HTMLDivElement>(null);

  const activate = () => {
    setInteractionReady(true);
    setControlsActive(true);
  };

  return (
    <div
      className="slate-blockShell relative"
      onPointerDownCapture={activate}
      onPointerEnter={activate}
      onPointerLeave={() => setControlsActive(false)}
      onDragEnterCapture={() => setInteractionReady(true)}
    >
      {interactionReady ? (
        <DraggableBehavior
          editor={editor}
          element={element}
          path={path}
          nodeRef={nodeRef}
          previewRef={previewRef}
          controlsActive={controlsActive}
        />
      ) : null}
      <BlockContent
        key="content"
        ref={nodeRef}
        editor={editor}
        element={element}
        showDropLine={interactionReady}
      >
        {children}
      </BlockContent>
    </div>
  );
}

function DraggableBehavior({
  controlsActive,
  editor,
  element,
  nodeRef,
  path,
  previewRef,
}: Pick<PlateElementProps, 'editor' | 'element' | 'path'> & {
  controlsActive: boolean;
  nodeRef: React.RefObject<HTMLDivElement | null>;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;

  const { dragRef: handleRef, isAboutToDrag, isDragging } = useDndNode({
    element,
    multiplePreviewRef: previewRef,
    nodeRef,
    onDropHandler: (_, { dragItem }) => {
      const id = (dragItem as { id: string[] | string }).id;

      if (blockSelectionApi) {
        blockSelectionApi.add(id);
      }
      resetPreview();
    },
  });

  const isInColumn = path.length === 3;
  const isInTable = path.length === 4;

  const [previewTop, setPreviewTop] = React.useState(0);
  const showControls = controlsActive || isAboutToDrag || isDragging;

  const resetPreview = () => {
    if (previewRef.current) {
      previewRef.current.replaceChildren();
      previewRef.current?.classList.add('hidden');
    }
  };

  // clear up virtual multiple preview when drag end
  React.useEffect(() => {
    if (!isDragging) {
      resetPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  React.useEffect(() => {
    if (isAboutToDrag) {
      previewRef.current?.classList.remove('opacity-0');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAboutToDrag]);

  React.useEffect(() => {
    const shell = nodeRef.current?.parentElement;

    shell?.classList.toggle('opacity-50', isDragging);

    return () => shell?.classList.remove('opacity-50');
  }, [isDragging, nodeRef]);

  return (
    <>
      {showControls && !isInTable && (
        <Gutter>
          <div
            className={cn(
              'slate-blockToolbarWrapper',
              'flex h-[1.5em]',
              isInColumn && 'h-4'
            )}
          >
            <div
              className={cn(
                'slate-blockToolbar relative w-11',
                'pointer-events-auto mr-1 flex items-center',
                isInColumn && 'mr-1.5'
              )}
            >
              <div
                className="absolute left-0 flex h-6 w-full items-center gap-px"
                style={{ top: getBlockToolbarTop(element.type) }}
              >
                <InsertBelowButton />
                <Button
                  ref={(node) => {
                    handleRef(node);
                  }}
                  variant="ghost"
                  className="h-6 w-5 shrink-0 p-0"
                  data-plate-prevent-deselect
                >
                  <DragHandle
                    isDragging={isDragging}
                    previewRef={previewRef}
                    resetPreview={resetPreview}
                    setPreviewTop={setPreviewTop}
                  />
                </Button>
              </div>
            </div>
          </div>
        </Gutter>
      )}

      {showControls && (
        <div
          ref={previewRef}
          className={cn('-left-0 absolute hidden w-full')}
          style={{ top: `${-previewTop}px` }}
          contentEditable={false}
        />
      )}
    </>
  );
}

const BlockContent = React.forwardRef<
  HTMLDivElement,
  Pick<PlateElementProps, 'children' | 'editor' | 'element'> & {
    showDropLine: boolean;
  }
>(function BlockContent(
  { children, editor, element, showDropLine },
  nodeRef
) {
  return (
    <div
      ref={nodeRef}
      className="slate-blockWrapper flow-root"
      onContextMenuCapture={(event) => {
        // 光标（无选中内容）在本块内且未块选时，plate 会在元素层
        // stopPropagation 放行浏览器原生菜单；必须在捕获阶段抢先拦截，
        // 改为唤起光标迷你菜单（粘贴）。判定条件与 plate 的
        // addOnContextMenu 保持一致。
        if (editor.dom.readOnly) return;
        if (!editor.selection || editor.api.isExpanded()) return;
        if (
          editor.getOption(
            BlockSelectionPlugin,
            'isSelected',
            element.id as string,
          )
        ) {
          return;
        }

        const nodeEntry = editor.api.above();
        const elementPath = editor.api.findPath(element);

        if (
          !nodeEntry ||
          !elementPath ||
          !PathApi.isCommon(elementPath, nodeEntry[1]) ||
          editor.api.isVoid(nodeEntry[0] as TElement)
        ) {
          return;
        }

        const target = event.target as HTMLElement;

        if (target.dataset?.plateOpenContextMenu === 'true') return;

        event.preventDefault();
        event.stopPropagation();

        const position = { x: event.clientX, y: event.clientY };

        setTimeout(() => {
          editor
            .getApi(BlockMenuPlugin)
            .blockMenu.show(CARET_CONTEXT_MENU_ID, position);
        }, 0);
      }}
      onContextMenu={(event) =>
        editor
          .getApi(BlockSelectionPlugin)
          .blockSelection.addOnContextMenu({ element, event })
      }
    >
      <MemoizedChildren>{children}</MemoizedChildren>
      {showDropLine ? <DropLine /> : null}
    </div>
  );
});

function Gutter({
  children,
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const isSelectionAreaVisible = usePluginOption(
    BlockSelectionPlugin,
    'isSelectionAreaVisible'
  );
  const selected = useSelected();

  return (
    <div
      {...props}
      className={cn(
        'slate-gutterLeft',
        '-translate-x-full absolute top-0 z-50 flex h-full cursor-text hover:opacity-100 sm:opacity-0',
        isSelectionAreaVisible && 'hidden',
        !selected && 'opacity-0',
        className
      )}
      contentEditable={false}
    >
      {children}
    </div>
  );
}

const DragHandle = React.memo(function DragHandle({
  isDragging,
  previewRef,
  resetPreview,
  setPreviewTop,
}: {
  isDragging: boolean;
  previewRef: React.RefObject<HTMLDivElement | null>;
  resetPreview: () => void;
  setPreviewTop: (top: number) => void;
}) {
  const editor = useEditorRef();
  const element = useElement();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex size-full items-center justify-center"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            // 拖拽结束瞬间部分浏览器仍会派发 click，不要误开菜单。
            if (isDragging) return;

            const blockSelectionApi =
              editor.getApi(BlockSelectionPlugin).blockSelection;
            const elementId = element.id as string;
            const isBlockSelected = editor.getOption(
              BlockSelectionPlugin,
              'isSelected',
              elementId,
            );

            if (!isBlockSelected) {
              // 文本选区跨多个块且覆盖当前块时，把整个选区转成块选择，
              // 让菜单作用于所有选中内容而不是单独这一行。
              const selectedBlocks = editor.api.isExpanded()
                ? editor.api.blocks()
                : [];
              const coversCurrent = selectedBlocks.some(
                ([node]) => node.id === elementId,
              );

              if (coversCurrent && selectedBlocks.length > 1) {
                blockSelectionApi.set(
                  selectedBlocks.map(([node]) => node.id as string),
                );
              } else {
                blockSelectionApi.set(elementId);
              }
            }

            blockSelectionApi.focus();

            // Reuse the right-click block menu by dispatching a native
            // contextmenu event at the handle position.
            e.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: e.clientX,
                clientY: e.clientY,
              }),
            );
          }}
          onMouseDown={(e) => {
            resetPreview();

            if ((e.button !== 0 && e.button !== 2) || e.shiftKey) return;

            const blockSelection = editor
              .getApi(BlockSelectionPlugin)
              .blockSelection.getNodes({ sort: true });

            let selectionNodes =
              blockSelection.length > 0
                ? blockSelection
                : editor.api.blocks({ mode: 'highest' });

            // If current block is not in selection, use it as the starting point
            if (!selectionNodes.some(([node]) => node.id === element.id)) {
              selectionNodes = [[element, editor.api.findPath(element)!]];
            }

            // Process selection nodes to include list children
            const blocks = expandListItemsWithChildren(
              editor,
              selectionNodes
            ).map(([node]) => node);

            if (blockSelection.length === 0) {
              editor.tf.blur();
              editor.tf.collapse();
            }

            const elements = createDragPreviewElements(editor, blocks);
            previewRef.current?.append(...elements);
            previewRef.current?.classList.remove('hidden');
            previewRef.current?.classList.add('opacity-0');
            editor.setOption(DndPlugin, 'multiplePreviewRef', previewRef);

            editor
              .getApi(BlockSelectionPlugin)
              .blockSelection.set(blocks.map((block) => block.id as string));
          }}
          onMouseEnter={() => {
            if (isDragging) return;

            const blockSelection = editor
              .getApi(BlockSelectionPlugin)
              .blockSelection.getNodes({ sort: true });

            let selectedBlocks =
              blockSelection.length > 0
                ? blockSelection
                : editor.api.blocks({ mode: 'highest' });

            // If current block is not in selection, use it as the starting point
            if (!selectedBlocks.some(([node]) => node.id === element.id)) {
              selectedBlocks = [[element, editor.api.findPath(element)!]];
            }

            // Process selection to include list children
            const processedBlocks = expandListItemsWithChildren(
              editor,
              selectedBlocks
            );

            const ids = processedBlocks.map((block) => block[0].id as string);

            if (ids.length > 1 && ids.includes(element.id as string)) {
              const previewTop = calculatePreviewTop(editor, {
                blocks: processedBlocks.map((block) => block[0]),
                element,
              });
              setPreviewTop(previewTop);
            } else {
              setPreviewTop(0);
            }
          }}
          onMouseUp={() => {
            resetPreview();
          }}
          data-plate-prevent-deselect
          role="button"
        >
          <GripVertical className="text-muted-foreground" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{m.editor_drag_to_move()}</TooltipContent>
    </Tooltip>
  );
});

const InsertBelowButton = React.memo(function InsertBelowButton() {
  const editor = useEditorRef();
  const element = useElement();

  const insertBlock = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const path = editor.api.findPath(element);

    if (!path) return;

    // 当前行本身是空段落时原地唤起搜索，不再额外插入一行。
    const isEmptyParagraph =
      element.type === editor.getType(KEYS.p) &&
      editor.api.isEmpty(element as TElement);

    if (isEmptyParagraph && !event.altKey) {
      const start = editor.api.start(path);

      if (start) {
        editor.tf.select(start);
      }
    } else {
      const at = event.altKey ? path : PathApi.next(path);

      editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
        at,
        select: true,
      });
    }

    editor.tf.focus();
    // Open the slash menu after focus lands back in the editable, otherwise
    // the combobox stays hidden because the button still owns DOM focus.
    setTimeout(() => {
      editor.tf.insertText('/');
    }, 0);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          className="h-6 w-5 shrink-0 p-0"
          onClick={insertBlock}
          onMouseDown={(e) => e.preventDefault()}
          data-plate-prevent-deselect
        >
          <Plus className="text-muted-foreground" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-center">
          {m.editor_add_block_below()}
          <br />
          {m.editor_add_block_above_hint()}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

const DropLine = React.memo(function DropLine({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const { dropLine } = useDropLine();

  if (!dropLine) return null;

  return (
    <div
      {...props}
      className={cn(
        'slate-dropLine',
        'absolute inset-x-0 h-0.5 opacity-100 transition-opacity',
        'bg-brand/50',
        dropLine === 'top' && '-top-px',
        dropLine === 'bottom' && '-bottom-px',
        className
      )}
    />
  );
});

const createDragPreviewElements = (
  editor: PlateEditor,
  blocks: TElement[]
): HTMLElement[] => {
  const elements: HTMLElement[] = [];
  const ids: string[] = [];

  /**
   * Remove data attributes from the element to avoid recognized as slate
   * elements incorrectly.
   */
  const removeDataAttributes = (element: HTMLElement) => {
    Array.from(element.attributes).forEach((attr) => {
      if (
        attr.name.startsWith('data-slate') ||
        attr.name.startsWith('data-block-id')
      ) {
        element.removeAttribute(attr.name);
      }
    });

    Array.from(element.children).forEach((child) => {
      removeDataAttributes(child as HTMLElement);
    });
  };

  const resolveElement = (node: TElement, index: number) => {
    const domNode = editor.api.toDOMNode(node)!;
    const newDomNode = domNode.cloneNode(true) as HTMLElement;

    // Apply visual compensation for horizontal scroll
    const applyScrollCompensation = (
      original: Element,
      cloned: HTMLElement
    ) => {
      const scrollLeft = original.scrollLeft;

      if (scrollLeft > 0) {
        // Create a wrapper to handle the scroll offset
        const scrollWrapper = document.createElement('div');
        scrollWrapper.style.overflow = 'hidden';
        scrollWrapper.style.width = `${original.clientWidth}px`;

        // Create inner container with the full content
        const innerContainer = document.createElement('div');
        innerContainer.style.transform = `translateX(-${scrollLeft}px)`;
        innerContainer.style.width = `${original.scrollWidth}px`;

        // Move all children to the inner container
        while (cloned.firstChild) {
          innerContainer.append(cloned.firstChild);
        }

        // Apply the original element's styles to maintain appearance
        const originalStyles = window.getComputedStyle(original);
        cloned.style.padding = '0';
        innerContainer.style.padding = originalStyles.padding;

        scrollWrapper.append(innerContainer);
        cloned.append(scrollWrapper);
      }
    };

    applyScrollCompensation(domNode, newDomNode);

    ids.push(node.id as string);
    const wrapper = document.createElement('div');
    wrapper.append(newDomNode);
    wrapper.style.display = 'flow-root';

    const lastDomNode = blocks[index - 1];

    if (lastDomNode) {
      const lastDomNodeRect = editor.api
        .toDOMNode(lastDomNode)!
        .parentElement!.getBoundingClientRect();

      const domNodeRect = domNode.parentElement!.getBoundingClientRect();

      const distance = domNodeRect.top - lastDomNodeRect.bottom;

      // Check if the two elements are adjacent (touching each other)
      if (distance > 15) {
        wrapper.style.marginTop = `${distance}px`;
      }
    }

    removeDataAttributes(newDomNode);
    elements.push(wrapper);
  };

  blocks.forEach((node, index) => {
    resolveElement(node, index);
  });

  editor.setOption(DndPlugin, 'draggingId', ids);

  return elements;
};

const calculatePreviewTop = (
  editor: PlateEditor,
  {
    blocks,
    element,
  }: {
    blocks: TElement[];
    element: TElement;
  }
): number => {
  const child = editor.api.toDOMNode(element)!;
  const editable = editor.api.toDOMNode(editor)!;
  const firstSelectedChild = blocks[0]!;

  const firstDomNode = editor.api.toDOMNode(firstSelectedChild)!;
  // Get editor's top padding
  const editorPaddingTop = Number(
    window.getComputedStyle(editable).paddingTop.replace('px', '')
  );

  // Calculate distance from first selected node to editor top
  const firstNodeToEditorDistance =
    firstDomNode.getBoundingClientRect().top -
    editable.getBoundingClientRect().top -
    editorPaddingTop;

  // Get margin top of first selected node
  const firstMarginTopString = window.getComputedStyle(firstDomNode).marginTop;
  const marginTop = Number(firstMarginTopString.replace('px', ''));

  // Calculate distance from current node to editor top
  const currentToEditorDistance =
    child.getBoundingClientRect().top -
    editable.getBoundingClientRect().top -
    editorPaddingTop;

  const currentMarginTopString = window.getComputedStyle(child).marginTop;
  const currentMarginTop = Number(currentMarginTopString.replace('px', ''));

  const previewElementsTopDistance =
    currentToEditorDistance -
    firstNodeToEditorDistance +
    marginTop -
    currentMarginTop;

  return previewElementsTopDistance;
};
