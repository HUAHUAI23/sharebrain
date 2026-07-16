// 按需加载 DOCX 转换器和导出插件，保持普通编辑会话不解析 Word 运行时。
import type { SlatePlugin } from 'platejs';
import type { PlateEditor } from 'platejs/react';

import { BaseEditorKit } from '../editor-base-kit';
import { inlineEditorImageUrls } from './export-editor-images';

async function ensureBufferPolyfill() {
  const globals = globalThis as { Buffer?: unknown };

  if (typeof globals.Buffer === 'undefined') {
    // @platejs/docx-io 依赖 Node 的 Buffer.from，浏览器里需要 polyfill。
    const { Buffer } = await import('buffer');
    globals.Buffer = Buffer;
  }
}

export async function exportEditorToWordBlobRuntime(editor: PlateEditor) {
  await ensureBufferPolyfill();
  const [{ exportToDocx }, { DocxExportKit }] = await Promise.all([
    import('@platejs/docx-io'),
    import('../kits/docx-export-kit'),
  ]);

  return exportToDocx(await inlineEditorImageUrls(editor.children), {
    editorPlugins: [...BaseEditorKit, ...DocxExportKit] as SlatePlugin[],
  });
}
