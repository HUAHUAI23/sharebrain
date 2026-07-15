// 组合完整 Plate plugin 语义的同步版本 Diff，并复用 Worker-safe 核心能力。
import type { AnyPluginConfig, Value } from 'platejs';
import { createPlateEditor } from 'platejs/react';

import { BaseEditorKit } from '../editor-base-kit';
import { computeEditorVersionDiffCore } from './version-history-core';

export * from './version-history-core';

export function computeEditorVersionDiff(input: {
  previous: Value;
  current: Value;
  plugins?: AnyPluginConfig[];
  lineBreakChar?: string;
}): Value {
  const editor = createPlateEditor({ plugins: input.plugins ?? BaseEditorKit });
  return computeEditorVersionDiffCore({
    previous: input.previous,
    current: input.current,
    isInline: editor.api.isInline,
    ...(input.lineBreakChar ? { lineBreakChar: input.lineBreakChar } : {}),
  });
}
