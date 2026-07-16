// 验证 DOM 顺序定位，以及标题列表对普通结构操作的增量刷新判定。
import { describe, expect, test } from 'bun:test';
import type { Heading } from '@platejs/toc';
import { createPlateEditor } from 'platejs/react';

import {
  getActiveTocItemKeyFromDom,
  getActiveTocItemKeyFromPath,
  getTocListScrollTop,
  getTocModelIndex,
  getViewportChunkIndex,
  resolveActiveTocItemKey,
  shouldRefreshTocHeadingList,
} from './editor-toc-sidebar';

describe('getTocListScrollTop', () => {
  test('keeps a visible active marker at its current scroll position', () => {
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 400,
        itemHeight: 32,
        itemTop: 520,
        scrollHeight: 2_000,
      })
    ).toBe(400);
  });

  test('recenters active markers after they leave the comfort zone', () => {
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 400,
        itemHeight: 32,
        itemTop: 120,
        scrollHeight: 2_000,
      })
    ).toBe(0);
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 400,
        itemHeight: 32,
        itemTop: 900,
        scrollHeight: 2_000,
      })
    ).toBe(756);
  });

  test('clamps the list at the first and last marker', () => {
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 200,
        itemHeight: 32,
        itemTop: 0,
        scrollHeight: 1_000,
      })
    ).toBe(0);
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 200,
        itemHeight: 32,
        itemTop: 968,
        scrollHeight: 1_000,
      })
    ).toBe(680);
  });

  test('uses the navigation tail to keep the final marker near the center', () => {
    expect(
      getTocListScrollTop({
        clientHeight: 320,
        currentScrollTop: 600,
        itemHeight: 32,
        itemTop: 968,
        scrollHeight: 1_240,
      })
    ).toBe(824);
  });
});

describe('getViewportChunkIndex', () => {
  const getBounds = (index: number) => ({
    bottom: (index + 1) * 100,
    top: index * 100,
  });

  test('finds exact chunks and the preceding chunk across geometry gaps', () => {
    expect(getViewportChunkIndex(8, 0, getBounds)).toBe(0);
    expect(getViewportChunkIndex(8, 100, getBounds)).toBe(1);
    expect(getViewportChunkIndex(8, 799, getBounds)).toBe(7);
    expect(getViewportChunkIndex(8, 900, getBounds)).toBe(7);
    expect(getViewportChunkIndex(8, -1, getBounds)).toBeNull();
  });

  test('reads logarithmic geometry near the end of a long chunk list', () => {
    let reads = 0;
    const index = getViewportChunkIndex(64, 6_350, (chunkIndex) => {
      reads += 1;
      return getBounds(chunkIndex);
    });

    expect(index).toBe(63);
    expect(reads).toBeLessThanOrEqual(7);
  });

  test('rejects invalid chunk geometry', () => {
    expect(
      getViewportChunkIndex(4, 120, () => ({ bottom: 20, top: 30 }))
    ).toBeNull();
  });
});

const headings: Heading[] = [
  { id: 'intro', depth: 1, path: [0], title: 'Intro', type: 'h1' },
  { id: 'design', depth: 2, path: [4], title: 'Design', type: 'h2' },
  { id: 'tests', depth: 2, path: [9], title: 'Tests', type: 'h2' },
];
const domElement = (position: number) =>
  ({
    compareDocumentPosition(other: Element) {
      const otherPosition = (other as Element & { position: number }).position;

      return position < otherPosition ? 4 : position > otherPosition ? 2 : 0;
    },
    position,
  }) as unknown as Element;
const headingElements = headings.map((heading, index) => ({
  element: domElement((index + 1) * 10),
  key: heading.id,
}));

describe('getActiveTocItemKeyFromDom', () => {
  test('keeps the first heading active before the document reaches it', () => {
    expect(getActiveTocItemKeyFromDom(headingElements, domElement(5))).toBe(
      'intro'
    );
  });

  test('selects the latest heading before the block at the viewport line', () => {
    expect(getActiveTocItemKeyFromDom(headingElements, domElement(25))).toBe(
      'design'
    );
    expect(getActiveTocItemKeyFromDom(headingElements, domElement(35))).toBe(
      'tests'
    );
  });
});

describe('virtualized TOC model index', () => {
  test('indexes headings and selects the latest path before the viewport block', () => {
    const model = getTocModelIndex([
      { id: 'intro', type: 'h1', children: [{ text: 'Intro' }] },
      { id: 'body', type: 'p', children: [{ text: 'Body' }] },
      {
        id: 'section',
        type: 'toggle',
        children: [
          { text: '' },
          { id: 'nested', type: 'h2', children: [{ text: 'Nested' }] },
        ],
      },
      { id: 'end', type: 'p', children: [{ text: 'End' }] },
    ]);

    expect(model.blockPaths.get('nested')).toEqual([2, 1]);
    expect(model.headings.map((item) => item.title)).toEqual(['Intro', 'Nested']);
    expect(getActiveTocItemKeyFromPath(model.headings, [1])).toBe('intro:0');
    expect(getActiveTocItemKeyFromPath(model.headings, [2, 1])).toBe(
      'nested:2.1'
    );
    expect(getActiveTocItemKeyFromPath(model.headings, [3])).toBe(
      'nested:2.1'
    );
  });

  test('always resolves an active marker after the heading list changes', () => {
    expect(resolveActiveTocItemKey(['intro:0', 'design:4'], 'stale:9')).toBe(
      'intro:0'
    );
    expect(resolveActiveTocItemKey(['intro:0', 'design:4'], 'design:4')).toBe(
      'design:4'
    );
    expect(resolveActiveTocItemKey([], 'stale:9')).toBeNull();
  });
});

describe('shouldRefreshTocHeadingList', () => {
  const editor = createPlateEditor({
    value: [
      { type: 'p', children: [{ text: 'Paragraph' }] },
      { type: 'h2', children: [{ text: 'Heading' }] },
    ],
  });

  test('reuses headings for ordinary paragraph text operations', () => {
    expect(
      shouldRefreshTocHeadingList(editor, [
        { type: 'insert_text', path: [0, 0], offset: 9, text: '!' },
      ])
    ).toBe(false);
    expect(
      shouldRefreshTocHeadingList(editor, [
        { type: 'remove_text', path: [0, 0], offset: 8, text: 'h' },
      ])
    ).toBe(false);
  });

  test('refreshes headings only when text or inserted content contains a heading', () => {
    expect(
      shouldRefreshTocHeadingList(editor, [
        { type: 'insert_text', path: [1, 0], offset: 7, text: '!' },
      ])
    ).toBe(true);
    expect(
      shouldRefreshTocHeadingList(editor, [
        {
          type: 'insert_node',
          path: [2],
          node: { type: 'p', children: [{ text: '' }] },
        },
      ])
    ).toBe(false);
    expect(
      shouldRefreshTocHeadingList(editor, [
        {
          type: 'insert_node',
          path: [2],
          node: { type: 'h2', children: [{ text: 'New heading' }] },
        },
      ])
    ).toBe(true);
  });

  test('reuses headings when Enter splits a paragraph', () => {
    expect(
      shouldRefreshTocHeadingList(editor, [
        {
          type: 'split_node',
          path: [0],
          position: 4,
          properties: { type: 'p' },
        },
      ])
    ).toBe(false);
    expect(
      shouldRefreshTocHeadingList(editor, [
        {
          type: 'split_node',
          path: [1],
          position: 4,
          properties: { type: 'h2' },
        },
      ])
    ).toBe(true);
  });

  test('refreshes when a node changes to or from a heading type', () => {
    expect(
      shouldRefreshTocHeadingList(editor, [
        {
          type: 'set_node',
          path: [0],
          properties: { type: 'p' },
          newProperties: { type: 'h2' },
        },
      ])
    ).toBe(true);
  });
});
