// 验证活动历史 API 的文档隔离、open 状态、sequence 游标分页和 feature flag。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  hashDocumentVersionValue,
  type DocumentActivityDetail,
  type DocumentActivityListResponse,
} from "@sharebrain/contracts";
import {
  auditLogs,
  documentActivityEvents,
  documentEditSessions,
  documentRevisions,
  documentVersionOperations,
  documents,
  projectModules,
} from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { createTestApp } from "../../test/test-app";

const testApp = createTestApp({
  ...process.env,
  DOCUMENT_ACTIVITY_HISTORY_ENABLED: "true",
  DOCUMENT_VERSION_HISTORY_ENABLED: "true",
  DOCUMENT_VERSION_RESTORE_ENABLED: "true",
});
const documentId = crypto.randomUUID();
const otherDocumentId = crypto.randomUUID();
const eventIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
] as const;
const revisionIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
const beforeValue = [{ id: "a", type: "p", children: [{ text: "before activity" }] }];
const afterValue = [{ id: "a", type: "p", children: [{ text: "after activity" }] }];
const authHeaders = {
  "x-dev-user-id": testApp.env.DEV_AUTH_USER_ID,
  "x-dev-tenant-id": testApp.env.DEV_AUTH_TENANT_ID,
};

beforeAll(async () => {
  const [module] = await testApp.db
    .select({ id: projectModules.id, projectId: projectModules.projectId })
    .from(projectModules)
    .where(
      and(
        eq(projectModules.tenantId, testApp.env.DEV_AUTH_TENANT_ID),
        isNull(projectModules.deletedAt),
      ),
    )
    .limit(1);
  if (!module) throw new Error("Activity API tests require seeded project modules");
  await testApp.db.insert(documents).values([
    {
      id: documentId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      projectId: module.projectId,
      moduleId: module.id,
      title: "Activity API test",
      sortKey: `activity-api-${documentId}`,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: otherDocumentId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      projectId: module.projectId,
      moduleId: module.id,
      title: "Other activity API test",
      sortKey: `activity-api-${otherDocumentId}`,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
  ]);
  const firstAt = new Date("2026-07-13T17:00:00.000Z");
  await testApp.db.insert(documentRevisions).values([
    {
      id: revisionIds[0],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      formatVersion: 1,
      contentHash: await hashDocumentVersionValue(beforeValue),
      plateJson: beforeValue,
      plainText: "before activity",
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: revisionIds[1],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      formatVersion: 1,
      contentHash: await hashDocumentVersionValue(afterValue),
      plateJson: afterValue,
      plainText: "after activity",
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
  ]);
  await testApp.db.insert(documentActivityEvents).values([
    {
      id: eventIds[0],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      actorId: testApp.env.DEV_AUTH_USER_ID,
      type: "title_edited",
      status: "sealed",
      sourceKey: "title:first",
      details: { kind: "title", beforeTitle: "Before", afterTitle: "After" },
      startedAt: firstAt,
      occurredAt: firstAt,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: eventIds[1],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      actorId: testApp.env.DEV_AUTH_USER_ID,
      type: "content_edited",
      status: "sealed",
      sourceKey: "content:sealed",
      beforeRevisionId: revisionIds[0],
      afterRevisionId: revisionIds[1],
      details: {
        kind: "content",
        changes: [{
          blockId: "a",
          kind: "updated",
          before: { fingerprint: "v1:before", text: "before activity", type: "p" },
          after: { fingerprint: "v1:after", text: "after activity", type: "p" },
        }],
        totalChangedBlocks: 1,
        truncated: false,
      },
      startedAt: new Date(firstAt.getTime() + 1_000),
      occurredAt: new Date(firstAt.getTime() + 2_000),
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: eventIds[2],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      actorId: testApp.env.DEV_AUTH_USER_ID,
      type: "content_edited",
      status: "open",
      sourceKey: "content:open",
      details: {
        kind: "content",
        changes: [],
        totalChangedBlocks: 1,
        truncated: true,
      },
      startedAt: new Date(firstAt.getTime() + 3_000),
      occurredAt: new Date(firstAt.getTime() + 4_000),
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: eventIds[3],
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId: otherDocumentId,
      actorId: testApp.env.DEV_AUTH_USER_ID,
      type: "document_created",
      status: "sealed",
      sourceKey: "document-created:other",
      details: { kind: "document_created", title: "Other" },
      startedAt: firstAt,
      occurredAt: firstAt,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
  ]);
  await testApp.db.insert(documentEditSessions).values({
    tenantId: testApp.env.DEV_AUTH_TENANT_ID,
    documentId,
    actorId: testApp.env.DEV_AUTH_USER_ID,
    activityEventId: eventIds[2],
    startedAt: new Date(firstAt.getTime() + 3_000),
    lastChangedAt: new Date(firstAt.getTime() + 4_000),
    beforeValue,
    afterValue,
    processedSourceKeys: ["fixture:open"],
    createdBy: testApp.env.DEV_AUTH_USER_ID,
    updatedBy: testApp.env.DEV_AUTH_USER_ID,
  });
});

afterAll(async () => {
  await testApp.db.delete(auditLogs).where(eq(auditLogs.documentId, documentId));
  await testApp.db
    .delete(documentVersionOperations)
    .where(eq(documentVersionOperations.documentId, documentId));
  await testApp.db.delete(documentEditSessions).where(eq(documentEditSessions.documentId, documentId));
  await testApp.db.delete(documentActivityEvents).where(eq(documentActivityEvents.documentId, documentId));
  await testApp.db
    .delete(documentActivityEvents)
    .where(eq(documentActivityEvents.documentId, otherDocumentId));
  await testApp.db.delete(documents).where(eq(documents.id, documentId));
  await testApp.db.delete(documents).where(eq(documents.id, otherDocumentId));
  await testApp.close();
});

describe("document activity history API", () => {
  test("paginates only the requested document and preserves open state", async () => {
    const firstResponse = await testApp.app.request(
      `/api/documents/${documentId}/activities?limit=1`,
      { headers: authHeaders },
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as DocumentActivityListResponse;
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: eventIds[2],
      status: "open",
      inspectable: true,
      restorable: false,
    });
    expect(first.nextCursor).not.toBeNull();

    const nextResponse = await testApp.app.request(
      `/api/documents/${documentId}/activities?limit=1&cursor=${first.nextCursor}`,
      { headers: authHeaders },
    );
    const next = (await nextResponse.json()) as DocumentActivityListResponse;
    expect(next.items.map((item) => item.id)).toEqual([eventIds[1]]);
    expect(next.items.map((item) => item.id)).not.toContain(eventIds[3]);
  });

  test("loads open and sealed revisions and creates typed activity restore operations", async () => {
    const openResponse = await testApp.app.request(
      `/api/documents/${documentId}/activities/${eventIds[2]}`,
      { headers: authHeaders },
    );
    expect(openResponse.status).toBe(200);
    const open = (await openResponse.json()) as DocumentActivityDetail;
    expect(open).toMatchObject({ status: "open", inspectable: true, restorable: false });
    expect(open.afterValue).toEqual([{ children: [{ text: "after activity" }], id: "a", type: "p" }]);

    const sealedResponse = await testApp.app.request(
      `/api/documents/${documentId}/activities/${eventIds[1]}`,
      { headers: authHeaders },
    );
    expect(sealedResponse.status).toBe(200);
    const sealed = (await sealedResponse.json()) as DocumentActivityDetail;
    expect(sealed).toMatchObject({ status: "sealed", inspectable: true, restorable: true });

    const path = `/api/documents/${documentId}/activities/${eventIds[1]}/restore-operations`;
    const viewer = await testApp.app.request(path, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "viewer" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), baseStateVector: "AQID" }),
    });
    expect(viewer.status).toBe(403);
    const editor = await testApp.app.request(path, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), baseStateVector: "AQID" }),
    });
    expect(editor.status).toBe(202);
    expect(await editor.json()).toMatchObject({
      status: "pending",
      sourceKind: "activity",
      sourceVersionNo: null,
      sourceActivityEventId: eventIds[1],
    });
  });

  test("hides the endpoint when activity history is disabled", async () => {
    const disabled = createTestApp({
      ...process.env,
      DOCUMENT_ACTIVITY_HISTORY_ENABLED: "false",
    });
    try {
      const response = await disabled.app.request(
        `/api/documents/${documentId}/activities`,
        { headers: authHeaders },
      );
      expect(response.status).toBe(404);
    } finally {
      await disabled.close();
    }
  });
});
