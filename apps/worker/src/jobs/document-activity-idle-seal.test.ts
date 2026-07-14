// 验证活动会话只在空闲阈值后封存，并在 document 锁后二次检查避免竞态。
import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { diffDocumentActivityBlocks, documentContentActivityDetailsSchema } from "@sharebrain/contracts";
import { createDatabaseClient, recordDocumentContentActivity } from "@sharebrain/db";
import {
  documentActivityEvents,
  documentEditSessions,
  documents,
  projectModules,
} from "@sharebrain/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { runDocumentActivityIdleSeal } from "./document-activity-idle-seal";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const documentIds: string[] = [];
let moduleId = "";
let projectId = "";

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
  if (!module) throw new Error("Activity idle seal tests require seeded project modules");
  moduleId = module.id;
  projectId = module.projectId;
});

afterAll(async () => {
  if (documentIds.length > 0) {
    await db.delete(documentEditSessions).where(inArray(documentEditSessions.documentId, documentIds));
    await db.delete(documentActivityEvents).where(inArray(documentActivityEvents.documentId, documentIds));
    await db.delete(documents).where(inArray(documents.id, documentIds));
  }
  await db.$client.end({ timeout: 1 });
});

describe("document activity idle seal", () => {
  test("seals only sessions at or before the cutoff", async () => {
    const now = new Date("2026-07-13T16:00:00.000Z");
    const oldDocumentId = crypto.randomUUID();
    const freshDocumentId = crypto.randomUUID();
    documentIds.push(oldDocumentId, freshDocumentId);
    await db.insert(documents).values(
      [oldDocumentId, freshDocumentId].map((id) => ({
        id,
        tenantId: env.DEV_AUTH_TENANT_ID,
        projectId,
        moduleId,
        title: id === oldDocumentId ? "Old activity" : "Fresh activity",
        sortKey: `activity-idle-${id}`,
        createdBy: env.DEV_AUTH_USER_ID,
        updatedBy: env.DEV_AUTH_USER_ID,
      })),
    );
    const details = documentContentActivityDetailsSchema.parse(
      diffDocumentActivityBlocks(
        [{ id: "a", type: "p", children: [{ text: "before" }] }],
        [{ id: "a", type: "p", children: [{ text: "after" }] }],
      ),
    );
    const beforeValue = [{ id: "a", type: "p", children: [{ text: "before" }] }];
    const afterValue = [{ id: "a", type: "p", children: [{ text: "after" }] }];
    await db.transaction(async (tx) => {
      await recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId: oldDocumentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "old",
        details,
        beforeValue,
        afterValue,
        now: new Date(now.getTime() - 120_000),
      });
      await recordDocumentContentActivity(tx, {
        tenantId: env.DEV_AUTH_TENANT_ID,
        documentId: freshDocumentId,
        actorId: env.DEV_AUTH_USER_ID,
        sourceKey: "fresh",
        details,
        beforeValue,
        afterValue,
        now: new Date(now.getTime() - 119_999),
      });
    });

    const result = await runDocumentActivityIdleSeal(
      db,
      {
        ...env,
        DOCUMENT_ACTIVITY_HISTORY_ENABLED: true,
        DOCUMENT_ACTIVITY_IDLE_SEAL_SECONDS: 120,
      },
      { now, tenantId: env.DEV_AUTH_TENANT_ID },
    );
    const events = await db
      .select({
        documentId: documentActivityEvents.documentId,
        status: documentActivityEvents.status,
        beforeRevisionId: documentActivityEvents.beforeRevisionId,
        afterRevisionId: documentActivityEvents.afterRevisionId,
      })
      .from(documentActivityEvents)
      .where(inArray(documentActivityEvents.documentId, [oldDocumentId, freshDocumentId]));

    expect(result.sealed).toBeGreaterThanOrEqual(1);
    expect(events.find((event) => event.documentId === oldDocumentId)?.status).toBe("sealed");
    expect(events.find((event) => event.documentId === oldDocumentId)).toMatchObject({
      beforeRevisionId: expect.any(String),
      afterRevisionId: expect.any(String),
    });
    expect(events.find((event) => event.documentId === freshDocumentId)?.status).toBe("open");
    const [oldSession] = await db
      .select({
        beforeValue: documentEditSessions.beforeValue,
        afterValue: documentEditSessions.afterValue,
      })
      .from(documentEditSessions)
      .where(eq(documentEditSessions.documentId, oldDocumentId));
    expect(oldSession).toEqual({ beforeValue: null, afterValue: null });
  });
});
