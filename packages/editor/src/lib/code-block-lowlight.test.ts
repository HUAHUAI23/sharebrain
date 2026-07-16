// 验证常用语法立即可用，而完整语言表按需补齐。
import { describe, expect, test } from 'bun:test';

import {
  isCodeBlockLanguageLoaded,
  loadCodeBlockLanguage,
} from './code-block-lowlight';

describe('code block lowlight registry', () => {
  test('loads uncommon languages without blocking the initial registry', async () => {
    expect(isCodeBlockLanguageLoaded('javascript')).toBe(true);
    expect(isCodeBlockLanguageLoaded('mathematica')).toBe(false);

    await loadCodeBlockLanguage('mathematica');

    expect(isCodeBlockLanguageLoaded('mathematica')).toBe(true);
  });

  test('leaves unsupported language labels as plaintext', async () => {
    expect(await loadCodeBlockLanguage('notion')).toBe(false);
    expect(isCodeBlockLanguageLoaded('notion')).toBe(false);
  });
});
