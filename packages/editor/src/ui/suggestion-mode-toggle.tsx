// 文档顶栏的常驻建议模式开关，复用 Plate SuggestionPlugin 的状态。
import { SuggestionPlugin } from '@platejs/suggestion/react';
import { PencilLineIcon } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { useEditorPlugin, usePluginOption } from 'platejs/react';

import { Button } from '@sharebrain/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@sharebrain/ui/components/tooltip';
import { cn } from '@sharebrain/ui/lib/utils';

export type SuggestionModeToggleState = {
  mode: 'editing' | 'suggesting';
  pressed: boolean;
};

export function getSuggestionModeToggleState(
  isSuggesting: boolean
): SuggestionModeToggleState {
  return {
    mode: isSuggesting ? 'suggesting' : 'editing',
    pressed: isSuggesting,
  };
}

export function SuggestionModeToggle() {
  const { setOption } = useEditorPlugin(SuggestionPlugin);
  const isSuggesting = usePluginOption(SuggestionPlugin, 'isSuggesting');
  const state = getSuggestionModeToggleState(isSuggesting);
  const actionLabel = isSuggesting
    ? m.editor_suggestion_off()
    : m.editor_suggestion_on();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(isSuggesting && 'bg-accent text-brand/80 hover:text-brand/80')}
          aria-label={actionLabel}
          aria-pressed={state.pressed}
          data-suggestion-mode={state.mode}
          onClick={() => setOption('isSuggesting', !isSuggesting)}
          onMouseDown={(event) => event.preventDefault()}
        >
          <PencilLineIcon size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{actionLabel}</TooltipContent>
    </Tooltip>
  );
}
