import * as React from 'react';

import { MarkdownPlugin } from '@platejs/markdown';
import { ArrowDownToLineIcon, ArrowUpToLineIcon, EyeIcon, MoreHorizontalIcon, PenIcon } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { useEditorReadOnly, useEditorRef } from 'platejs/react';
import { getEditorDOMFromHtmlString } from 'platejs/static';
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

import {
  downloadFile,
  exportEditorToHtml,
  exportEditorToMarkdown,
  exportEditorToPdfDataUri,
  exportEditorToWordBlob,
  importEditorDocxFile,
} from '../lib/exports';

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

  const { openFilePicker: openDocxFilePicker } = useFilePicker({
    accept: ['.docx'],
    multiple: false,
    onFilesSelected: async ({ plainFiles }: { plainFiles?: File[] }) => {
      const file = plainFiles?.[0];

      if (!file) return;

      await importEditorDocxFile(editor, file);
    },
  });

  const exportToMarkdown = async () => {
    const md = exportEditorToMarkdown(editor);
    const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
    await downloadFile(url, `${fileName}.md`);
  };

  const exportToHtml = async () => {
    const html = await exportEditorToHtml(editor);
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await downloadFile(url, `${fileName}.html`);
  };

  const exportToWord = async () => {
    const blob = await exportEditorToWordBlob(editor);
    const url = window.URL.createObjectURL(blob);

    await downloadFile(url, `${fileName}.docx`);

    window.URL.revokeObjectURL(url);
  };

  const exportToPdf = async () => {
    const dataUri = await exportEditorToPdfDataUri(editor);

    await downloadFile(dataUri, `${fileName}.pdf`);
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
          <DropdownMenuItem onSelect={() => openDocxFilePicker()}>
            <ArrowUpToLineIcon />
            {m.editor_import_word()}
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
          <DropdownMenuItem onSelect={exportToWord}>
            <ArrowDownToLineIcon />
            {m.editor_export_word()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToPdf}>
            <ArrowDownToLineIcon />
            {m.editor_export_pdf()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
