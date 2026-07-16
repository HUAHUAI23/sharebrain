// 验证文档编辑容器只有页面级滚动根，不在窗口化首帧创建瞬时内层滚动条。
import { describe, expect, test } from 'bun:test';

import { getEditorContainerClassName } from './editor';

describe('EditorContainer', () => {
  test('uses visible overflow and intrinsic height for document pages', () => {
    const className = getEditorContainerClassName({ variant: 'document' });

    expect(className).toContain('h-auto');
    expect(className).toContain('min-w-0');
    expect(className).toContain('overflow-y-visible');
    expect(className).not.toContain('overflow-y-auto');
    expect(className).not.toContain('h-full');
  });
});
