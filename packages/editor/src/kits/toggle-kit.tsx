// 为折叠块维护按结构更新的可见性索引，避免普通输入使所有正文块失效。
import * as React from 'react';

import {
  TogglePlugin,
  buildToggleIndex,
} from '@platejs/toggle/react';
import { KEYS, type TIndentElement } from 'platejs';
import {
  type PlateEditor,
  type PlateElementProps,
  usePluginOption,
} from 'platejs/react';

import { ToggleElement } from '../ui/toggle-node';
import { IndentKit } from './indent-kit';

type EditorOperation = PlateEditor['operations'][number];
type ToggleIndex = Map<string, string[]>;

const EMPTY_TOGGLE_INDEX: ToggleIndex = new Map();
const EMPTY_OPEN_TOGGLE_IDS = new Set<string>();
const HIDDEN_TOGGLE_STYLE: React.CSSProperties = {
  height: 0,
  margin: 0,
  overflow: 'hidden',
  visibility: 'hidden',
};
const TOGGLE_INDEX_PROPERTIES = new Set([
  'id',
  'type',
  KEYS.indent,
  KEYS.listType,
]);

const operationChangesToggleIndex = (operation: EditorOperation) => {
  if (
    operation.type === 'insert_text' ||
    operation.type === 'remove_text' ||
    operation.type === 'set_selection'
  ) {
    return false;
  }

  if (operation.type === 'set_node') {
    if (operation.path.length !== 1) return false;

    const properties = {
      ...operation.properties,
      ...operation.newProperties,
    } as Record<string, unknown>;

    return Object.keys(properties).some((key) =>
      TOGGLE_INDEX_PROPERTIES.has(key)
    );
  }

  if (operation.type === 'move_node') {
    return operation.path.length === 1 || operation.newPath.length === 1;
  }

  if (
    operation.type === 'insert_node' ||
    operation.type === 'remove_node' ||
    operation.type === 'merge_node' ||
    operation.type === 'split_node'
  ) {
    return operation.path.length === 1;
  }

  return true;
};

export const shouldRefreshToggleIndex = (
  operations: EditorOperation[]
) => operations.some(operationChangesToggleIndex);

export const areToggleIndexesEqual = (
  left: ToggleIndex,
  right: ToggleIndex
) =>
  left.size === right.size &&
  [...left].every(([elementId, toggleIds]) => {
    const otherIds = right.get(elementId);

    return (
      otherIds !== undefined &&
      toggleIds.length === otherIds.length &&
      toggleIds.every((toggleId, index) => toggleId === otherIds[index])
    );
  });

export const isToggleElementVisible = (
  toggleIndex: ToggleIndex,
  openIds: Set<string>,
  elementId: string
) =>
  (toggleIndex.get(elementId) ?? []).every((toggleId) =>
    openIds.has(toggleId)
  );

const refreshToggleIndex = (editor: PlateEditor) => {
  const previous =
    editor.getOption(TogglePlugin, 'toggleIndex') ?? EMPTY_TOGGLE_INDEX;
  const next = buildToggleIndex(editor.children as TIndentElement[]);

  if (areToggleIndexesEqual(previous, next)) return;

  editor.setOption(TogglePlugin, 'toggleIndex', next);
};

const ToggleVisibility = ({
  children,
  element,
}: PlateElementProps) => {
  const toggleIndex =
    usePluginOption(TogglePlugin, 'toggleIndex') ?? EMPTY_TOGGLE_INDEX;
  const openIds =
    usePluginOption(TogglePlugin, 'openIds') ?? EMPTY_OPEN_TOGGLE_IDS;
  const elementId = typeof element.id === 'string' ? element.id : '';

  if (isToggleElementVisible(toggleIndex, openIds, elementId)) {
    return children;
  }

  return <div style={HIDDEN_TOGGLE_STYLE}>{children}</div>;
};

const performantTogglePlugin = TogglePlugin.configure({
  handlers: {
    onChange: ({ editor }) => {
      const operations = [...editor.operations];

      if (shouldRefreshToggleIndex(operations)) {
        refreshToggleIndex(editor);
      }
    },
  },
  render: {
    aboveNodes: (props) => {
      if (props.path.length !== 1) return;

      return (elementProps) => <ToggleVisibility {...elementProps} />;
    },
  },
  useHooks: ({ editor }) => {
    React.useEffect(() => {
      refreshToggleIndex(editor);
    }, [editor]);
  },
}).withComponent(ToggleElement);

export const ToggleKit = [...IndentKit, performantTogglePlugin];
