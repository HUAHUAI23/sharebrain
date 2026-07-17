// 以空闲期分批 hydration 的独立只读 Plate editor 渲染正文版本，避免阻塞宿主交互。
import type { AnyPluginConfig, Value } from 'platejs';
import {
  Plate,
  usePlateEditor,
  type PlateChunkProps,
} from 'platejs/react';
import { createStaticEditor } from 'platejs/static';
import * as React from 'react';

import { BaseEditorKit } from '../editor-base-kit';
import { cloneEditorVersionValue } from '../lib/version-history-core';
import { Editor } from './editor';
import { EditorStatic } from './editor-static';

const versionPreviewBatchSize = 30;
const versionPreviewInteractionPauseMs = 120;
const versionPreviewValueKeys = new WeakMap<object, number>();
let nextVersionPreviewValueKey = 1;
const versionPreviewChunkStyle: React.CSSProperties = {
  contain: 'layout style',
};

function getVersionPreviewValueKey(value: Value) {
  const existing = versionPreviewValueKeys.get(value);
  if (existing) return existing;

  const key = nextVersionPreviewValueKey++;
  versionPreviewValueKeys.set(value, key);
  return key;
}

function VersionPreviewChunk({ attributes, children, lowest }: PlateChunkProps) {
  if (!lowest) return children;

  return (
    <div
      {...attributes}
      style={versionPreviewChunkStyle}
    >
      {children}
    </div>
  );
}

export type VersionPreviewProps = {
  value: Value;
  plugins?: AnyPluginConfig[];
  className?: string;
};

export function VersionPreview({ value, plugins, className }: VersionPreviewProps) {
  return (
    <ProgressiveVersionPreview
      key={getVersionPreviewValueKey(value)}
      value={value}
      {...(plugins ? { plugins } : {})}
      {...(className ? { className } : {})}
    />
  );
}

function ProgressiveVersionPreview({
  value,
  plugins,
  className,
}: VersionPreviewProps) {
  const batches = React.useMemo(() => {
    if (value.length === 0) return [value];

    return Array.from(
      { length: Math.ceil(value.length / versionPreviewBatchSize) },
      (_, index) =>
        value.slice(
          index * versionPreviewBatchSize,
          (index + 1) * versionPreviewBatchSize
        )
    );
  }, [value]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [renderedBatchCount, setRenderedBatchCount] = React.useState(1);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || renderedBatchCount >= batches.length) return;

    const idleWindow = window as typeof window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
        options?: { timeout: number }
      ) => number;
    };
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;
    let lastInteractionAt = 0;
    let disposed = false;
    const markInteraction = () => {
      lastInteractionAt = performance.now();
    };
    const appendBatch = () => {
      if (disposed) return;
      if (performance.now() - lastInteractionAt < versionPreviewInteractionPauseMs) {
        schedule();
        return;
      }
      React.startTransition(() => {
        setRenderedBatchCount((count) => Math.min(count + 1, batches.length));
      });
    };
    const schedule = () => {
      if (disposed || idleHandle !== null || timerHandle !== null) return;

      timerHandle = window.setTimeout(() => {
        timerHandle = null;
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(
            () => {
              idleHandle = null;
              appendBatch();
            },
            { timeout: 500 }
          );
          return;
        }
        appendBatch();
      }, 16);
    };

    root.addEventListener('wheel', markInteraction, { passive: true });
    root.addEventListener('keydown', markInteraction);
    root.addEventListener('pointerdown', markInteraction, { passive: true });
    schedule();

    return () => {
      disposed = true;
      root.removeEventListener('wheel', markInteraction);
      root.removeEventListener('keydown', markInteraction);
      root.removeEventListener('pointerdown', markInteraction);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timerHandle !== null) window.clearTimeout(timerHandle);
    };
  }, [batches.length, renderedBatchCount]);

  return (
    <div
      ref={rootRef}
      className={className}
      aria-busy={renderedBatchCount < batches.length}
    >
      {batches.slice(0, renderedBatchCount).map((batch, index) => (
        plugins ? (
          <VersionPreviewBatch key={index} value={batch} plugins={plugins} />
        ) : (
          <StaticVersionPreviewBatch key={index} value={batch} />
        )
      ))}
    </div>
  );
}

function StaticVersionPreviewBatch({ value }: Pick<VersionPreviewProps, 'value'>) {
  const editor = React.useMemo(
    () =>
      createStaticEditor({
        plugins: BaseEditorKit,
        value: cloneEditorVersionValue(value),
      }),
    [value]
  );

  return (
    <EditorStatic
      editor={editor}
      value={editor.children}
      variant="none"
      className="w-full"
      data-version-preview-batch="static"
    />
  );
}

function VersionPreviewBatch({
  value,
  plugins,
}: Pick<VersionPreviewProps, 'value' | 'plugins'>) {
  const editor = usePlateEditor(
    {
      chunking: {
        chunkSize: 50,
        contentVisibilityAuto: false,
      },
      plugins: plugins ?? BaseEditorKit,
      value: cloneEditorVersionValue(value),
    },
    [plugins, value]
  );

  return (
    <Plate editor={editor} readOnly>
      <Editor
        variant="none"
        readOnly
        className="w-full"
        renderChunk={VersionPreviewChunk}
        data-version-preview-batch="plate"
      />
    </Plate>
  );
}
