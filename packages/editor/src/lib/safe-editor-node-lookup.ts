// 为精确 Path 查询提供无异常快路径，规避第三方插件探测越界节点时序列化整棵编辑器。
import { NodeApi, type Path } from 'platejs';
import type { PlateEditor } from 'platejs/react';

const installedEditors = new WeakSet<PlateEditor>();

const isPath = (value: unknown): value is Path =>
  Array.isArray(value) && value.every((index) => Number.isInteger(index));

export function installSafeEditorNodeLookup(editor: PlateEditor) {
  if (installedEditors.has(editor)) return;

  const originalNode = editor.api.node;
  const callOriginalNode = originalNode as unknown as (
    ...args: unknown[]
  ) => unknown;

  editor.api.node = ((...args: unknown[]) => {
    const [atOrOptions, nodeOptions] = args;

    if (isPath(atOrOptions) && nodeOptions === undefined) {
      const node = NodeApi.getIf(editor, atOrOptions);

      return node ? [node, atOrOptions] : undefined;
    }

    return callOriginalNode(...args);
  }) as typeof editor.api.node;

  installedEditors.add(editor);
}
