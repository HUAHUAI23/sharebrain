// 验证活动 tracker 在多人切换时保持 actor 边界，并支持保存失败后的 drain 回滚。
import { describe, expect, test } from "bun:test";
import { slateNodesToInsertDelta, yTextToSlateElement } from "@slate-yjs/core";
import type { Node } from "slate";
import * as Y from "yjs";

import type { CollabContext } from "./auth";
import { DocumentActivityTracker } from "./document-activity-tracker";

const documentId = "00000000-0000-4000-9000-000000000001";
const tenantId = "00000000-0000-4000-9000-000000000002";

function context(userId: string): CollabContext {
  return { userId, tenantId, documentId, role: "editor" };
}

function replaceValue(document: Y.Doc, value: unknown[]) {
  const before = Y.encodeStateVector(document);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(document));
  const root = client.get("content", Y.XmlText);
  client.transact(() => {
    if (root.length > 0) root.delete(0, root.length);
    root.applyDelta(slateNodesToInsertDelta(value as Node[]));
  });
  const update = Y.encodeStateAsUpdate(client, before);
  Y.applyUpdate(document, update);
  client.destroy();
  return update;
}

function valueText(value: unknown[]) {
  return JSON.stringify(value);
}

describe("document activity tracker", () => {
  test("groups contiguous updates and separates actors", () => {
    const tracker = new DocumentActivityTracker();
    const document = new Y.Doc();
    replaceValue(document, [{ id: "a", type: "p", children: [{ text: "initial" }] }]);
    tracker.initialize("document:test", document);

    const actorA = context("00000000-0000-4000-9000-000000000003");
    const actorB = context("00000000-0000-4000-9000-000000000004");
    const updateA1 = replaceValue(document, [
      { id: "a", type: "p", children: [{ text: "actor a 1" }] },
    ]);
    tracker.capture({
      document,
      documentName: "document:test",
      context: actorA,
      update: updateA1,
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    const updateA2 = replaceValue(document, [
      { id: "a", type: "p", children: [{ text: "actor a 2" }] },
    ]);
    tracker.capture({
      document,
      documentName: "document:test",
      context: actorA,
      update: updateA2,
      now: new Date("2026-07-13T12:00:01.000Z"),
    });
    const updateB = replaceValue(document, [
      { id: "a", type: "p", children: [{ text: "actor b" }] },
    ]);
    tracker.capture({
      document,
      documentName: "document:test",
      context: actorB,
      update: updateB,
      now: new Date("2026-07-13T12:00:02.000Z"),
    });

    const drain = tracker.beginDrain("document:test", document);
    expect(drain?.batches).toHaveLength(2);
    expect(drain?.batches.map((batch) => batch.context.userId)).toEqual([
      actorA.userId,
      actorB.userId,
    ]);
    expect(valueText(drain?.batches[0]?.beforeValue ?? [])).toContain("initial");
    expect(valueText(drain?.batches[0]?.afterValue ?? [])).toContain("actor a 2");
    expect(valueText(drain?.batches[1]?.beforeValue ?? [])).toContain("actor a 2");
    expect(valueText(drain?.batches[1]?.afterValue ?? [])).toContain("actor b");
  });

  test("restores in-flight batches when persistence fails", () => {
    const tracker = new DocumentActivityTracker();
    const document = new Y.Doc();
    tracker.initialize("document:test", document);
    const update = replaceValue(document, [
      { id: "a", type: "p", children: [{ text: "retry" }] },
    ]);
    tracker.capture({
      document,
      documentName: "document:test",
      context: context("00000000-0000-4000-9000-000000000003"),
      update,
    });

    const first = tracker.beginDrain("document:test", document);
    if (!first) throw new Error("Expected first drain");
    tracker.rollbackDrain("document:test", first.token);
    const retry = tracker.beginDrain("document:test", document);

    expect(retry?.batches.map((batch) => batch.id)).toEqual(
      first.batches.map((batch) => batch.id),
    );
    expect(yTextToSlateElement(document.get("content", Y.XmlText)).children).toHaveLength(1);
  });
});
