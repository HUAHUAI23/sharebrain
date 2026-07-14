// 验证 editor 版本 primitive 不修改输入，并能识别基础正文变化和预算。
import { describe, expect, test } from 'bun:test';
import type { Value } from 'platejs';

import {
  cloneEditorVersionValue,
  computeEditorVersionDiff,
  estimateEditorVersionValue,
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
});
