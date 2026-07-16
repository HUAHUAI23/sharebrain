// 按需清洗 Word 剪贴板并转换为 Plate 节点，普通粘贴不加载 DOCX 解析器。
import type { PlateEditor } from 'platejs/react';
import { getEditorDOMFromHtmlString } from 'platejs/static';

import type { EditorWordClipboardPayload } from './exports';

export async function parseEditorWordClipboardRuntime(
  editor: PlateEditor,
  payload: EditorWordClipboardPayload
) {
  const { cleanDocx } = await import('@platejs/docx');
  const element = getEditorDOMFromHtmlString(
    cleanDocx(payload.html, payload.rtf)
  );

  return editor.api.html.deserialize({ element });
}
