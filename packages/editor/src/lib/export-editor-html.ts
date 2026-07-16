// 按需创建静态 Plate 编辑器并序列化 HTML，避免预览组件进入编辑器首包。
import type { SlateEditor } from 'platejs';
import { createSlateEditor } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { serializeHtml } from 'platejs/static';

import { BaseEditorKit } from '../editor-base-kit';
import { EditorStatic } from '../ui/editor-static';
import { inlineEditorImageUrls } from './export-editor-images';

export async function exportEditorToHtmlRuntime(editor: PlateEditor) {
  const editorStatic = createSlateEditor({
    plugins: BaseEditorKit,
    value: await inlineEditorImageUrls(editor.children),
  });

  const editorHtml = await serializeHtml(editorStatic as SlateEditor, {
    editorComponent: EditorStatic,
    props: { style: { padding: '0 calc(50% - 350px)', paddingBottom: '' } },
  });

  return `<!DOCTYPE html>
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
}
