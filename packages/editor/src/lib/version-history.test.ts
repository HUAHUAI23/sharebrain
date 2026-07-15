// 验证 editor 版本 primitive 不修改输入，并能识别基础正文变化和预算。
import { describe, expect, test } from 'bun:test';
import type { Value } from 'platejs';

import {
  EDITOR_VERSION_DIFF_RESULT_BUDGET,
  cloneEditorVersionValue,
  computeEditorVersionDiff,
  estimateEditorVersionValue,
  getEditorVersionDiffSegments,
  hasEditorVersionDiff,
  isEditorVersionDiffWithinBudget,
  isEditorVersionValueWithinBudget,
} from './version-history';

const previous: Value = [{ type: 'p', children: [{ text: 'Before' }] }];
const current: Value = [{ type: 'p', children: [{ text: 'After', bold: true }] }];

describe('editor version history primitives', () => {
  test('clones without shared references', () => {
    const cloned = cloneEditorVersionValue(previous);
    expect(cloned).toEqual(previous);
    expect(cloned).not.toBe(previous);
    expect(cloned[0]).not.toBe(previous[0]);
  });

  test('computes diff without mutating either input', () => {
    const beforeSnapshot = structuredClone(previous);
    const currentSnapshot = structuredClone(current);
    const diff = computeEditorVersionDiff({ previous, current });
    expect(diff).not.toEqual(previous);
    expect(previous).toEqual(beforeSnapshot);
    expect(current).toEqual(currentSnapshot);
  });

  test('estimates nodes and UTF-8 bytes', () => {
    const estimate = estimateEditorVersionValue(current);
    expect(estimate.nodes).toBeGreaterThanOrEqual(3);
    expect(estimate.bytes).toBeGreaterThan(0);
  });

  test('checks each diff input against the budget independently', () => {
    const budget = { maxBytes: 1_000, maxNodes: 5 };

    expect(isEditorVersionDiffWithinBudget({ previous, current, budget })).toBe(
      true
    );
    expect(
      isEditorVersionDiffWithinBudget({
        previous: [...previous, ...previous],
        current,
        budget,
      })
    ).toBe(false);
  });

  test('keeps a separate budget for the annotated result', () => {
    expect(
      isEditorVersionValueWithinBudget(current, EDITOR_VERSION_DIFF_RESULT_BUDGET)
    ).toBe(true);
    expect(
      isEditorVersionValueWithinBudget(current, { maxBytes: 1, maxNodes: 1 })
    ).toBe(false);
  });

  test('detects nested diff markers and groups context windows', () => {
    const value = Array.from({ length: 9 }, (_, index) => ({
      type: 'p',
      children: [
        index === 1 || index === 7
          ? {
              text: `Changed ${index}`,
              diff: true,
              diffOperation: { type: 'insert' },
            }
          : { text: `Stable ${index}` },
      ],
    })) as Value;

    expect(hasEditorVersionDiff(value[1])).toBe(true);
    expect(hasEditorVersionDiff(value[2])).toBe(false);
    expect(getEditorVersionDiffSegments(value)).toEqual([
      {
        startIndex: 0,
        endIndex: 3,
        omittedBefore: 0,
        omittedAfter: 3,
        value: value.slice(0, 3),
      },
      {
        startIndex: 6,
        endIndex: 9,
        omittedBefore: 3,
        omittedAfter: 0,
        value: value.slice(6, 9),
      },
    ]);
  });

  test('merges overlapping context and returns no segments without changes', () => {
    const changed = (text: string) => ({
      type: 'p',
      children: [
        { text, diff: true, diffOperation: { type: 'update', properties: {}, newProperties: {} } },
      ],
    });
    const value = [
      { type: 'p', children: [{ text: '0' }] },
      changed('1'),
      changed('2'),
      { type: 'p', children: [{ text: '3' }] },
    ] as Value;

    expect(getEditorVersionDiffSegments(value)).toEqual([
      {
        startIndex: 0,
        endIndex: 4,
        omittedBefore: 0,
        omittedAfter: 0,
        value,
      },
    ]);
    expect(getEditorVersionDiffSegments(previous)).toEqual([]);
  });
});
