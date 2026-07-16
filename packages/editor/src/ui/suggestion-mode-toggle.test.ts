// 验证常驻建议模式按钮的关闭和激活状态映射。
import { describe, expect, test } from 'bun:test';

import { getSuggestionModeToggleState } from './suggestion-mode-toggle';

describe('getSuggestionModeToggleState', () => {
  test('offers an unpressed editing state before suggesting starts', () => {
    expect(getSuggestionModeToggleState(false)).toEqual({
      mode: 'editing',
      pressed: false,
    });
  });

  test('keeps the toggle pressed while suggestion mode is active', () => {
    expect(getSuggestionModeToggleState(true)).toEqual({
      mode: 'suggesting',
      pressed: true,
    });
  });
});
