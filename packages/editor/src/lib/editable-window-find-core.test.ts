// 验证全文查询覆盖未挂载块、跨 mark 文本和精确 Slate range 映射。
import { describe, expect, test } from 'bun:test';

import {
  buildEditableWindowTextIndex,
  findEditableWindowTextIndexMatches,
  findEditableWindowTextMatches,
  shouldNavigateEditableWindowFind,
} from './editable-window-find-core';

const value = [
  {
    id: 'intro',
    type: 'p',
    children: [{ text: 'Alpha ' }, { bold: true, text: 'Beta' }],
  },
  { id: 'empty', type: 'p', children: [{ text: '' }] },
  {
    id: 'later',
    type: 'p',
    children: [{ text: 'beta appears in an unmounted block' }],
  },
];

describe('editable window find index', () => {
  test('indexes non-empty top-level blocks without DOM', () => {
    expect(buildEditableWindowTextIndex(value)).toEqual([
      { id: 'intro', path: [0], text: 'Alpha Beta' },
      {
        id: 'later',
        path: [2],
        text: 'beta appears in an unmounted block',
      },
    ]);
  });

  test('finds case-insensitive matches and maps offsets across marks', () => {
    expect(findEditableWindowTextMatches(value, 'beta')).toEqual([
      {
        blockId: 'intro',
        blockPath: [0],
        end: 10,
        range: {
          anchor: { offset: 0, path: [0, 1] },
          focus: { offset: 4, path: [0, 1] },
        },
        start: 6,
      },
      {
        blockId: 'later',
        blockPath: [2],
        end: 4,
        range: {
          anchor: { offset: 0, path: [2, 0] },
          focus: { offset: 4, path: [2, 0] },
        },
        start: 0,
      },
    ]);
  });

  test('returns no matches for an empty query and respects the result budget', () => {
    expect(findEditableWindowTextMatches(value, '')).toEqual([]);
    expect(findEditableWindowTextMatches(value, 'a', 2)).toHaveLength(2);
  });

  test('reuses a prebuilt model index while the query changes', () => {
    const index = buildEditableWindowTextIndex(value);

    expect(findEditableWindowTextIndexMatches(value, index, 'ALPHA')).toHaveLength(
      1
    );
    expect(
      findEditableWindowTextIndexMatches(value, index, 'unmounted')
    ).toHaveLength(1);
  });

  test('finds Chinese text without normalizing it to Latin input', () => {
    const chineseValue = [
      {
        id: 'chinese',
        type: 'p',
        children: [{ text: '全文查找支持中文字符' }],
      },
    ];

    expect(findEditableWindowTextMatches(chineseValue, '中文')).toMatchObject([
      { blockId: 'chinese', end: 8, start: 6 },
    ]);
  });

  test('pauses result navigation throughout IME composition', () => {
    expect(
      shouldNavigateEditableWindowFind({
        composing: true,
        matchCount: 3,
        open: true,
      })
    ).toBe(false);
    expect(
      shouldNavigateEditableWindowFind({
        composing: false,
        matchCount: 3,
        open: true,
      })
    ).toBe(true);
  });
});
