// 提供与业务无关的 Plate Value 快照、预算估算和差异计算能力。
import { computeDiff } from '@platejs/diff';
import type { AnyPluginConfig, Value } from 'platejs';
import { createPlateEditor } from 'platejs/react';

import { BaseEditorKit } from '../editor-base-kit';

export type EditorVersionValueEstimate = {
  bytes: number;
  nodes: number;
};

export function cloneEditorVersionValue(value: Value): Value {
  return structuredClone(value);
}

export function estimateEditorVersionValue(value: Value): EditorVersionValueEstimate {
  let nodes = 0;
  const visit = (input: unknown) => {
    if (!input || typeof input !== 'object') return;
    nodes += 1;
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    Object.values(input).forEach(visit);
  };
  visit(value);
  return {
    bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
    nodes,
  };
}

export function computeEditorVersionDiff(input: {
  previous: Value;
  current: Value;
  plugins?: AnyPluginConfig[];
  lineBreakChar?: string;
}): Value {
  const editor = createPlateEditor({ plugins: input.plugins ?? BaseEditorKit });
  return computeDiff(
    cloneEditorVersionValue(input.previous),
    cloneEditorVersionValue(input.current),
    {
      isInline: editor.api.isInline,
      lineBreakChar: input.lineBreakChar ?? '¶',
    }
  ) as Value;
}
