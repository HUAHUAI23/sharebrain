// 验证块 gutter 的静态偏移，防止重新引入 hover 布局读取。
import { describe, expect, test } from 'bun:test';
import { KEYS } from 'platejs';

import { getBlockToolbarTop } from './block-draggable';

describe('getBlockToolbarTop', () => {
  test('aligns heading controls with their typography margins', () => {
    expect(getBlockToolbarTop(KEYS.h1)).toBe('calc(3.6rem + 3px)');
    expect(getBlockToolbarTop(KEYS.h2)).toBe('calc(2.1rem + 3px)');
    expect(getBlockToolbarTop(KEYS.h6)).toBe('calc(0.75rem + 3px)');
  });

  test('uses a stable default without reading the DOM', () => {
    expect(getBlockToolbarTop(KEYS.p)).toBe('3px');
    expect(getBlockToolbarTop(KEYS.callout)).toBe('calc(0.25rem + 3px)');
  });
});
