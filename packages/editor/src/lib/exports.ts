// 编辑器导入导出入口；预览、DOCX 和静态 HTML 运行时仅在用户执行对应命令时加载。
import { MarkdownPlugin } from '@platejs/markdown';
import type { PlateEditor } from 'platejs/react';

import { blobToDataUrl } from './export-editor-media';

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

export function exportEditorToMarkdown(editor: PlateEditor) {
  return editor.getApi(MarkdownPlugin).markdown.serialize();
}

export async function exportEditorToHtml(editor: PlateEditor) {
  const { exportEditorToHtmlRuntime } = await import('./export-editor-html');

  return exportEditorToHtmlRuntime(editor);
}

export async function exportEditorToWordBlob(editor: PlateEditor) {
  const { exportEditorToWordBlobRuntime } = await import('./export-editor-docx');

  return exportEditorToWordBlobRuntime(editor);
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
  const { importDocx } = await import('@platejs/docx-io');
  const result = await importDocx(editor, arrayBuffer);

  editor.tf.insertNodes(result.nodes);
}

export type EditorWordClipboardPayload = {
  html: string;
  rtf: string;
};

export function getEditorWordClipboardPayload(
  dataTransfer: Pick<DataTransfer, 'getData'>
): EditorWordClipboardPayload | null {
  const html = dataTransfer.getData('text/html');
  const rtf = dataTransfer.getData('text/rtf');

  if (!html || (!rtf && !/(?:class=["']?Mso|mso-)/i.test(html))) {
    return null;
  }

  return { html, rtf };
}

export async function parseEditorWordClipboard(
  editor: PlateEditor,
  payload: EditorWordClipboardPayload
) {
  const { parseEditorWordClipboardRuntime } = await import(
    './parse-editor-word-clipboard'
  );

  return parseEditorWordClipboardRuntime(editor, payload);
}
