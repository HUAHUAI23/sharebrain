// 验证精确 Path 查询在有效和越界位置都保持 Plate node API 语义。
import { describe, expect, test } from 'bun:test';
import { createPlateEditor } from 'platejs/react';

import { installSafeEditorNodeLookup } from './safe-editor-node-lookup';

describe('installSafeEditorNodeLookup', () => {
  test('returns exact entries and treats a missing descendant as undefined', () => {
    const editor = createPlateEditor({
      value: [{ type: 'p', children: [{ text: 'Body' }] }],
    });

    installSafeEditorNodeLookup(editor);

    expect(editor.api.node([0])?.[0]).toMatchObject({ type: 'p' });
    expect(editor.api.node([0, 0])?.[0]).toMatchObject({ text: 'Body' });
    expect(editor.api.node([0, 1])).toBeUndefined();
    expect(editor.api.node([99])).toBeUndefined();
  });

  test('is idempotent for repeated React renders', () => {
    const editor = createPlateEditor({
      value: [{ type: 'p', children: [{ text: '' }] }],
    });

    installSafeEditorNodeLookup(editor);
    const installedNode = editor.api.node;
    installSafeEditorNodeLookup(editor);

    expect(editor.api.node).toBe(installedNode);
  });
});
