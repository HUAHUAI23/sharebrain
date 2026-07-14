// 渲染 Plate diff metadata，并在复制 fragment 时剔除这些临时属性。
import type { DiffOperation, DiffUpdate } from '@platejs/diff';
import { withGetFragmentExcludeDiff } from '@platejs/diff';
import { createSlatePlugin } from 'platejs';
import {
  PlateLeaf,
  toPlatePlugin,
  type PlateLeafProps,
} from 'platejs/react';

const operationClasses: Record<DiffOperation['type'], string> = {
  delete: 'bg-red-100/80 text-red-900 decoration-red-700',
  insert: 'bg-emerald-100/80 text-emerald-950 decoration-emerald-700',
  update: 'bg-amber-100/80 text-amber-950 decoration-amber-700',
};

const activeOperationClasses =
  'relative scroll-mt-20 data-[version-diff-active=true]:ring-2 data-[version-diff-active=true]:ring-(--ring-soft) data-[version-diff-active=true]:ring-offset-2';

function isDiffOperation(value: unknown): value is DiffOperation {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'delete' || type === 'insert' || type === 'update';
}

function operationLabel(operation: DiffOperation) {
  switch (operation.type) {
    case 'delete':
      return 'deletion';
    case 'insert':
      return 'insertion';
    case 'update':
      return 'update';
  }
}

function describeUpdate(operation: DiffUpdate) {
  const keys = new Set([...Object.keys(operation.properties), ...Object.keys(operation.newProperties)]);
  return [...keys].sort().map((key) => `Updated ${key}`).join('\n');
}

function VersionDiffLeaf({ children, ...props }: PlateLeafProps) {
  const operation = props.leaf.diffOperation;
  if (!isDiffOperation(operation)) return <PlateLeaf {...props}>{children}</PlateLeaf>;
  const Component = operation.type === 'delete' ? 'del' : operation.type === 'insert' ? 'ins' : 'span';

  return (
    <PlateLeaf {...props}>
      <Component
        className={`${operationClasses[operation.type]} ${activeOperationClasses}`}
        data-version-diff={operation.type}
        aria-label={operationLabel(operation)}
        title={operation.type === 'update' ? describeUpdate(operation) : undefined}
      >
        {children}
      </Component>
    </PlateLeaf>
  );
}

export const VersionDiffPlugin = toPlatePlugin(
  createSlatePlugin({
    key: 'diff',
    node: { isLeaf: true },
  }).overrideEditor(withGetFragmentExcludeDiff),
  {
    render: {
      node: VersionDiffLeaf,
      aboveNodes:
        () =>
        ({ children, editor, element }) => {
          const operation = element.diffOperation;
          if (!element.diff || !isDiffOperation(operation)) return children;
          const Component = editor.api.isInline(element) ? 'span' : 'div';
          return (
            <Component
              className={`${operationClasses[operation.type]} ${activeOperationClasses}`}
              data-version-diff={operation.type}
              aria-label={operationLabel(operation)}
              title={operation.type === 'update' ? describeUpdate(operation) : undefined}
            >
              {children}
            </Component>
          );
        },
    },
  }
);

export const VersionDiffKit = [VersionDiffPlugin];
