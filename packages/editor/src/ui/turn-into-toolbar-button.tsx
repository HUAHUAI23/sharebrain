import * as React from 'react';

import type { DropdownMenuProps } from '@radix-ui/react-dropdown-menu';
import type { TElement } from 'platejs';

import { DropdownMenuItemIndicator } from '@radix-ui/react-dropdown-menu';
import {
  CheckIcon,
  ChevronRightIcon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { KEYS } from 'platejs';
import { useEditorRef, useSelectionFragmentProp } from 'platejs/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@sharebrain/ui/components/dropdown-menu';
import { getBlockType, setBlockType } from '../transforms';

import { ToolbarButton, ToolbarMenuGroup } from './toolbar';

type TurnIntoItem = {
  icon: React.ReactNode;
  label: () => string;
  value: string;
  hint?: string;
  keywords?: string[];
};

export const turnIntoItems: TurnIntoItem[] = [
  {
    icon: <PilcrowIcon />,
    keywords: ['paragraph'],
    label: () => m.editor_block_paragraph(),
    value: KEYS.p,
  },
  {
    icon: <Heading1Icon />,
    hint: '#',
    keywords: ['title', 'h1'],
    label: () => m.editor_block_h1(),
    value: 'h1',
  },
  {
    icon: <Heading2Icon />,
    hint: '##',
    keywords: ['subtitle', 'h2'],
    label: () => m.editor_block_h2(),
    value: 'h2',
  },
  {
    icon: <Heading3Icon />,
    hint: '###',
    keywords: ['subtitle', 'h3'],
    label: () => m.editor_block_h3(),
    value: 'h3',
  },
  {
    icon: <Heading4Icon />,
    hint: '####',
    keywords: ['subtitle', 'h4'],
    label: () => m.editor_block_h4(),
    value: 'h4',
  },
  {
    icon: <Heading5Icon />,
    hint: '#####',
    keywords: ['subtitle', 'h5'],
    label: () => m.editor_block_h5(),
    value: 'h5',
  },
  {
    icon: <Heading6Icon />,
    hint: '######',
    keywords: ['subtitle', 'h6'],
    label: () => m.editor_block_h6(),
    value: 'h6',
  },
  {
    icon: <ListIcon />,
    hint: '-',
    keywords: ['unordered', 'ul', '-'],
    label: () => m.editor_block_ul(),
    value: KEYS.ul,
  },
  {
    icon: <ListOrderedIcon />,
    hint: '1.',
    keywords: ['ordered', 'ol', '1'],
    label: () => m.editor_block_ol(),
    value: KEYS.ol,
  },
  {
    icon: <SquareIcon />,
    hint: '[]',
    keywords: ['checklist', 'task', 'checkbox', '[]'],
    label: () => m.editor_block_todo(),
    value: KEYS.listTodo,
  },
  {
    icon: <ChevronRightIcon />,
    keywords: ['collapsible', 'expandable'],
    label: () => m.editor_block_toggle(),
    value: KEYS.toggle,
  },
  {
    icon: <FileCodeIcon />,
    hint: '```',
    keywords: ['```'],
    label: () => m.editor_block_code(),
    value: KEYS.codeBlock,
  },
  {
    icon: <QuoteIcon />,
    hint: '>',
    keywords: ['citation', 'blockquote', '>'],
    label: () => m.editor_block_quote(),
    value: KEYS.blockquote,
  },
];

export function TurnIntoToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

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
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          className="gap-1.5 px-2 font-normal"
          pressed={open}
          tooltip={m.editor_toolbar_turn_into()}
          isDropdown
        >
          <span className="[&_svg]:size-3.5 [&_svg]:text-muted-foreground">
            {selectedItem.icon}
          </span>
          {selectedItem.label()}
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="ignore-click-outside/toolbar min-w-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.tf.focus();
        }}
        align="start"
      >
        <ToolbarMenuGroup
          {...(value === undefined ? {} : { value })}
          onValueChange={(type) => {
            setBlockType(editor, type);
          }}
          label={m.editor_toolbar_turn_into()}
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
        </ToolbarMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
