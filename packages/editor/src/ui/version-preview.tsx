// 以独立只读 Plate editor 渲染正文版本，避免影响宿主编辑器状态。
import type { AnyPluginConfig, Value } from 'platejs';
import { Plate, usePlateEditor } from 'platejs/react';

import { BaseEditorKit } from '../editor-base-kit';
import { cloneEditorVersionValue } from '../lib/version-history';
import { Editor } from './editor';

export type VersionPreviewProps = {
  value: Value;
  plugins?: AnyPluginConfig[];
  className?: string;
};

export function VersionPreview({ value, plugins, className }: VersionPreviewProps) {
  const editor = usePlateEditor(
    {
      plugins: plugins ?? BaseEditorKit,
      value: cloneEditorVersionValue(value),
    },
    [plugins, value]
  );

  return (
    <Plate editor={editor} readOnly>
      <Editor variant="none" readOnly className={className} />
    </Plate>
  );
}
