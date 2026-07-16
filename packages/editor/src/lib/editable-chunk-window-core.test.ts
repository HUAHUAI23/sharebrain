// 验证可编辑 chunk 适配器只接受连续稳定范围，并正确保护复杂内容与选区。
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';

import {
  estimateEditableBlockHeight,
  getEditableChunkBlockPathAtOffset,
  getEditableChunkDescriptor,
  getEditableChunkRange,
  getEditableChunkRenderMode,
  getEditableChunkScrollAdjustment,
  getEditableChunkScrollAnchor,
  getEditableChunkSelectionRange,
  getEditableVirtualDropBoundary,
  getEditableVirtualDropTarget,
  resolveEditableVirtualDropMove,
  selectionRangePinsEditableChunk,
  selectionPinsEditableChunk,
} from './editable-chunk-window-core';

const Chunk = () => null;
const renderChildren = (
  leaves: Array<{ index: number; node: unknown; type?: string }>
) =>
  createElement(Chunk, {
    ancestor: {
      key: { id: `chunk-${leaves[0]?.index ?? 'empty'}` },
      children: leaves.map((leaf) => ({ type: 'leaf', ...leaf })),
    },
  });
const paragraph = (id: string, text: string) => ({
  id,
  type: 'p',
  children: [{ text }],
});

describe('editable chunk descriptor', () => {
  test('extracts a continuous range, nested block paths and estimated height', () => {
    const descriptor = getEditableChunkDescriptor(
      renderChildren([
        { index: 10, node: paragraph('p-10', 'Short') },
        {
          index: 11,
          node: {
            id: 'toggle-11',
            type: 'p',
            children: [
              { text: 'Parent' },
              { id: 'nested-11', type: 'p', children: [{ text: 'Nested' }] },
            ],
          },
        },
      ])
    );

    expect(descriptor).toMatchObject({
      startIndex: 10,
      endIndex: 12,
      key: 'chunk-10',
      containsComplexContent: false,
      containsReviewContent: false,
    });
    expect(descriptor?.blockPaths).toEqual([
      { id: 'p-10', path: [10] },
      { id: 'toggle-11', path: [11] },
      { id: 'nested-11', path: [11, 1] },
    ]);
    expect(descriptor?.previewText).toContain('Short');
    expect(descriptor!.estimatedHeight).toBeGreaterThan(0);
  });

  test('rejects gaps, missing ids and unknown render children', () => {
    expect(
      getEditableChunkDescriptor(
        renderChildren([
          { index: 0, node: paragraph('a', 'A') },
          { index: 2, node: paragraph('b', 'B') },
        ])
      )
    ).toBeNull();
    expect(
      getEditableChunkDescriptor(
        renderChildren([{ index: 0, node: { type: 'p', children: [{ text: '' }] } }])
      )
    ).toBeNull();
    expect(getEditableChunkDescriptor('children')).toBeNull();
  });

  test('keeps duplicate legacy block ids windowed under a stable chunk key', () => {
    const descriptor = getEditableChunkDescriptor(
      renderChildren([
        { index: 0, node: paragraph('same', 'A') },
        { index: 1, node: paragraph('same', 'B') },
      ])
    );

    expect(descriptor).toMatchObject({
      endIndex: 2,
      key: 'chunk-0',
      startIndex: 0,
    });
    expect(descriptor?.blockPaths).toEqual([
      { id: 'same', path: [0] },
      { id: 'same', path: [1] },
    ]);
  });

  test('keeps a verified range for full DOM fallback chunks', () => {
    expect(
      getEditableChunkRange(
        renderChildren([
          { index: 50, node: paragraph('a', 'A') },
          { index: 52, node: paragraph('b', 'B') },
        ])
      )
    ).toBeNull();
  });

  test('marks complex blocks and review metadata for lifecycle pinning', () => {
    const complex = getEditableChunkDescriptor(
      renderChildren([
        {
          index: 0,
          node: { id: 'image', type: 'img', children: [{ text: '' }] },
        },
      ])
    );
    const review = getEditableChunkDescriptor(
      renderChildren([
        {
          index: 1,
          node: {
            id: 'commented',
            type: 'p',
            children: [{ text: 'Review', comment_thread: true }],
          },
        },
      ])
    );

    expect(complex?.containsComplexContent).toBe(true);
    expect(complex?.topLevelBlocks[0]?.complex).toBe(true);
    expect(review?.containsReviewContent).toBe(true);
    expect(review?.topLevelBlocks[0]?.review).toBe(true);
  });

  test('estimates wrapped CJK text above a short paragraph', () => {
    expect(
      estimateEditableBlockHeight(paragraph('long', '长文本'.repeat(80)))
    ).toBeGreaterThan(estimateEditableBlockHeight(paragraph('short', 'Short')));
  });
});

describe('selectionPinsEditableChunk', () => {
  const descriptor = { startIndex: 50, endIndex: 100 };

  test('normalizes a selection to a stable padded top-level range', () => {
    expect(
      getEditableChunkSelectionRange({
        anchor: { path: [70, 4, 0] },
        focus: { path: [50, 2, 0] },
      })
    ).toEqual({ endIndex: 72, startIndex: 49 });
    expect(getEditableChunkSelectionRange(null)).toBeNull();
  });

  test('pins selection ranges and one adjacent top-level block', () => {
    expect(
      selectionPinsEditableChunk(
        { anchor: { path: [50, 0] }, focus: { path: [50, 0] } },
        descriptor
      )
    ).toBe(true);
    expect(
      selectionPinsEditableChunk(
        { anchor: { path: [49, 0] }, focus: { path: [49, 0] } },
        descriptor
      )
    ).toBe(true);
    expect(
      selectionPinsEditableChunk(
        { anchor: { path: [101, 0] }, focus: { path: [101, 0] } },
        descriptor
      )
    ).toBe(false);
  });

  test('pins every chunk touched by an expanded selection', () => {
    expect(
      selectionPinsEditableChunk(
        { anchor: { path: [10, 0] }, focus: { path: [120, 0] } },
        descriptor
      )
    ).toBe(true);
    expect(selectionPinsEditableChunk(null, descriptor)).toBe(false);
  });

  test('reuses a stable range without reading every caret offset', () => {
    const range = getEditableChunkSelectionRange({
      anchor: { path: [50, 0] },
      focus: { path: [50, 0] },
    });

    expect(selectionRangePinsEditableChunk(range, descriptor)).toBe(true);
    expect(
      selectionRangePinsEditableChunk(range, { startIndex: 52, endIndex: 60 })
    ).toBe(false);
  });
});

describe('getEditableChunkRenderMode', () => {
  const base = {
    enabled: true,
    first: false,
    forced: false,
    inViewport: true,
    interactionPinned: false,
    mounted: false,
    scrolling: false,
    selectionPinned: false,
  };

  test('keeps existing content mounted and previews new chunks while scrolling', () => {
    expect(
      getEditableChunkRenderMode({ ...base, mounted: true, scrolling: true })
    ).toBe('content');
    expect(getEditableChunkRenderMode({ ...base, scrolling: true })).toBe(
      'preview'
    );
    expect(
      getEditableChunkRenderMode({
        ...base,
        inViewport: false,
        scrolling: true,
      })
    ).toBe('placeholder');
  });

  test('hydrates the viewport after scroll settle and preserves editing pins', () => {
    expect(getEditableChunkRenderMode(base)).toBe('content');
    expect(
      getEditableChunkRenderMode({
        ...base,
        inViewport: false,
        scrolling: true,
        selectionPinned: true,
      })
    ).toBe('content');
  });
});

describe('editable chunk scroll anchor', () => {
  test('preserves the same relative reading point when content height changes', () => {
    const anchor = getEditableChunkScrollAnchor(
      { height: 200, top: 0 },
      100
    );

    expect(anchor).toEqual({ ratio: 0.5, viewportY: 100 });
    expect(
      getEditableChunkScrollAdjustment(anchor!, { height: 300, top: 0 })
    ).toBe(50);
    expect(
      getEditableChunkScrollAdjustment(anchor!, { height: 100, top: 0 })
    ).toBe(-50);
  });

  test('accounts for preceding layout shifts and ignores subpixel noise', () => {
    const anchor = getEditableChunkScrollAnchor(
      { height: 200, top: 0 },
      100
    );

    expect(
      getEditableChunkScrollAdjustment(anchor!, { height: 200, top: 20 })
    ).toBe(20);
    expect(
      getEditableChunkScrollAdjustment(anchor!, { height: 200, top: 0.4 })
    ).toBe(0);
  });

  test('rejects invalid geometry without producing a scroll command', () => {
    expect(
      getEditableChunkScrollAnchor({ height: 0, top: 0 }, 100)
    ).toBeNull();
    expect(
      getEditableChunkScrollAdjustment(
        { ratio: 0.5, viewportY: 100 },
        { height: Number.NaN, top: 0 }
      )
    ).toBeNull();
  });
});

describe('getEditableChunkBlockPathAtOffset', () => {
  const blocks = [
    { estimatedHeight: 20, path: [50] },
    { estimatedHeight: 60, path: [51] },
    { estimatedHeight: 20, path: [52] },
  ];

  test('maps the rendered chunk offset to a scaled top-level block path', () => {
    expect(getEditableChunkBlockPathAtOffset(blocks, 0, 200)).toEqual([50]);
    expect(getEditableChunkBlockPathAtOffset(blocks, 39, 200)).toEqual([50]);
    expect(getEditableChunkBlockPathAtOffset(blocks, 40, 200)).toEqual([51]);
    expect(getEditableChunkBlockPathAtOffset(blocks, 159, 200)).toEqual([51]);
    expect(getEditableChunkBlockPathAtOffset(blocks, 160, 200)).toEqual([52]);
    expect(getEditableChunkBlockPathAtOffset(blocks, 240, 200)).toEqual([52]);
  });

  test('rejects invalid geometry without guessing a path', () => {
    expect(getEditableChunkBlockPathAtOffset([], 20, 200)).toBeNull();
    expect(getEditableChunkBlockPathAtOffset(blocks, Number.NaN, 200)).toBeNull();
    expect(getEditableChunkBlockPathAtOffset(blocks, 20, 0)).toBeNull();
  });
});

describe('editable virtual drop', () => {
  const blocks = [
    { id: 'a', estimatedHeight: 20 },
    { id: 'b', estimatedHeight: 60 },
    { id: 'c', estimatedHeight: 20 },
  ];

  test('maps pointer geometry to the nearest scaled block boundary', () => {
    expect(getEditableVirtualDropBoundary(blocks, 0, 200)).toEqual({
      boundaryIndex: 0,
      offsetPx: 0,
    });
    expect(getEditableVirtualDropBoundary(blocks, 50, 200)).toEqual({
      boundaryIndex: 1,
      offsetPx: 40,
    });
    expect(getEditableVirtualDropBoundary(blocks, 190, 200)).toEqual({
      boundaryIndex: 3,
      offsetPx: 200,
    });
    expect(getEditableVirtualDropBoundary(blocks, Number.NaN, 200)).toBeNull();
  });

  test('keeps a stable adjacent block id for the target boundary', () => {
    expect(getEditableVirtualDropTarget(blocks, 1)).toEqual({
      id: 'b',
      side: 'before',
    });
    expect(getEditableVirtualDropTarget(blocks, 3)).toEqual({
      id: 'c',
      side: 'after',
    });
  });

  test('adjusts forward and backward final indices while preserving Slate path', () => {
    expect(resolveEditableVirtualDropMove([2], 7, 10)).toEqual({
      finalIndex: 6,
      to: [7],
    });
    expect(resolveEditableVirtualDropMove([7], 2, 10)).toEqual({
      finalIndex: 2,
      to: [2],
    });
    expect(resolveEditableVirtualDropMove([2, 3], 8, 10)).toEqual({
      finalIndex: 6,
      to: [8],
    });
  });

  test('rejects self-range, invalid and scroll-edge targets safely', () => {
    expect(resolveEditableVirtualDropMove([2, 3], 3, 10)).toBeNull();
    expect(resolveEditableVirtualDropMove([2, 3], 4, 10)).toBeNull();
    expect(resolveEditableVirtualDropMove([8, 9], 0, 10)).toEqual({
      finalIndex: 0,
      to: [0],
    });
    expect(resolveEditableVirtualDropMove([0, 1], 10, 10)).toEqual({
      finalIndex: 8,
      to: [10],
    });
  });
});
