// 验证 Word 剪贴板只在明确包含 RTF 或 Office 标记时进入异步转换路径。
import { describe, expect, test } from 'bun:test';

import { getEditorWordClipboardPayload } from './exports';

const clipboard = (values: Record<string, string>) => ({
  getData: (type: string) => values[type] ?? '',
});

describe('getEditorWordClipboardPayload', () => {
  test('captures Word HTML and RTF synchronously', () => {
    expect(
      getEditorWordClipboardPayload(
        clipboard({
          'text/html': '<p class="MsoNormal">Word</p>',
          'text/rtf': '{\\rtf1 Word}',
        })
      )
    ).toEqual({
      html: '<p class="MsoNormal">Word</p>',
      rtf: '{\\rtf1 Word}',
    });
  });

  test('ignores ordinary HTML paste', () => {
    expect(
      getEditorWordClipboardPayload(
        clipboard({ 'text/html': '<p>Browser content</p>' })
      )
    ).toBeNull();
  });
});
