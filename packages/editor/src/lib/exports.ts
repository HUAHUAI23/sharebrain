import { exportToDocx, importDocx } from '@platejs/docx-io';
import { MarkdownPlugin } from '@platejs/markdown';
import type { Descendant, SlateEditor, SlatePlugin, Value } from 'platejs';
import { createSlateEditor, KEYS } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { serializeHtml } from 'platejs/static';

import { BaseEditorKit } from '../editor-base-kit';
import { DocxExportKit } from '../kits/docx-export-kit';
import { EditorStatic } from '../ui/editor-static';

export async function downloadFile(url: string, filename: string) {
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

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 把文档里的图片 URL 内联成 data URL。文档内嵌媒体存的是需要登录态的
 * API 地址（如 /api/media/:id/raw），导出的 docx/html 离开浏览器后无法
 * 再访问这些地址，必须先取字节内嵌。取不到的图片保留原地址。
 */
async function inlineImageUrls(value: Descendant[]): Promise<Value> {
  const inlineNode = async (node: Descendant): Promise<Descendant> => {
    if (!('type' in node)) return node;

    let next = node;

    if (
      node.type === KEYS.img &&
      typeof node.url === 'string' &&
      !node.url.startsWith('data:')
    ) {
      try {
        const response = await fetch(node.url, { credentials: 'include' });

        if (response.ok) {
          next = { ...node, url: await blobToDataUrl(await response.blob()) };
        }
      } catch {
        // 离线或跨域取不到时保留原地址。
      }
    }

    if ('children' in next && Array.isArray(next.children)) {
      return {
        ...next,
        children: await Promise.all(next.children.map(inlineNode)),
      } as Descendant;
    }

    return next;
  };

  return Promise.all(value.map(inlineNode)) as Promise<Value>;
}

export function exportEditorToMarkdown(editor: PlateEditor) {
  return editor.getApi(MarkdownPlugin).markdown.serialize();
}

export async function exportEditorToHtml(editor: PlateEditor) {
  const editorStatic = createSlateEditor({
    plugins: BaseEditorKit,
    value: await inlineImageUrls(editor.children),
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

async function ensureBufferPolyfill() {
  const globals = globalThis as { Buffer?: unknown };

  if (typeof globals.Buffer === 'undefined') {
    // @platejs/docx-io 依赖 Node 的 Buffer.from，浏览器里需要 polyfill。
    const { Buffer } = await import('buffer');
    globals.Buffer = Buffer;
  }
}

export async function exportEditorToWordBlob(editor: PlateEditor) {
  await ensureBufferPolyfill();

  return exportToDocx(await inlineImageUrls(editor.children), {
    editorPlugins: [...BaseEditorKit, ...DocxExportKit] as SlatePlugin[],
  });
}

/**
 * 预取 DOM 内图片为 data URL。媒体地址会 302 到对象存储，响应没有 CORS
 * 头，直接画进 canvas 会污染画布导致 toDataURL 抛错。
 */
async function buildImageDataUrlMap(root: HTMLElement) {
  const map = new Map<string, string>();

  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src');

      if (!src || src.startsWith('data:') || map.has(src)) return;

      try {
        const response = await fetch(src, { credentials: 'include' });

        if (response.ok) {
          map.set(src, await blobToDataUrl(await response.blob()));
        }
      } catch {
        // 取不到就保留原地址，该图片区域可能空白但导出不中断。
      }
    })
  );

  return map;
}

async function captureEditorCanvas(editor: PlateEditor) {
  const { default: html2canvas } = await import('html2canvas-pro');

  const editorNode = editor.api.toDOMNode(editor)!;
  const imageDataUrls = await buildImageDataUrlMap(editorNode);

  const canvas = await html2canvas(editorNode, {
    useCORS: true,
    onclone: (cloned: Document) => {
      const editorElement = cloned.querySelector('[contenteditable="true"]');

      if (editorElement) {
        for (const img of editorElement.querySelectorAll('img')) {
          const src = img.getAttribute('src');
          const dataUrl = src ? imageDataUrls.get(src) : undefined;

          if (dataUrl) {
            img.setAttribute('src', dataUrl);
          }
        }

        // html2canvas 不认 CSS 变量字体，强制回退到系统字体栈。
        for (const element of editorElement.querySelectorAll('*')) {
          const existingStyle = element.getAttribute('style') || '';
          element.setAttribute(
            'style',
            `${existingStyle}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important`
          );
        }
      }
    },
  });

  return canvas;
}

/** 截图当前编辑器 DOM 生成单页 PDF（视觉保真，非文本型 PDF）。 */
export async function exportEditorToPdfDataUri(editor: PlateEditor) {
  const canvas = await captureEditorCanvas(editor);

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([canvas.width, canvas.height]);
  const imageEmbed = await pdfDoc.embedPng(canvas.toDataURL('PNG'));
  const { height, width } = imageEmbed.scale(1);

  page.drawImage(imageEmbed, { height, width, x: 0, y: 0 });

  return pdfDoc.saveAsBase64({ dataUri: true });
}

export async function importEditorDocxFile(editor: PlateEditor, file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await importDocx(editor, arrayBuffer);

  editor.tf.insertNodes(result.nodes);
}
