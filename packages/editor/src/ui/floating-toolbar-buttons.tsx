import * as React from 'react';

import type { TElement } from 'platejs';

import { DropdownMenuItemIndicator } from '@radix-ui/react-dropdown-menu';
import { AIChatPlugin } from '@platejs/ai/react';
import {
  BoldIcon,
  CheckIcon,
  ChevronRightIcon,
  Code2Icon,
  EraserIcon,
  HighlighterIcon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { KEYS } from 'platejs';
import {
  useEditorReadOnly,
  useEditorRef,
  useSelectionFragmentProp,
} from 'platejs/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@sharebrain/ui/components/dropdown-menu';
import { Separator } from '@sharebrain/ui/components/separator';
import { cn } from '@sharebrain/ui/lib/utils';

import { getBlockType, setBlockType } from '../transforms';
import { CommentToolbarButton } from './comment-toolbar-button';
import { InlineEquationToolbarButton } from './equation-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { MoreToolbarButton } from './more-toolbar-button';
import { SuggestionToolbarButton } from './suggestion-toolbar-button';
import { ToolbarButton } from './toolbar';
import { turnIntoItems } from './turn-into-toolbar-button';

/** 飞书式竖版选区面板：转换行 + marks 网格 + 评论行 + AI 技能。 */
export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  if (readOnly) {
    return (
      <div className="flex w-60 flex-col">
        <div className="flex items-center gap-0.5 px-0.5 py-0.5">
          <CommentToolbarButton />
          <SuggestionToolbarButton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-60 flex-col">
      <TurnIntoRow />

      <Separator className="my-0.5 bg-border/70" />

      <div className="grid grid-cols-5 place-items-center gap-0.5 px-0.5 py-0.5">
        <MarkToolbarButton
          nodeType={KEYS.bold}
          tooltip={`${m.editor_mark_bold()} (⌘+B)`}
        >
          <BoldIcon />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.italic}
          tooltip={`${m.editor_mark_italic()} (⌘+I)`}
        >
          <ItalicIcon />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.underline}
          tooltip={`${m.editor_mark_underline()} (⌘+U)`}
        >
          <UnderlineIcon />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.strikethrough}
          tooltip={`${m.editor_mark_strikethrough()} (⌘+⇧+M)`}
        >
          <StrikethroughIcon />
        </MarkToolbarButton>
        <ClearMarksButton />

        <LinkToolbarButton />
        <MarkToolbarButton
          nodeType={KEYS.code}
          tooltip={`${m.editor_mark_code()} (⌘+E)`}
        >
          <Code2Icon />
        </MarkToolbarButton>
        <MarkToolbarButton
          nodeType={KEYS.highlight}
          tooltip={m.editor_mark_highlight()}
        >
          <HighlighterIcon />
        </MarkToolbarButton>
        <InlineEquationToolbarButton />
        <MoreToolbarButton />
      </div>

      <Separator className="my-0.5 bg-border/70" />

      <div className="flex items-center gap-0.5 px-0.5 py-0.5">
        <CommentToolbarButton />
        <SuggestionToolbarButton />
      </div>

      <Separator className="my-0.5 bg-border/70" />

      <AISkills />
    </div>
  );
}

function TurnIntoRow() {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  const value = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });
  const selectedItem = React.useMemo(
    () =>
      turnIntoItems.find((item) => item.value === (value ?? KEYS.p)) ??
      turnIntoItems[0]!,
    [value],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
            'hover:bg-accent aria-expanded:bg-accent',
            "[&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground",
          )}
          onPointerEnter={openNow}
          onPointerLeave={closeSoon}
        >
          {selectedItem.icon}
          <span className="flex-1 text-left">{selectedItem.label()}</span>
          <ChevronRightIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="ignore-click-outside/toolbar max-h-[70vh] min-w-[210px] overflow-y-auto"
        side="right"
        align="start"
        sideOffset={6}
        onPointerEnter={openNow}
        onPointerLeave={closeSoon}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.tf.focus();
        }}
      >
        <DropdownMenuRadioGroup
          {...(value === undefined ? {} : { value })}
          onValueChange={(type) => {
            setBlockType(editor, type);
          }}
        >
          {turnIntoItems.map(({ hint, icon, label, value: itemValue }) => (
            <DropdownMenuRadioItem
              key={itemValue}
              className="min-w-[200px] gap-2 pr-14 pl-2 *:first:[span]:hidden"
              value={itemValue}
            >
              <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
                <DropdownMenuItemIndicator>
                  <CheckIcon />
                </DropdownMenuItemIndicator>
              </span>
              {icon}
              {label()}
              {hint && (
                <span className="pointer-events-none absolute right-8 font-mono text-muted-foreground/70 text-xs">
                  {hint}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClearMarksButton() {
  const editor = useEditorRef();

  return (
    <ToolbarButton
      tooltip={m.editor_clear_formatting()}
      onClick={() => {
        editor.tf.removeMarks();
        editor.tf.focus();
      }}
    >
      <EraserIcon />
    </ToolbarButton>
  );
}

const aiSkills = [
  {
    key: 'improveWriting',
    label: () => m.editor_ai_improve_writing(),
    prompt:
      'Improve the writing for clarity and flow, without changing meaning or adding new information. Output the improved content only.',
  },
  {
    key: 'fixSpelling',
    label: () => m.editor_ai_fix_spelling(),
    prompt:
      'Fix spelling, grammar, and punctuation errors, without changing meaning, tone, or adding new information. Output the corrected content only.',
  },
  {
    key: 'simplifyLanguage',
    label: () => m.editor_ai_simplify(),
    prompt:
      'Simplify the language by using clearer and more straightforward wording, without changing meaning. Output the simplified content only.',
  },
  {
    key: 'summarize',
    label: () => m.editor_ai_summarize(),
    prompt: { default: 'Summarize {editor}', selecting: 'Summarize' },
  },
  {
    key: 'explain',
    label: () => m.editor_ai_explain(),
    prompt: { default: 'Explain {editor}', selecting: 'Explain' },
  },
] as const;

function AISkills() {
  const editor = useEditorRef();

  return (
    <div className="flex flex-col px-0.5 pt-1 pb-0.5">
      <div className="select-none px-1.5 pb-1 text-muted-foreground text-xs">
        {m.editor_skills()}
      </div>

      {aiSkills.map((skill) => (
        <button
          key={skill.key}
          type="button"
          className="flex w-full cursor-pointer items-center rounded-sm px-1.5 py-1.5 text-left text-sm outline-none hover:bg-accent"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void editor.getApi(AIChatPlugin).aiChat.submit('', {
              prompt: skill.prompt,
              toolName: 'generate',
            });
          }}
        >
          {skill.label()}
        </button>
      ))}

      <button
        type="button"
        className={cn(
          'mt-1 flex w-full cursor-pointer items-center gap-2 rounded-sm border border-border/70 px-2 py-1.5 text-left text-muted-foreground text-sm outline-none',
          'hover:bg-accent hover:text-foreground',
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor.getApi(AIChatPlugin).aiChat.show();
        }}
      >
        <WandSparklesIcon className="size-4 text-primary" />
        <span className="flex-1">{m.editor_use_ai_edit()}</span>
        <kbd className="font-mono text-muted-foreground/70 text-xs">⌘J</kbd>
      </button>
    </div>
  );
}
