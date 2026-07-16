// 验证 Yjs 首次同步连接门控和多订阅者回调组合。
import { describe, expect, test } from "bun:test";
import { YjsPlugin } from "@platejs/yjs/react";
import type { PlateEditor } from "platejs/react";

import {
  deferYjsEditorConnectionUntilInitialSync,
  subscribeEditorYjsSync,
  type EditorYjsSyncChange,
} from "./editor-yjs-bootstrap";

type TestEditor = PlateEditor & {
  connect: () => void;
};

function createTestEditor(upstream?: (event: EditorYjsSyncChange) => void) {
  let connectCount = 0;
  let onSyncChange = upstream;
  const originalConnect = () => {
    connectCount += 1;
  };
  const editor = {
    connect: originalConnect,
    getOption: (_plugin: unknown, key: string) =>
      key === "onSyncChange" ? onSyncChange : undefined,
    setOption: (_plugin: unknown, key: string, value: unknown) => {
      if (key === "onSyncChange") {
        onSyncChange = value as typeof onSyncChange;
      }
    },
  } as unknown as TestEditor;

  return {
    editor,
    emitSync: (isSynced: boolean, type = "hocuspocus") =>
      onSyncChange?.({ isSynced, type }),
    getConnectCount: () => connectCount,
    getSyncHandler: () => onSyncChange,
    originalConnect,
  };
}

describe("deferYjsEditorConnectionUntilInitialSync", () => {
  test("keeps the init connect call deferred until the provider syncs", () => {
    const fixture = createTestEditor();
    const connected: string[] = [];
    const controller = deferYjsEditorConnectionUntilInitialSync(fixture.editor, {
      fallbackMs: null,
      onConnected: ({ afterInitialization, reason }) => {
        connected.push(`${reason}:${afterInitialization}`);
      },
    });

    fixture.editor.connect();
    controller.finishInitialization();

    expect(fixture.getConnectCount()).toBe(0);

    fixture.emitSync(true);

    expect(fixture.getConnectCount()).toBe(1);
    expect(connected).toEqual(["sync:true"]);
    expect(fixture.editor.connect).toBe(fixture.originalConnect);

    fixture.emitSync(true);
    expect(fixture.getConnectCount()).toBe(1);
  });

  test("absorbs Plate's second connect when sync finishes before init", () => {
    const fixture = createTestEditor();
    const connected: boolean[] = [];
    const controller = deferYjsEditorConnectionUntilInitialSync(fixture.editor, {
      fallbackMs: null,
      onConnected: ({ afterInitialization }) => {
        connected.push(afterInitialization);
      },
    });

    fixture.emitSync(true);
    fixture.editor.connect();

    expect(fixture.getConnectCount()).toBe(1);
    expect(connected).toEqual([false]);

    controller.finishInitialization();
    expect(fixture.editor.connect).toBe(fixture.originalConnect);
  });

  test("does not reconnect an editor after disposal during async init", () => {
    const fixture = createTestEditor();
    const controller = deferYjsEditorConnectionUntilInitialSync(fixture.editor, {
      fallbackMs: null,
    });

    controller.dispose();
    fixture.editor.connect();
    fixture.emitSync(true);

    expect(fixture.getConnectCount()).toBe(0);

    controller.finishInitialization();
    expect(fixture.editor.connect).toBe(fixture.originalConnect);
  });

  test("can wait for remote authentication before hydrating a local cache", () => {
    const fixture = createTestEditor();
    let authenticated = false;
    const reasons: string[] = [];
    const controller = deferYjsEditorConnectionUntilInitialSync(fixture.editor, {
      fallbackMs: null,
      onConnected: ({ reason }) => reasons.push(reason),
      shouldConnectOnSync: ({ type }) => type !== "indexeddb" || authenticated,
    });

    fixture.emitSync(true, "indexeddb");
    controller.finishInitialization();
    expect(fixture.getConnectCount()).toBe(0);

    authenticated = true;
    controller.connectFromCurrentState("cache");

    expect(fixture.getConnectCount()).toBe(1);
    expect(reasons).toEqual(["cache"]);
  });
});

describe("subscribeEditorYjsSync", () => {
  test("fans out sync changes without replacing existing consumers", () => {
    const upstreamEvents: boolean[] = [];
    const firstEvents: boolean[] = [];
    const secondEvents: boolean[] = [];
    const fixture = createTestEditor((event) => upstreamEvents.push(event.isSynced));
    const unsubscribeFirst = subscribeEditorYjsSync(fixture.editor, (event) =>
      firstEvents.push(event.isSynced),
    );
    const unsubscribeSecond = subscribeEditorYjsSync(fixture.editor, (event) =>
      secondEvents.push(event.isSynced),
    );

    fixture.emitSync(true);
    unsubscribeFirst();
    fixture.emitSync(false);
    unsubscribeSecond();

    expect(upstreamEvents).toEqual([true, false]);
    expect(firstEvents).toEqual([true]);
    expect(secondEvents).toEqual([true, false]);
    expect(fixture.getSyncHandler()).not.toBeUndefined();
  });
});
