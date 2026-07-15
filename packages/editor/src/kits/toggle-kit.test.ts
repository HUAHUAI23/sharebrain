// 验证折叠可见性索引只响应会改变顶层结构的编辑操作。
import { describe, expect, test } from 'bun:test';

import type { PlateEditor } from 'platejs/react';

import {
  areToggleIndexesEqual,
  isToggleElementVisible,
  shouldRefreshToggleIndex,
} from './toggle-kit';

type EditorOperation = PlateEditor['operations'][number];

describe('toggle visibility index', () => {
  test('reuses the index for ordinary text and selection operations', () => {
    expect(
      shouldRefreshToggleIndex([
        { offset: 0, path: [3, 0], text: 'a', type: 'insert_text' },
        {
          newProperties: { anchor: { offset: 1, path: [3, 0] } },
          properties: { anchor: { offset: 0, path: [3, 0] } },
          type: 'set_selection',
        },
      ] as EditorOperation[])
    ).toBe(false);
  });

  test('refreshes for top-level toggle structure changes only', () => {
    expect(
      shouldRefreshToggleIndex([
        {
          newProperties: { indent: 1 },
          path: [3],
          properties: { indent: 0 },
          type: 'set_node',
        },
      ] as EditorOperation[])
    ).toBe(true);
    expect(
      shouldRefreshToggleIndex([
        {
          newProperties: { bold: true },
          path: [3, 0],
          properties: {},
          type: 'set_node',
        },
      ] as EditorOperation[])
    ).toBe(false);
    expect(
      shouldRefreshToggleIndex([
        {
          node: { children: [{ text: '' }], type: 'p' },
          path: [4],
          type: 'insert_node',
        },
      ] as EditorOperation[])
    ).toBe(true);
  });

  test('keeps equivalent snapshots stable and resolves closed ancestors', () => {
    const first = new Map([
      ['toggle', []],
      ['child', ['toggle']],
    ]);
    const second = new Map([
      ['toggle', []],
      ['child', ['toggle']],
    ]);

    expect(areToggleIndexesEqual(first, second)).toBe(true);
    expect(isToggleElementVisible(first, new Set(), 'child')).toBe(false);
    expect(isToggleElementVisible(first, new Set(['toggle']), 'child')).toBe(
      true
    );
  });
});
