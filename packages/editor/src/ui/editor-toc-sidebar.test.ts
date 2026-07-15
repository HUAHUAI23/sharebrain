// 验证 DOM 顺序定位，以及标题列表对普通结构操作的增量刷新判定。
import { describe, expect, test } from 'bun:test';
import type { Heading } from '@platejs/toc';
import { createPlateEditor } from 'platejs/react';

import {
  getActiveTocItemKeyFromDom,
  shouldRefreshTocHeadingList,
} from './editor-toc-sidebar';

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
