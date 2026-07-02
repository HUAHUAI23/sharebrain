import * as React from 'react';

import { MarkdownPlugin } from '@platejs/markdown';
import { ArrowDownToLineIcon, ArrowUpToLineIcon, EyeIcon, MoreHorizontalIcon, PenIcon } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { createSlateEditor } from 'platejs';
import { useEditorReadOnly, useEditorRef } from 'platejs/react';
import { getEditorDOMFromHtmlString, serializeHtml } from 'platejs/static';
import { useFilePicker } from 'use-file-picker';

import { Button } from '@sharebrain/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sharebrain/ui/components/dropdown-menu';

import { BaseEditorKit } from '../editor-base-kit';
import { EditorStatic } from './editor-static';

async function downloadFile(url: string, filename: string) {
  const response = await fetch(url);

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(blobUrl);
}

/**
 * Compact page-level menu for editors without a fixed toolbar: import,
 * export and read-only mode. Must be rendered inside a `Plate` provider.
 */
export function EditorMoreMenu({ fileName = 'document' }: { fileName?: string }) {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  const [open, setOpen] = React.useState(false);

  const { openFilePicker: openMdFilePicker } = useFilePicker({
    accept: ['.md', '.mdx'],
    multiple: false,
    onFilesSelected: async ({ plainFiles }: { plainFiles?: File[] }) => {
      const file = plainFiles?.[0];

      if (!file) return;

      const nodes = editor
        .getApi(MarkdownPlugin)
        .markdown.deserialize(await file.text());

      editor.tf.insertNodes(nodes);
    },
  });

  const { openFilePicker: openHtmlFilePicker } = useFilePicker({
    accept: ['text/html'],
    multiple: false,
    onFilesSelected: async ({ plainFiles }: { plainFiles?: File[] }) => {
      const file = plainFiles?.[0];

      if (!file) return;

      const element = getEditorDOMFromHtmlString(await file.text());
      const nodes = editor.api.html.deserialize({ element });

      editor.tf.insertNodes(nodes);
    },
  });

  const exportToMarkdown = async () => {
    const md = editor.getApi(MarkdownPlugin).markdown.serialize();
    const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
    await downloadFile(url, `${fileName}.md`);
  };

  const exportToHtml = async () => {
    const editorStatic = createSlateEditor({
      plugins: BaseEditorKit,
      value: editor.children,
    });

    const editorHtml = await serializeHtml(editorStatic, {
      editorComponent: EditorStatic,
      props: { style: { padding: '0 calc(50% - 350px)', paddingBottom: '' } },
    });

    const html = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
      </head>
      <body>
        ${editorHtml}
      </body>
    </html>`;

    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    await downloadFile(url, `${fileName}.html`);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={m.editor_toolbar_more()}>
          <MoreHorizontalIcon size={16} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              editor.store.setReadOnly(!readOnly);

              if (readOnly) {
                editor.tf.focus();
              }
            }}
          >
            {readOnly ? <PenIcon /> : <EyeIcon />}
            {readOnly ? m.editor_mode_editing() : m.editor_mode_viewing()}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => openMdFilePicker()}>
            <ArrowUpToLineIcon />
            {m.editor_import_markdown()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openHtmlFilePicker()}>
            <ArrowUpToLineIcon />
            {m.editor_import_html()}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={exportToMarkdown}>
            <ArrowDownToLineIcon />
            {m.editor_export_markdown()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToHtml}>
            <ArrowDownToLineIcon />
            {m.editor_export_html()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
