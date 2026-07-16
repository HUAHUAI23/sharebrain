// 验证远程光标忽略窗口换入期间产生的非有限或整页异常几何。
import { describe, expect, test } from 'bun:test';

import {
  isUsableRemoteCaretPosition,
  isUsableRemoteSelectionRect,
} from './remote-cursor-overlay';

describe('remote cursor geometry guard', () => {
  test('accepts normal caret and selection rectangles', () => {
    expect(
      isUsableRemoteCaretPosition({ height: 24, left: 20, top: 40 })
    ).toBe(true);
    expect(
      isUsableRemoteSelectionRect({
        height: 24,
        left: 20,
        top: 40,
        width: 120,
      })
    ).toBe(true);
  });

  test('rejects non-finite and page-height caret artifacts', () => {
    expect(
      isUsableRemoteCaretPosition({ height: 900, left: 20, top: 40 })
    ).toBe(false);
    expect(
      isUsableRemoteCaretPosition({ height: 24, left: Number.NaN, top: 40 })
    ).toBe(false);
  });
});
