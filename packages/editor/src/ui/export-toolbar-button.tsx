import * as React from 'react';

import type { DropdownMenuProps } from '@radix-ui/react-dropdown-menu';

import { ArrowDownToLineIcon } from 'lucide-react';
import { m } from '@sharebrain/i18n';
import { useEditorRef } from 'platejs/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sharebrain/ui/components/dropdown-menu';

import {
  downloadFile,
  exportEditorToHtml,
  exportEditorToMarkdown,
  exportEditorToPdfDataUri,
  exportEditorToWordBlob,
} from '../lib/exports';

import { ToolbarButton } from './toolbar';

export function ExportToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const exportToHtml = async () => {
    const html = await exportEditorToHtml(editor);
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    await downloadFile(url, 'document.html');
  };

  const exportToMarkdown = async () => {
    const md = exportEditorToMarkdown(editor);
    const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;

    await downloadFile(url, 'document.md');
  };

  const exportToWord = async () => {
    const blob = await exportEditorToWordBlob(editor);
    const url = window.URL.createObjectURL(blob);

    await downloadFile(url, 'document.docx');

    window.URL.revokeObjectURL(url);
  };

  const exportToPdf = async () => {
    const dataUri = await exportEditorToPdfDataUri(editor);

    await downloadFile(dataUri, 'document.pdf');
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton pressed={open} tooltip={m.editor_toolbar_export()} isDropdown>
          <ArrowDownToLineIcon className="size-4" />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={exportToHtml}>
            {m.editor_export_html()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToMarkdown}>
            {m.editor_export_markdown()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToWord}>
            {m.editor_export_word()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToPdf}>
            {m.editor_export_pdf()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
