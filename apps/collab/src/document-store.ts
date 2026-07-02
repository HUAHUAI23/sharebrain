import type { DatabaseClient } from "@sharebrain/db";
import {
  documentCrdtSnapshots,
  documentVersions,
  documents,
  searchItems,
} from "@sharebrain/db/schema";
import { yTextToSlateElement } from "@slate-yjs/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as Y from "yjs";

import type { CollabContext } from "./auth";

/** 距上一个版本超过该间隔才生成新版本行，否则原地更新最新版本。 */
const VERSION_ROLLUP_MS = 5 * 60 * 1000;

function extractTextFromPlate(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextFromPlate).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ownText = typeof record.text === "string" ? record.text : "";
    const childText = extractTextFromPlate(record.children);
    return [ownText, childText].filter(Boolean).join("");
  }

  return "";
}

export async function loadDocumentSnapshot(db: DatabaseClient, context: CollabContext) {
  const [snapshot] = await db
    .select({ ydocSnapshot: documentCrdtSnapshots.ydocSnapshot })
    .from(documentCrdtSnapshots)
    .where(
      and(
        eq(documentCrdtSnapshots.documentId, context.documentId),
        eq(documentCrdtSnapshots.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  return snapshot?.ydocSnapshot ?? null;
}

export async function storeDocumentSnapshot(
  db: DatabaseClient,
  context: CollabContext,
  ydoc: Y.Doc,
) {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  const stateVector = Buffer.from(Y.encodeStateVector(ydoc));

  await db
    .insert(documentCrdtSnapshots)
    .values({
      tenantId: context.tenantId,
      documentId: context.documentId,
      ydocSnapshot: snapshot,
      stateVector,
      updatedBy: context.userId,
    })
    .onConflictDoUpdate({
      target: documentCrdtSnapshots.documentId,
      set: {
        ydocSnapshot: snapshot,
        stateVector,
        updatedBy: context.userId,
        updatedAt: new Date(),
      },
    });

  const sharedRoot = ydoc.get("content", Y.XmlText);
  const plateJson = yTextToSlateElement(sharedRoot).children;
  const plainText = extractTextFromPlate(plateJson);

  await materializeVersion(db, context, plateJson, plainText);
  await upsertSearchItem(db, context, plainText);
}

async function materializeVersion(
  db: DatabaseClient,
  context: CollabContext,
  plateJson: unknown,
  plainText: string,
) {
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, context.documentId),
        eq(documents.tenantId, context.tenantId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!document) {
    return;
  }

  const [latestVersion] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, document.id))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);

  const shouldRollup =
    latestVersion && Date.now() - latestVersion.updatedAt.getTime() < VERSION_ROLLUP_MS;

  if (shouldRollup) {
    await db
      .update(documentVersions)
      .set({
        plateJson: plateJson as never,
        plainText,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(eq(documentVersions.id, latestVersion.id));
  } else {
    const nextVersionNo = (latestVersion?.versionNo ?? 0) + 1;

    await db.insert(documentVersions).values({
      tenantId: context.tenantId,
      documentId: document.id,
      versionNo: nextVersionNo,
      plateJson: plateJson as never,
      markdown: "",
      plainText,
      createdBy: context.userId,
      updatedBy: context.userId,
    });

    await db
      .update(documents)
      .set({ currentVersion: nextVersionNo, updatedBy: context.userId, updatedAt: new Date() })
      .where(eq(documents.id, document.id));

    return;
  }

  await db
    .update(documents)
    .set({ updatedBy: context.userId, updatedAt: new Date() })
    .where(eq(documents.id, document.id));
}

/**
 * 与 API 侧 indexer 的文档分支保持一致的最小搜索读模型更新；
 * blocks/chunks 等派生数据后续由 worker 物化。
 */
async function upsertSearchItem(db: DatabaseClient, context: CollabContext, plainText: string) {
  const [document] = await db
    .select({ id: documents.id, projectId: documents.projectId, title: documents.title })
    .from(documents)
    .where(and(eq(documents.id, context.documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return;
  }

  await db
    .delete(searchItems)
    .where(
      and(
        eq(searchItems.tenantId, context.tenantId),
        eq(searchItems.entityType, "document"),
        eq(searchItems.entityId, document.id),
      ),
    );

  await db.insert(searchItems).values({
    tenantId: context.tenantId,
    projectId: document.projectId,
    entityType: "document",
    entityId: document.id,
    documentId: document.id,
    title: document.title,
    content: plainText || document.title,
    pathText: document.title,
    tags: [],
    metadata: {},
    createdBy: context.userId,
    updatedBy: context.userId,
  });
}
