import * as React from 'react';

import { useEmojiDropdownMenuState } from '@platejs/emoji/react';
import * as Popover from '@radix-ui/react-popover';
import type { PluginConfig } from 'platejs';
import { createTPlatePlugin } from 'platejs/react';
import { useEditorPlugin, usePluginOption } from 'platejs/react';

import { EmojiPicker, useLocalizedEmojiI18n } from './emoji-toolbar-button';

type CaretRect = Pick<DOMRect, 'height' | 'width' | 'x' | 'y'>;

/**
 * 在光标位置弹出完整表情卡片，供 slash 菜单等无固定工具栏的入口唤起。
 * 独立 Popover 自带焦点管理，不像行内 ":" 搜索框那样失焦即取消，
 * 因此不受菜单关闭时焦点回收的影响。
 */
type EmojiCaretPickerConfig = PluginConfig<
  'emojiCaretPicker',
  { open: boolean }
>;

export const EmojiCaretPickerPlugin =
  createTPlatePlugin<EmojiCaretPickerConfig>({
    key: 'emojiCaretPicker',
    options: { open: false },
    render: { afterEditable: EmojiCaretPicker },
  });

function toVirtualAnchor(rect: CaretRect) {
  return {
    getBoundingClientRect: () =>
      ({
        ...rect,
        bottom: rect.y + rect.height,
        left: rect.x,
        right: rect.x + rect.width,
        top: rect.y,
        toJSON: () => rect,
      }) as DOMRect,
  };
}

export function EmojiCaretPicker() {
  const { editor, setOption } = useEditorPlugin(EmojiCaretPickerPlugin);
  const open = usePluginOption(EmojiCaretPickerPlugin, 'open');

  const { emojiPickerState, isOpen, setIsOpen } = useEmojiDropdownMenuState({
    closeOnSelect: true,
  });
  const i18n = useLocalizedEmojiI18n(emojiPickerState.i18n);

  const [rect, setRect] = React.useState<CaretRect | null>(null);

  React.useEffect(() => {
    if (!open) return;

    let caretRect: CaretRect | null = null;

    try {
      if (editor.selection) {
        const domRange = editor.api.toDOMRange(editor.selection);
        const bounds = domRange?.getBoundingClientRect();

        if (bounds) {
          caretRect = {
            height: bounds.height,
            width: bounds.width,
            x: bounds.x,
            y: bounds.y,
          };
        }
      }

      if (!caretRect) {
        // 拿不到光标位置（如选区为空）时退回编辑器容器左上角。
        const editorBounds = editor.api
          .toDOMNode(editor)
          ?.getBoundingClientRect();

        if (editorBounds) {
          caretRect = {
            height: 24,
            width: 0,
            x: editorBounds.x,
            y: editorBounds.y,
          };
        }
      }
    } catch {
      caretRect = null;
    }

    setRect(caretRect);
    setIsOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (isOpen || !open) return;

    setOption('open', false);
    setRect(null);
    editor.tf.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const anchorRef = React.useMemo(
    () => (rect ? { current: toVirtualAnchor(rect) } : null),
    [rect]
  );

  if (!open || !anchorRef) return null;

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Portal>
        <Popover.Content
          className="z-100"
          align="start"
          side="bottom"
          sideOffset={4}
        >
          <EmojiPicker
            {...emojiPickerState}
            i18n={i18n}
            isOpen={isOpen}
            setIsOpen={setIsOpen}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
