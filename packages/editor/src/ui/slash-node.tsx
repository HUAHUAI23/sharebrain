import * as React from 'react';

import type { PlateEditor, PlateElementProps } from 'platejs/react';

import { AIChatPlugin } from '@platejs/ai/react';
import {
  AudioLinesIcon,
  ChevronRightIcon,
  Code2,
  FileUpIcon,
  FilmIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  LightbulbIcon,
  ListIcon,
  ListOrdered,
  PilcrowIcon,
  Quote,
  RadicalIcon,
  SmileIcon,
  SparklesIcon,
  Square,
  Table,
  TableOfContentsIcon,
} from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { type TComboboxInputElement, KEYS } from 'platejs';
import { PlateElement } from 'platejs/react';

import { insertBlock, insertInlineElement } from '../transforms';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

type Group = {
  group: () => string;
  items: {
    icon: React.ReactNode;
    value: string;
    onSelect: (editor: PlateEditor, value: string) => void;
    className?: string;
    focusEditor?: boolean;
    keywords?: string[];
    label?: () => string;
  }[];
};

const groups: Group[] = [
  {
    group: () => m.editor_group_ai(),
    items: [
      {
        focusEditor: false,
        icon: <SparklesIcon />,
        keywords: ['ai', 'ask', 'assistant', '智能', '问AI', 'zhineng'],
        label: () => m.editor_ask_ai(),
        value: 'AI',
        onSelect: (editor) => {
          editor.getApi(AIChatPlugin).aiChat.show();
        },
      },
    ],
  },
  {
    group: () => m.editor_group_basic_blocks(),
    items: [
      {
        icon: <PilcrowIcon />,
        keywords: ['paragraph', 'text', 'p', '文本', '正文', 'wenben', 'zhengwen'],
        label: () => m.editor_block_paragraph(),
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        keywords: ['title', 'h1', 'heading', '标题', '标题1', '一级标题', 'biaoti', 'bt1'],
        label: () => m.editor_block_h1(),
        value: KEYS.h1,
      },
      {
        icon: <Heading2Icon />,
        keywords: ['subtitle', 'h2', 'heading', '标题', '标题2', '二级标题', 'biaoti', 'bt2'],
        label: () => m.editor_block_h2(),
        value: KEYS.h2,
      },
      {
        icon: <Heading3Icon />,
        keywords: ['subtitle', 'h3', 'heading', '标题', '标题3', '三级标题', 'biaoti', 'bt3'],
        label: () => m.editor_block_h3(),
        value: KEYS.h3,
      },
      {
        icon: <ListIcon />,
        keywords: ['unordered', 'ul', '-', 'bullet', '列表', '无序列表', 'liebiao', 'wuxu'],
        label: () => m.editor_block_ul(),
        value: KEYS.ul,
      },
      {
        icon: <ListOrdered />,
        keywords: ['ordered', 'ol', '1', 'numbered', '列表', '有序列表', 'youxu', 'bianhao'],
        label: () => m.editor_block_ol(),
        value: KEYS.ol,
      },
      {
        icon: <Square />,
        keywords: ['checklist', 'task', 'checkbox', 'todo', '[]', '待办', '任务', '清单', 'daiban', 'renwu'],
        label: () => m.editor_block_todo(),
        value: KEYS.listTodo,
      },
      {
        icon: <ChevronRightIcon />,
        keywords: ['collapsible', 'expandable', 'toggle', '折叠', '折叠列表', 'zhedie'],
        label: () => m.editor_block_toggle(),
        value: KEYS.toggle,
      },
      {
        icon: <Code2 />,
        keywords: ['```', 'code', 'codeblock', '代码', '代码块', 'daima', 'dm'],
        label: () => m.editor_block_code(),
        value: KEYS.codeBlock,
      },
      {
        icon: <Table />,
        keywords: ['table', 'grid', '表格', 'biaoge', 'bg'],
        label: () => m.editor_block_table(),
        value: KEYS.table,
      },
      {
        icon: <Quote />,
        keywords: ['citation', 'blockquote', 'quote', '>', '引用', '引述', 'yinyong', 'yy'],
        label: () => m.editor_block_quote(),
        value: KEYS.blockquote,
      },
      {
        icon: <LightbulbIcon />,
        keywords: ['note', 'callout', 'highlight', '标注', '提示', '高亮块', 'biaozhu', 'tishi'],
        label: () => m.editor_block_callout(),
        value: KEYS.callout,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: () => m.editor_group_media(),
    items: [
      {
        icon: <ImageIcon />,
        keywords: ['image', 'img', 'photo', 'picture', '图片', '图像', '照片', 'tupian', 'tp'],
        label: () => m.editor_media_image(),
        value: KEYS.img,
      },
      {
        icon: <FilmIcon />,
        keywords: ['video', 'movie', '视频', '影片', 'shipin', 'sp'],
        label: () => m.editor_media_video(),
        value: KEYS.video,
      },
      {
        icon: <AudioLinesIcon />,
        keywords: ['audio', 'music', 'sound', '音频', '音乐', '声音', 'yinpin', 'yp'],
        label: () => m.editor_media_audio(),
        value: KEYS.audio,
      },
      {
        icon: <FileUpIcon />,
        keywords: ['file', 'attachment', 'upload', '文件', '附件', '上传', 'wenjian', 'fujian', 'wj'],
        label: () => m.editor_media_file(),
        value: KEYS.file,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: () => m.editor_group_advanced(),
    items: [
      {
        icon: <TableOfContentsIcon />,
        keywords: ['toc', 'outline', '目录', '大纲', 'mulu', 'ml'],
        label: () => m.editor_block_toc(),
        value: KEYS.toc,
      },
      {
        icon: <RadicalIcon />,
        keywords: ['math', 'tex', 'katex', 'formula', '公式', '数学', 'gongshi', 'gs'],
        label: () => m.editor_equation(),
        value: KEYS.equation,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: () => m.editor_group_inline(),
    items: [
      {
        focusEditor: false,
        icon: <RadicalIcon />,
        keywords: ['math', 'tex', 'katex', 'formula', 'inline', '公式', '行内公式', 'gongshi', 'gs'],
        label: () => m.editor_equation_inline(),
        value: KEYS.inlineEquation,
      },
      {
        focusEditor: false,
        icon: <SmileIcon />,
        keywords: ['emoji', 'emotion', 'face', '表情', '表情符号', 'biaoqing', 'bq'],
        label: () => m.editor_toolbar_emoji(),
        value: KEYS.emojiInput,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertInlineElement(editor, value);
      },
    })),
  },
];

export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/" showTrigger={false}>
        {/* Notion 式筛选输入：自然背景块 + 占位提示，无边框。 */}
        <span className="inline-block rounded-sm bg-muted px-1.5 py-0.5 align-baseline">
          <InlineComboboxInput
            placeholder={m.editor_slash_filter_placeholder()}
          />
        </span>

        <InlineComboboxContent>
          <InlineComboboxEmpty>{m.editor_no_results()}</InlineComboboxEmpty>

          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group()}>
              <InlineComboboxGroupLabel>{group()}</InlineComboboxGroupLabel>

              {items.map(
                ({ focusEditor, icon, keywords, label, value, onSelect }) => (
                  <InlineComboboxItem
                    key={value}
                    value={value}
                    onClick={() => onSelect(editor, value)}
                    label={label?.()}
                    focusEditor={focusEditor}
                    group={group()}
                    keywords={keywords}
                  >
                    <div className="mr-2 text-muted-foreground">{icon}</div>
                    {label?.() ?? value}
                  </InlineComboboxItem>
                ),
              )}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
