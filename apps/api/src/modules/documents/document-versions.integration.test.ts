// 验证 sealed 历史 API 的分页、正文隔离、ETag、角色读取和归属约束。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DOCUMENT_VERSION_FORMAT_VERSION,
  hashDocumentVersionValue,
  type DocumentVersionDetail,
  type DocumentVersionListResponse,
} from "@sharebrain/contracts";
import {
  auditLogs,
  documentVersionOperations,
  documentVersions,
  documents,
  projectModules,
} from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { createTestApp } from "../../test/test-app";

const testApp = createTestApp({
  ...process.env,
  DOCUMENT_VERSION_HISTORY_ENABLED: "true",
  DOCUMENT_VERSION_RESTORE_ENABLED: "true",
});
const documentId = crypto.randomUUID();
const otherDocumentId = crypto.randomUUID();
const sealedVersionId = crypto.randomUUID();
const openVersionId = crypto.randomUUID();
const otherVersionId = crypto.randomUUID();

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
  if (!module) throw new Error("Version history integration tests require seeded project modules");
  const now = new Date();
  await testApp.db.insert(documents).values([
    {
      id: documentId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      projectId: module.projectId,
      moduleId: module.id,
      title: "Version API test",
      currentVersion: 2,
      sortKey: `version-api-${documentId}`,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: otherDocumentId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      projectId: module.projectId,
      moduleId: module.id,
      title: "Other version API test",
      currentVersion: 1,
      sortKey: `version-api-${otherDocumentId}`,
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
  ]);
  const sealedValue = [{ type: "p", children: [{ text: "sealed body" }] }];
  const openValue = [{ type: "p", children: [{ text: "open body" }] }];
  await testApp.db.insert(documentVersions).values([
    {
      id: sealedVersionId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 1,
      kind: "auto",
      sealedAt: new Date(now.getTime() - 60_000),
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash: await hashDocumentVersionValue(sealedValue),
      plateJson: sealedValue,
      plainText: "sealed body",
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: openVersionId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId,
      versionNo: 2,
      kind: "auto",
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash: await hashDocumentVersionValue(openValue),
      plateJson: openValue,
      plainText: "open body",
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
    {
      id: otherVersionId,
      tenantId: testApp.env.DEV_AUTH_TENANT_ID,
      documentId: otherDocumentId,
      versionNo: 1,
      kind: "auto",
      sealedAt: now,
      formatVersion: DOCUMENT_VERSION_FORMAT_VERSION,
      contentHash: await hashDocumentVersionValue(sealedValue),
      plateJson: sealedValue,
      plainText: "sealed body",
      createdBy: testApp.env.DEV_AUTH_USER_ID,
      updatedBy: testApp.env.DEV_AUTH_USER_ID,
    },
  ]);
});

afterAll(async () => {
  await testApp.db.delete(auditLogs).where(eq(auditLogs.documentId, documentId));
  await testApp.db
    .delete(documentVersionOperations)
    .where(eq(documentVersionOperations.documentId, documentId));
  await testApp.db.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
  await testApp.db.delete(documentVersions).where(eq(documentVersions.documentId, otherDocumentId));
  await testApp.db.delete(documents).where(eq(documents.id, documentId));
  await testApp.db.delete(documents).where(eq(documents.id, otherDocumentId));
  await testApp.close();
});

describe("document version history API", () => {
  test("lists only sealed summaries without content", async () => {
    const response = await testApp.app.request(`/api/documents/${documentId}/versions`, {
      headers: authHeaders,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DocumentVersionListResponse & { plateJson?: unknown };
    expect(body.items.map((item) => item.id)).toEqual([sealedVersionId]);
    expect(body.items[0]).not.toHaveProperty("value");
    expect(body).not.toHaveProperty("plateJson");
  });

  test("loads immutable details with ETag", async () => {
    const response = await testApp.app.request(
      `/api/documents/${documentId}/versions/${sealedVersionId}`,
      { headers: { ...authHeaders, "x-dev-role": "viewer" } },
    );
    expect(response.status).toBe(200);
    const etag = response.headers.get("etag");
    const body = (await response.json()) as DocumentVersionDetail;
    expect(body.value).toEqual([{ children: [{ text: "sealed body" }], type: "p" }]);
    expect(body.previousValue).toEqual([]);
    expect(body.previousVersionNo).toBeNull();
    expect(etag).toBe(`"${body.contentHash}"`);

    const cached = await testApp.app.request(
      `/api/documents/${documentId}/versions/${sealedVersionId}`,
      { headers: { ...authHeaders, "if-none-match": etag! } },
    );
    expect(cached.status).toBe(304);
  });

  test("rejects invalid cursors and cross-document versions", async () => {
    const cursor = await testApp.app.request(`/api/documents/${documentId}/versions?cursor=invalid!`, {
      headers: authHeaders,
    });
    expect(cursor.status).toBe(400);
    const crossDocument = await testApp.app.request(
      `/api/documents/${documentId}/versions/${otherVersionId}`,
      { headers: authHeaders },
    );
    expect(crossDocument.status).toBe(404);
  });

  test("creates idempotent restore operations without trusting viewer clients", async () => {
    const requestId = crypto.randomUUID();
    const path = `/api/documents/${documentId}/versions/${sealedVersionId}/restore-operations`;
    const viewer = await testApp.app.request(path, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "viewer" },
      body: JSON.stringify({ requestId, baseStateVector: "AQID" }),
    });
    expect(viewer.status).toBe(403);

    const create = () =>
      testApp.app.request(path, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
        body: JSON.stringify({ requestId, baseStateVector: "AQID" }),
      });
    const [first, concurrent] = await Promise.all([create(), create()]);
    expect(first.status).toBe(202);
    expect(concurrent.status).toBe(202);
    const firstBody = (await first.json()) as { operationId: string; status: string };
    const concurrentBody = (await concurrent.json()) as { operationId: string; status: string };
    expect(firstBody.operationId).not.toBe(requestId);
    expect(firstBody.status).toBe("pending");
    expect(concurrentBody.operationId).toBe(firstBody.operationId);

    const repeated = await create();
    expect(repeated.status).toBe(202);
    expect(((await repeated.json()) as { operationId: string }).operationId).toBe(firstBody.operationId);

    const mismatch = await testApp.app.request(path, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
      body: JSON.stringify({ requestId, baseStateVector: "AQID", force: true }),
    });
    expect(mismatch.status).toBe(409);

    const status = await testApp.app.request(
      `/api/documents/${documentId}/version-operations/${firstBody.operationId}`,
      { headers: authHeaders },
    );
    expect(status.status).toBe(200);

    await testApp.db
      .update(documentVersionOperations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(documentVersionOperations.id, firstBody.operationId));
    const expiredStatus = await testApp.app.request(
      `/api/documents/${documentId}/version-operations/${firstBody.operationId}`,
      { headers: authHeaders },
    );
    expect(expiredStatus.status).toBe(200);
    expect(await expiredStatus.json()).toMatchObject({
      operationId: firstBody.operationId,
      status: "expired",
      errorCode: "DOCUMENT_VERSION_OPERATION_EXPIRED",
    });

    const replacement = await testApp.app.request(path, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), baseStateVector: "AQID" }),
    });
    expect(replacement.status).toBe(202);
    expect(await replacement.json()).toMatchObject({ status: "pending" });
  });

  test("keeps history reading available when restore is disabled", async () => {
    const readOnlyApp = createTestApp({
      ...process.env,
      DOCUMENT_VERSION_HISTORY_ENABLED: "true",
      DOCUMENT_VERSION_RESTORE_ENABLED: "false",
    });
    const disabledApp = createTestApp({
      ...process.env,
      DOCUMENT_VERSION_HISTORY_ENABLED: "false",
      DOCUMENT_VERSION_RESTORE_ENABLED: "true",
    });
    const restorePath = `/api/documents/${documentId}/versions/${sealedVersionId}/restore-operations`;
    try {
      expect(
        (await readOnlyApp.app.request(`/api/documents/${documentId}/versions`, { headers: authHeaders }))
          .status,
      ).toBe(200);
      expect(
        (
          await readOnlyApp.app.request(restorePath, {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
            body: JSON.stringify({ requestId: crypto.randomUUID(), baseStateVector: "AQID" }),
          })
        ).status,
      ).toBe(403);
      expect(
        (await disabledApp.app.request(`/api/documents/${documentId}/versions`, { headers: authHeaders }))
          .status,
      ).toBe(404);
      expect(
        (
          await disabledApp.app.request(restorePath, {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json", "x-dev-role": "editor" },
            body: JSON.stringify({ requestId: crypto.randomUUID(), baseStateVector: "AQID" }),
          })
        ).status,
      ).toBe(404);
    } finally {
      await readOnlyApp.close();
      await disabledApp.close();
    }
  });
});
