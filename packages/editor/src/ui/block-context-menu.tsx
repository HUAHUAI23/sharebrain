

import * as React from 'react';

import { AIChatPlugin } from '@platejs/ai/react';
import {
  BLOCK_CONTEXT_MENU_ID,
  BlockMenuPlugin,
  BlockSelectionPlugin,
} from '@platejs/selection/react';
import * as Popover from '@radix-ui/react-popover';
import { m } from '@sharebrain/i18n';
import { ClipboardIcon } from 'lucide-react';
import { KEYS } from 'platejs';
import {
  useEditorPlugin,
  useEditorReadOnly,
  usePluginOption,
} from 'platejs/react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@sharebrain/ui/components/context-menu';
import { cn } from '@sharebrain/ui/lib/utils';
import { setBlockType } from '../transforms';
import { useIsTouchDevice } from '../hooks/use-is-touch-device';

/** 光标（无选中内容）处右键唤起的迷你菜单。 */
export const CARET_CONTEXT_MENU_ID = 'caret-context-menu';

type Value = 'askAI' | 'copy' | 'cut' | null;

export function BlockContextMenu({ children }: { children: React.ReactNode }) {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const [value, setValue] = React.useState<Value>(null);
  const isTouch = useIsTouchDevice();
  const readOnly = useEditorReadOnly();
  const openId = usePluginOption(BlockMenuPlugin, 'openId');
  const isOpen = openId === BLOCK_CONTEXT_MENU_ID;

  const handleTurnInto = React.useCallback(
    (type: string) => {
      editor
        .getApi(BlockSelectionPlugin)
        .blockSelection.getNodes()
        .forEach(([, path]) => {
          setBlockType(editor, type, { at: path });
        });
    },
    [editor]
  );

  const handleAlign = React.useCallback(
    (align: 'center' | 'left' | 'right') => {
      editor
        .getTransforms(BlockSelectionPlugin)
        .blockSelection.setNodes({ align });
    },
    [editor]
  );

  if (isTouch) {
    return children;
  }

  return (
    <>
      <ContextMenu
      onOpenChange={(open) => {
        if (!open) {
          api.blockMenu.hide();
        }
      }}
      modal={false}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          const dataset = (event.target as HTMLElement).dataset;
          const disabled =
            dataset?.slateEditor === 'true' ||
            readOnly ||
            dataset?.plateOpenContextMenu === 'false';

          if (disabled) return event.preventDefault();

          setTimeout(() => {
            api.blockMenu.show(BLOCK_CONTEXT_MENU_ID, {
              x: event.clientX,
              y: event.clientY,
            });
          }, 0);
        }}
      >
        <div className="w-full">{children}</div>
      </ContextMenuTrigger>
      {isOpen && (
        <ContextMenuContent
          className="w-64"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editor.getApi(BlockSelectionPlugin).blockSelection.focus();

            if (value === 'askAI') {
              editor.getApi(AIChatPlugin).aiChat.show();
            }

            if (value === 'copy') {
              // 菜单关闭、焦点回到块选择输入后再触发原生复制，
              // 走与 ⌘C 相同的 clipboardData 链路（保留块结构，
              // 且不受 navigator.clipboard 的焦点/安全上下文限制）。
              document.execCommand('copy');
            }

            if (value === 'cut') {
              // 同上，走与 ⌘X 相同的链路：复制块结构后删除选中块。
              document.execCommand('cut');
            }

            setValue(null);
          }}
        >
          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() => {
                setValue('askAI');
              }}
            >
              {m.editor_ask_ai()}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                setValue('copy');
              }}
            >
              {m.editor_menu_copy()}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                setValue('cut');
              }}
            >
              {m.editor_menu_cut()}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.removeNodes();
                editor.tf.focus();
              }}
            >
              {m.editor_menu_delete()}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.duplicate();
              }}
            >
              {m.editor_menu_duplicate()}
              {/* <ContextMenuShortcut>⌘ + D</ContextMenuShortcut> */}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>{m.editor_toolbar_turn_into()}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={() => handleTurnInto(KEYS.p)}>
                  {m.editor_block_paragraph()}
                </ContextMenuItem>

                <ContextMenuItem onClick={() => handleTurnInto(KEYS.h1)}>
                  {m.editor_block_h1()}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleTurnInto(KEYS.h2)}>
                  {m.editor_block_h2()}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleTurnInto(KEYS.h3)}>
                  {m.editor_block_h3()}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleTurnInto(KEYS.blockquote)}
                >
                  {m.editor_block_quote()}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>

          <ContextMenuGroup>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(1)
              }
            >
              {m.editor_menu_indent()}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                editor
                  .getTransforms(BlockSelectionPlugin)
                  .blockSelection.setIndent(-1)
              }
            >
              {m.editor_menu_outdent()}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>{m.editor_menu_align()}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={() => handleAlign('left')}>
                  {m.editor_align_left()}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign('center')}>
                  {m.editor_align_center()}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAlign('right')}>
                  {m.editor_align_right()}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
        </ContextMenuContent>
      )}
      </ContextMenu>

      <CaretContextMenu />
    </>
  );
}

/**
 * 光标处（无选中内容）右键唤起的迷你菜单，锚定在鼠标位置。
 * plate 对这种场景默认放行浏览器菜单，block-draggable 会拦截并改开本菜单。
 */
function CaretContextMenu() {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const openId = usePluginOption(BlockMenuPlugin, 'openId');
  const position = usePluginOption(BlockMenuPlugin, 'position');
  const open = openId === CARET_CONTEXT_MENU_ID;

  const anchorRef = React.useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          ({
            bottom: position.y,
            height: 0,
            left: position.x,
            right: position.x,
            top: position.y,
            width: 0,
            x: position.x,
            y: position.y,
            toJSON: () => position,
          }) as DOMRect,
      },
    }),
    [position]
  );

  const handlePaste = React.useCallback(async () => {
    api.blockMenu.hide();
    editor.tf.focus();

    try {
      // 优先读富内容（HTML/图片），走与 ⌘V 相同的 insertData 链路。
      const items = await navigator.clipboard.read();
      const dataTransfer = new DataTransfer();

      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));

        if (imageType) {
          const blob = await item.getType(imageType);
          dataTransfer.items.add(
            new File([blob], `pasted.${imageType.split('/')[1]}`, {
              type: imageType,
            })
          );
        }

        for (const type of ['text/html', 'text/plain'] as const) {
          if (item.types.includes(type)) {
            dataTransfer.setData(type, await (await item.getType(type)).text());
          }
        }
      }

      editor.tf.insertData(dataTransfer);
    } catch {
      // 剪贴板读取被拒绝时退回纯文本。
      const text = await navigator.clipboard.readText().catch(() => '');

      if (text) {
        editor.tf.insertText(text);
      }
    }
  }, [api.blockMenu, editor]);

  if (!open) return null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          api.blockMenu.hide();
          editor.tf.focus();
        }
      }}
    >
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Portal>
        <Popover.Content
          className={cn(
            'z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
          )}
          align="start"
          side="bottom"
          sideOffset={2}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={cn(
              'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
              'hover:bg-accent hover:text-accent-foreground',
              "[&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void handlePaste();
            }}
          >
            <ClipboardIcon />
            {m.editor_menu_paste()}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
