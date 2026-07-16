// 协调 Yjs 初始同步监听，并避免大快照在 Slate 已连接后逐 operation 回放。
import { YjsPlugin } from "@platejs/yjs/react";
import type { PlateEditor } from "platejs/react";

export type EditorYjsSyncChange = {
  isSynced: boolean;
  type: string;
};

type EditorYjsSyncListener = (event: EditorYjsSyncChange) => void;

type EditorYjsSyncSubscriptionState = {
  dispatch: EditorYjsSyncListener;
  listeners: Set<EditorYjsSyncListener>;
  upstream: EditorYjsSyncListener | undefined;
};

const syncSubscriptionStates = new WeakMap<PlateEditor, EditorYjsSyncSubscriptionState>();

const markYjsBootstrap = (name: string) => {
  globalThis.performance?.mark?.(`sharebrain:editor-yjs:${name}`);
};

export function subscribeEditorYjsSync(
  editor: PlateEditor,
  listener: EditorYjsSyncListener,
) {
  let state = syncSubscriptionStates.get(editor);

  if (!state) {
    const listeners = new Set<EditorYjsSyncListener>();
    const upstream = editor.getOption(YjsPlugin, "onSyncChange");
    const nextState: EditorYjsSyncSubscriptionState = {
      listeners,
      upstream,
      dispatch: (event) => {
        markYjsBootstrap(`sync:${event.type}:${event.isSynced}`);
        nextState.upstream?.(event);

        for (const currentListener of [...nextState.listeners]) {
          currentListener(event);
        }
      },
    };

    state = nextState;
    syncSubscriptionStates.set(editor, state);
    editor.setOption(YjsPlugin, "onSyncChange", state.dispatch);
  }

  state.listeners.add(listener);
  let subscribed = true;

  return () => {
    if (!subscribed) return;
    subscribed = false;
    state.listeners.delete(listener);

    if (state.listeners.size > 0) return;

    if (editor.getOption(YjsPlugin, "onSyncChange") === state.dispatch) {
      editor.setOption(YjsPlugin, "onSyncChange", state.upstream);
    }

    syncSubscriptionStates.delete(editor);
  };
}

type YjsConnectableEditor = PlateEditor & {
  connect: () => void;
};

export type DeferredYjsConnectionReason = "cache" | "fallback" | "sync";

export type DeferredYjsConnectionOptions = {
  fallbackMs?: number | null;
  onConnected?: (context: {
    afterInitialization: boolean;
    reason: DeferredYjsConnectionReason;
  }) => void;
  onError?: (error: unknown) => void;
  shouldConnectOnSync?: (event: EditorYjsSyncChange) => boolean;
};

export type DeferredYjsConnection = {
  connectFromCurrentState: (reason?: DeferredYjsConnectionReason) => void;
  dispose: () => void;
  finishInitialization: () => void;
  isConnected: () => boolean;
};

const defaultFallbackMs = 60_000;

export function deferYjsEditorConnectionUntilInitialSync(
  editor: PlateEditor,
  {
    fallbackMs = defaultFallbackMs,
    onConnected,
    onError,
    shouldConnectOnSync,
  }: DeferredYjsConnectionOptions = {},
): DeferredYjsConnection {
  const connectableEditor = editor as YjsConnectableEditor;
  const originalConnect = connectableEditor.connect;

  if (typeof originalConnect !== "function") {
    throw new Error("Yjs editor connect method is unavailable");
  }

  let connected = false;
  let disposed = false;
  let initializationFinished = false;
  let connecting = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const restoreConnect = () => {
    if (connectableEditor.connect === deferredConnect) {
      connectableEditor.connect = originalConnect;
    }
  };

  const clearFallback = () => {
    if (fallbackTimer === null) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };

  const connectOnce = (reason: DeferredYjsConnectionReason) => {
    if (connected || connecting || disposed) return;
    connecting = true;

    try {
      originalConnect.call(connectableEditor);
      connected = true;
      markYjsBootstrap(`connect:${reason}`);
      clearFallback();
      onConnected?.({ afterInitialization: initializationFinished, reason });

      if (initializationFinished) {
        restoreConnect();
      }
    } catch (error) {
      onError?.(error);
    } finally {
      connecting = false;
    }
  };

  function deferredConnect() {
    // Plate 的 init 无论 provider 是否已同步都会调用 connect。首次同步前保持
    // Y.Doc 与 Slate 分离，避免后续大快照被 observeDeep 翻译成数千次操作。
  }

  connectableEditor.connect = deferredConnect;

  const unsubscribe = subscribeEditorYjsSync(editor, (event) => {
    if (event.isSynced && (shouldConnectOnSync?.(event) ?? true)) {
      connectOnce(event.type === "indexeddb" ? "cache" : "sync");
    }
  });

  if (fallbackMs !== null) {
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      connectOnce("fallback");
    }, Math.max(0, fallbackMs));
  }

  return {
    connectFromCurrentState: (reason = "cache") => connectOnce(reason),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearFallback();
      unsubscribe();

      // init 尚未返回时仍保留空实现，防止卸载后的异步 init 再连接编辑器。
      if (initializationFinished) {
        restoreConnect();
      }
    },
    finishInitialization: () => {
      initializationFinished = true;

      if (connected || disposed) {
        restoreConnect();
      }
    },
    isConnected: () => connected,
  };
}
