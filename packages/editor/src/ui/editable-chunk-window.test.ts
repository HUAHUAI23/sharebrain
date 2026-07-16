// 验证 chunk 高度直接取 ResizeObserver 数据，不需要主动触发布局读取。
import { describe, expect, test } from 'bun:test';

import { getEditableChunkObservedHeight } from './editable-chunk-window';

const entry = (
  borderBoxSize: Array<{ blockSize: number }> | { blockSize: number } | undefined,
  contentHeight: number
) =>
  ({
    borderBoxSize,
    contentRect: { height: contentHeight },
  }) as unknown as Pick<ResizeObserverEntry, 'borderBoxSize' | 'contentRect'>;

describe('getEditableChunkObservedHeight', () => {
  test('prefers the border box reported by ResizeObserver', () => {
    expect(getEditableChunkObservedHeight(entry([{ blockSize: 128 }], 120))).toBe(
      128
    );
    expect(getEditableChunkObservedHeight(entry({ blockSize: 96 }, 90))).toBe(96);
  });

  test('falls back to content height and rejects invalid observations', () => {
    expect(getEditableChunkObservedHeight(entry([], 72))).toBe(72);
    expect(getEditableChunkObservedHeight(entry(undefined, Number.NaN))).toBeNull();
    expect(getEditableChunkObservedHeight(entry([{ blockSize: 0 }], 0))).toBeNull();
  });
});
