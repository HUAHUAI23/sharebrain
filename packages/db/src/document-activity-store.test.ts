// 验证文档活动 store 的 open session 聚合、幂等、超时滚动和独立事件语义。
import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { diffDocumentActivityBlocks } from "@sharebrain/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { createDatabaseClient } from "./client";
import {
  DOCUMENT_ACTIVITY_SESSION_IDLE_MS,
  recordDocumentContentActivity,
  recordStandaloneDocumentActivity,
} from "./document-activity-store";
import {
  documentActivityEvents,
  documentEditSessions,
  documents,
  documentVersions,
  projectModules,
  users,
} from "./schema";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const documentIds: string[] = [];
let moduleId = "";
let projectId = "";
const otherActorId = crypto.randomUUID();

async function createTestDocument(title: string) {
  const id = crypto.randomUUID();
  documentIds.push(id);
  await db.insert(documents).values({
    id,
    tenantId: env.DEV_AUTH_TENANT_ID,
    projectId,
    moduleId,
    title,
    sortKey: `activity-store-${id}`,
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
  return id;
}

beforeAll(async () => {
  const [module] = await db
    .select({ id: projectModules.id, projectId: projectModules.projectId })
    .from(projectModules)
    .where(
      and(
        eq(projectModules.tenantId, env.DEV_AUTH_TENANT_ID),
        isNull(projectModules.deletedAt),
      ),
    )
    .limit(1);
  if (!module) throw new Error("Document activity tests require seeded project modules");
  moduleId = module.id;
  projectId = module.projectId;
  await db.insert(users).values({
    id: otherActorId,
    tenantId: env.DEV_AUTH_TENANT_ID,
    email: `activity-store-${otherActorId}@sharebrain.test`,
    displayName: "Other activity actor",
    createdBy: env.DEV_AUTH_USER_ID,
    updatedBy: env.DEV_AUTH_USER_ID,
  });
});

afterAll(async () => {
  if (documentIds.length > 0) {
    await db.delete(documentEditSessions).where(inArray(documentEditSessions.documentId, documentIds));
    await db.delete(documentActivityEvents).where(inArray(documentActivityEvents.documentId, documentIds));
    await db.delete(documentVersions).where(inArray(documentVersions.documentId, documentIds));
    await db.delete(documents).where(inArray(documents.id, documentIds));
  }
  await db.delete(users).where(eq(users.id, otherActorId));
  await db.$client.end({ timeout: 1 });
});

describe("document activity store", () => {
  test("merges content changes in the idle window and ignores repeated source keys", async () => {
    const documentId = await createTestDocument("Session merge");
    const startedAt = new Date("2026-07-13T12:00:00.000Z");
    const initial = [{ id: "a", type: "p", children: [{ text: "initial" }] }];
    const firstValue = [{ id: "a", type: "p", children: [{ text: "first" }] }];
    const finalValue = [{ id: "a", type: "p", children: [{ text: "final" }] }];
    const first = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:first",
        details: diffDocumentActivityBlocks(initial, firstValue),
        beforeValue: initial,
        afterValue: firstValue,
        startedAt,
        now: startedAt,
      }),
    );
    const secondAt = new Date(startedAt.getTime() + 60_000);
    const second = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:second",
        details: diffDocumentActivityBlocks(firstValue, finalValue),
        beforeValue: firstValue,
        afterValue: finalValue,
        now: secondAt,
      }),
    );
    const repeated = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:second",
        details: diffDocumentActivityBlocks(firstValue, finalValue),
        beforeValue: firstValue,
        afterValue: finalValue,
        now: secondAt,
      }),
    );

    expect(second?.session.id).toBe(first?.session.id);
    expect(repeated?.session.changeCount).toBe(2);
    expect(second?.event.details).toMatchObject({
      kind: "content",
      changes: [{ before: { text: "initial" }, after: { text: "final" } }],
    });
  });

  test("seals a stale session before creating the next one", async () => {
    const documentId = await createTestDocument("Session rollover");
    const startedAt = new Date("2026-07-13T13:00:00.000Z");
    const first = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:rollover:first",
        beforeValue: [{ id: "a", type: "p", children: [{ text: "a" }] }],
        afterValue: [{ id: "a", type: "p", children: [{ text: "b" }] }],
        details: diffDocumentActivityBlocks(
          [{ id: "a", type: "p", children: [{ text: "a" }] }],
          [{ id: "a", type: "p", children: [{ text: "b" }] }],
        ),
        now: startedAt,
      }),
    );
    const next = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:rollover:next",
        beforeValue: [{ id: "a", type: "p", children: [{ text: "b" }] }],
        afterValue: [{ id: "a", type: "p", children: [{ text: "c" }] }],
        details: diffDocumentActivityBlocks(
          [{ id: "a", type: "p", children: [{ text: "b" }] }],
          [{ id: "a", type: "p", children: [{ text: "c" }] }],
        ),
        now: new Date(startedAt.getTime() + DOCUMENT_ACTIVITY_SESSION_IDLE_MS),
      }),
    );

    expect(next?.session.id).not.toBe(first?.session.id);
    const sessions = await db
      .select()
      .from(documentEditSessions)
      .where(eq(documentEditSessions.documentId, documentId))
      .orderBy(asc(documentEditSessions.startedAt));
    expect(sessions[0]?.sealedAt).not.toBeNull();
    expect(sessions[1]?.sealedAt).toBeNull();
  });

  test("keeps standalone activities idempotent", async () => {
    const documentId = await createTestDocument("Standalone idempotence");
    const input = {
      tenantId: env.DEV_AUTH_TENANT_ID,
      documentId,
      actorId: env.DEV_AUTH_USER_ID,
      type: "title_edited" as const,
      sourceKey: "title:request-1",
      details: { kind: "title" as const, beforeTitle: "Before", afterTitle: "After" },
      now: new Date("2026-07-13T14:00:00.000Z"),
    };
    const first = await db.transaction((tx) => recordStandaloneDocumentActivity(tx, input));
    const repeated = await db.transaction((tx) => recordStandaloneDocumentActivity(tx, input));

    expect(repeated?.id).toBe(first?.id);
    const events = await db
      .select()
      .from(documentActivityEvents)
      .where(eq(documentActivityEvents.documentId, documentId));
    expect(events).toHaveLength(1);
  });

  test("seals the previous actor at a visible actor boundary", async () => {
    const documentId = await createTestDocument("Actor boundary");
    const startedAt = new Date("2026-07-13T15:00:00.000Z");
    const before = [{ id: "a", type: "p", children: [{ text: "before" }] }];
    const firstAfter = [{ id: "a", type: "p", children: [{ text: "first actor" }] }];
    const secondAfter = [{ id: "a", type: "p", children: [{ text: "second actor" }] }];
    const first = await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "batch:actor:first",
        details: diffDocumentActivityBlocks(before, firstAfter),
        beforeValue: before,
        afterValue: firstAfter,
        now: startedAt,
      }),
    );
    await db.transaction((tx) =>
      recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId,
        actorId: otherActorId,
        sourceKey: "batch:actor:second",
        details: diffDocumentActivityBlocks(firstAfter, secondAfter),
        beforeValue: firstAfter,
        afterValue: secondAfter,
        now: new Date(startedAt.getTime() + 10_000),
      }),
    );

    const [sealedSession] = await db
      .select()
      .from(documentEditSessions)
      .where(eq(documentEditSessions.id, first!.session.id));
    const [sealedEvent] = await db
      .select()
      .from(documentActivityEvents)
      .where(eq(documentActivityEvents.id, first!.event.id));
    expect(sealedSession).toMatchObject({
      sealedAt: expect.any(Date),
      beforeValue: null,
      afterValue: null,
    });
    expect(sealedEvent).toMatchObject({
      status: "sealed",
      beforeRevisionId: expect.any(String),
      afterRevisionId: expect.any(String),
    });
  });
});
