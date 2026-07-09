// 可复用的 Plate 顶部工具面板；宿主只负责放置位置和业务动作。
import * as React from 'react';

import {
  BaselineIcon,
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  PaintBucketIcon,
  StrikethroughIcon,
  UnderlineIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { KEYS } from 'platejs';
import { useEditorReadOnly } from 'platejs/react';

import { cn } from '@sharebrain/ui/lib/utils';

import { AIToolbarButton } from './ai-toolbar-button';
import { AlignToolbarButton } from './align-toolbar-button';
import { FontColorToolbarButton } from './font-color-toolbar-button';
import { FontSizeToolbarButton } from './font-size-toolbar-button';
import { RedoToolbarButton, UndoToolbarButton } from './history-toolbar-button';
import { InsertToolbarButton } from './insert-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
} from './list-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { Toolbar, ToolbarGroup } from './toolbar';
import { TurnIntoToolbarButton } from './turn-into-toolbar-button';

export type EditorFixedToolbarPanelProps = React.ComponentProps<typeof Toolbar> & {
  showAi?: boolean;
};

export function EditorFixedToolbarPanel({
  className,
  showAi = false,
  ...props
}: EditorFixedToolbarPanelProps) {
  const readOnly = useEditorReadOnly();

  if (readOnly) {
    return null;
  }

  return (
    <Toolbar
      aria-label={m.editor_toolbar_label()}
      className={cn(
        'h-11 max-w-full overflow-x-auto rounded-md border border-border/70 bg-background px-1.5 text-foreground shadow-xs',
        className
      )}
      {...props}
    >
      <div className="flex min-w-max items-center">
        <ToolbarGroup>
          <UndoToolbarButton />
          <RedoToolbarButton />
        </ToolbarGroup>

        {showAi ? (
          <ToolbarGroup>
            <AIToolbarButton tooltip={m.editor_toolbar_ai()}>
              <WandSparklesIcon />
            </AIToolbarButton>
          </ToolbarGroup>
        ) : null}

        <ToolbarGroup>
          <InsertToolbarButton />
          <TurnIntoToolbarButton />
          <FontSizeToolbarButton />
        </ToolbarGroup>

        <ToolbarGroup>
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
          <MarkToolbarButton
            nodeType={KEYS.code}
            tooltip={`${m.editor_mark_code()} (⌘+E)`}
          >
            <Code2Icon />
          </MarkToolbarButton>
          <FontColorToolbarButton
            nodeType={KEYS.color}
            tooltip={m.editor_font_color()}
          >
            <BaselineIcon />
          </FontColorToolbarButton>
          <FontColorToolbarButton
            nodeType={KEYS.backgroundColor}
            tooltip={m.editor_font_background()}
          >
            <PaintBucketIcon />
          </FontColorToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup>
          <AlignToolbarButton />
          <NumberedListToolbarButton />
          <BulletedListToolbarButton />
        </ToolbarGroup>

        <ToolbarGroup>
          <LinkToolbarButton />
        </ToolbarGroup>
      </div>
    </Toolbar>
  );
}
