import * as React from 'react';

import type { DropdownMenuProps } from '@radix-ui/react-dropdown-menu';

import {
  AudioLinesIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileUpIcon,
  FilmIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  LightbulbIcon,
  Link2Icon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  PlusIcon,
  QuoteIcon,
  RadicalIcon,
  SquareIcon,
  TableIcon,
  TableOfContentsIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { KEYS } from 'platejs';
import { type PlateEditor, useEditorRef } from 'platejs/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sharebrain/ui/components/dropdown-menu';
import { insertBlock, insertInlineElement } from '../transforms';

import { ToolbarButton, ToolbarMenuGroup } from './toolbar';

type Group = {
  group: () => string;
  items: Item[];
};

type Item = {
  icon: React.ReactNode;
  value: string;
  onSelect: (editor: PlateEditor, value: string) => void;
  focusEditor?: boolean;
  label: () => string;
};

const groups: Group[] = [
  {
    group: () => m.editor_group_basic_blocks(),
    items: [
      {
        icon: <PilcrowIcon />,
        label: () => m.editor_block_paragraph(),
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        label: () => m.editor_block_h1(),
        value: 'h1',
      },
      {
        icon: <Heading2Icon />,
        label: () => m.editor_block_h2(),
        value: 'h2',
      },
      {
        icon: <Heading3Icon />,
        label: () => m.editor_block_h3(),
        value: 'h3',
      },
      {
        icon: <TableIcon />,
        label: () => m.editor_block_table(),
        value: KEYS.table,
      },
      {
        icon: <FileCodeIcon />,
        label: () => m.editor_block_code(),
        value: KEYS.codeBlock,
      },
      {
        icon: <QuoteIcon />,
        label: () => m.editor_block_quote(),
        value: KEYS.blockquote,
      },
      {
        icon: <MinusIcon />,
        label: () => m.editor_block_divider(),
        value: KEYS.hr,
      },
      {
        icon: <LightbulbIcon />,
        label: () => m.editor_block_callout(),
        value: KEYS.callout,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value);
      },
    })),
  },
  {
    group: () => m.editor_group_lists(),
    items: [
      {
        icon: <ListIcon />,
        label: () => m.editor_block_ul(),
        value: KEYS.ul,
      },
      {
        icon: <ListOrderedIcon />,
        label: () => m.editor_block_ol(),
        value: KEYS.ol,
      },
      {
        icon: <SquareIcon />,
        label: () => m.editor_block_todo(),
        value: KEYS.listTodo,
      },
      {
        icon: <ChevronRightIcon />,
        label: () => m.editor_block_toggle(),
        value: KEYS.toggle,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value);
      },
    })),
  },
  {
    group: () => m.editor_group_media(),
    items: [
      {
        icon: <ImageIcon />,
        label: () => m.editor_media_image(),
        value: KEYS.img,
      },
      {
        icon: <LinkIcon />,
        label: () => m.editor_media_embed(),
        value: KEYS.mediaEmbed,
      },
      {
        icon: <FilmIcon />,
        label: () => m.editor_media_video(),
        value: KEYS.video,
      },
      {
        icon: <AudioLinesIcon />,
        label: () => m.editor_media_audio(),
        value: KEYS.audio,
      },
      {
        icon: <FileUpIcon />,
        label: () => m.editor_media_file(),
        value: KEYS.file,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value);
      },
    })),
  },
  {
    group: () => m.editor_group_advanced(),
    items: [
      {
        icon: <TableOfContentsIcon />,
        label: () => m.editor_block_toc(),
        value: KEYS.toc,
      },
      {
        icon: <RadicalIcon />,
        label: () => m.editor_equation(),
        value: KEYS.equation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value);
      },
    })),
  },
  {
    group: () => m.editor_group_inline(),
    items: [
      {
        icon: <Link2Icon />,
        label: () => m.editor_block_link(),
        value: KEYS.link,
      },
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        label: () => m.editor_equation_inline(),
        value: KEYS.inlineEquation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertInlineElement(editor, value);
      },
    })),
  },
];

export function InsertToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton pressed={open} tooltip={m.editor_toolbar_insert()} isDropdown>
          <PlusIcon />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="flex max-h-[500px] min-w-0 flex-col overflow-y-auto"
        align="start"
      >
        {groups.map(({ group, items: nestedItems }) => (
          <ToolbarMenuGroup key={group()} label={group()}>
            {nestedItems.map(({ icon, label, value, onSelect }) => (
              <DropdownMenuItem
                key={value}
                className="min-w-[180px]"
                onSelect={() => {
                  onSelect(editor, value);
                  editor.tf.focus();
                }}
              >
                {icon}
                {label()}
              </DropdownMenuItem>
            ))}
          </ToolbarMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
