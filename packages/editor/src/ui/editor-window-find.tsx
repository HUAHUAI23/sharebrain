// 为窗口化正文提供模型级全文查找，并以非编辑选区高亮定位命中。
import * as React from 'react';

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { ElementApi, NodeApi, type Value } from 'platejs';
import {
  useEditorRef,
  useEditorVersion,
} from 'platejs/react';

import { m } from '@sharebrain/i18n';
import { Button } from '@sharebrain/ui/components/button';
import { Input } from '@sharebrain/ui/components/input';

import {
  buildEditableWindowTextIndex,
  findEditableWindowTextIndexMatches,
  shouldNavigateEditableWindowFind,
} from '../lib/editable-window-find-core';
import { useEditableChunkWindow } from './editable-chunk-window';

const editorFindHighlightName = 'sharebrain-editor-find-active';

const clearEditorFindHighlight = () => {
  if (typeof CSS === 'undefined' || !CSS.highlights) return;

  CSS.highlights.delete(editorFindHighlightName);
};

const setEditorFindHighlight = (range: Range) => {
  if (
    typeof CSS === 'undefined' ||
    !CSS.highlights ||
    typeof Highlight === 'undefined'
  ) {
    return;
  }

  CSS.highlights.set(editorFindHighlightName, new Highlight(range));
};

export function EditorWindowFind() {
  const editor = useEditorRef();
  const chunkWindow = useEditableChunkWindow();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const navigationRevisionRef = React.useRef(0);
  const [open, setOpen] = React.useState(false);

  const close = React.useCallback(() => {
    navigationRevisionRef.current += 1;
    clearEditorFindHighlight();
    setOpen(false);
    editor.tf.focus();
  }, [editor]);

  React.useEffect(() => clearEditorFindHighlight, []);

  React.useEffect(() => {
    if (!chunkWindow.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      if (open && event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [chunkWindow.enabled, close, open]);

  if (!chunkWindow.enabled || !open) return null;

  return (
    <EditorWindowFindPanel
      inputRef={inputRef}
      navigationRevisionRef={navigationRevisionRef}
      onClose={close}
    />
  );
}

function EditorWindowFindPanel({
  inputRef,
  navigationRevisionRef,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  navigationRevisionRef: React.RefObject<number>;
  onClose: () => void;
}) {
  const editor = useEditorRef();
  const editorVersion = useEditorVersion();
  const chunkWindow = useEditableChunkWindow();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [composing, setComposing] = React.useState(false);
  const textIndex = React.useMemo(
    () => buildEditableWindowTextIndex(editor.children as Value),
    [editor.children, editorVersion]
  );
  const matches = React.useMemo(
    () =>
      findEditableWindowTextIndexMatches(
        editor.children as Value,
        textIndex,
        query
      ),
    [editor.children, query, textIndex]
  );

  const navigateTo = React.useCallback(
    async (nextIndex: number) => {
      const match = matches[nextIndex];

      if (!match) return;

      const revision = navigationRevisionRef.current + 1;
      navigationRevisionRef.current = revision;
      clearEditorFindHighlight();
      const node = NodeApi.getIf(editor, match.blockPath);

      if (!ElementApi.isElement(node)) return;
      if (match.blockId && node.id !== match.blockId) return;

      const blockId = typeof node.id === 'string' ? node.id : match.blockId;
      const element = await chunkWindow.revealBlock(blockId, match.blockPath);

      if (navigationRevisionRef.current !== revision || !element?.isConnected) {
        return;
      }

      let domRange: Range | null = null;

      try {
        domRange = editor.api.toDOMRange(match.range) ?? null;
      } catch {
        domRange = null;
      }

      if (navigationRevisionRef.current !== revision) return;

      if (domRange) setEditorFindHighlight(domRange);
      element.scrollIntoView({ behavior: 'auto', block: 'center' });
    },
    [chunkWindow, editor, matches]
  );

  React.useEffect(() => {
    if (
      !shouldNavigateEditableWindowFind({
        composing,
        matchCount: matches.length,
        open: true,
      })
    ) {
      if (!composing && matches.length === 0) {
        navigationRevisionRef.current += 1;
        clearEditorFindHighlight();
      }
      return;
    }

    const nextIndex = Math.min(activeIndex, matches.length - 1);

    if (nextIndex !== activeIndex) setActiveIndex(nextIndex);
    void navigateTo(nextIndex);
  }, [activeIndex, composing, matches, navigateTo]);

  const move = (direction: -1 | 1) => {
    if (matches.length === 0) return;

    setActiveIndex((current) =>
      (current + direction + matches.length) % matches.length
    );
  };

  return (
    <>
      <style>{`::highlight(${editorFindHighlightName}) {
        background: color-mix(in oklab, var(--primary) 30%, transparent);
        color: inherit;
      }`}</style>
      <div
        role="search"
        aria-label={m.editor_find_document()}
        className="fixed top-16 right-5 z-40 flex h-11 w-[min(24rem,calc(100vw-2rem))] items-center gap-1 rounded-md border border-border bg-popover p-1.5 shadow-md"
      >
        <Search aria-hidden="true" className="ml-1 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          aria-label={m.editor_find_document()}
          placeholder={m.editor_find_placeholder()}
          className="h-8 min-w-0 flex-1 bg-transparent"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onCompositionStart={() => {
            navigationRevisionRef.current += 1;
            setComposing(true);
          }}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              composing ||
              event.nativeEvent.isComposing
            ) {
              return;
            }
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          }}
        />
        <span
          aria-live="polite"
          className="min-w-14 whitespace-nowrap text-center text-muted-foreground text-xs"
        >
          {matches.length > 0
            ? m.editor_find_position({
                current: activeIndex + 1,
                total: matches.length,
              })
            : m.editor_find_empty()}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.editor_find_previous()}
          disabled={matches.length === 0}
          onClick={() => move(-1)}
        >
          <ChevronUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.editor_find_next()}
          disabled={matches.length === 0}
          onClick={() => move(1)}
        >
          <ChevronDown />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.editor_find_close()}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </>
  );
}
