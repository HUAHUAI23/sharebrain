import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createTestApp } from "../test/test-app";

import {
  authAccounts,
  authSessions,
  auditLogs,
  documentBlocks,
  documentChunks,
  documentCrdtSnapshots,
  documents,
  documentVersions,
  mediaObjects,
  mediaUploads,
  mediaUsages,
  moduleRecords,
  moduleTemplateFields,
  moduleTemplates,
  projectModuleFields,
  projectModules,
  projectRecents,
  projects,
  searchItems,
  systemModuleTemplateFields,
  systemModuleTemplates,
  tenants,
  tenantMemberships,
  users,
} from "@sharebrain/db/schema";

const tenantId = "00000000-0000-4000-9000-000000000101";
const userId = "00000000-0000-4000-9000-000000000001";

const testRuntimeEnv = {
  ...process.env,
  DEV_AUTH_TENANT_ID: tenantId,
  DEV_AUTH_USER_ID: userId,
  DEV_AUTH_ROLE: "admin",
};

const testApp = createTestApp(testRuntimeEnv);

async function resetTestWorkspace() {
  await testApp.db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  await testApp.db.delete(authSessions).where(eq(authSessions.tenantId, tenantId));
  await testApp.db.delete(authAccounts).where(eq(authAccounts.tenantId, tenantId));
  await testApp.db.delete(mediaUsages).where(eq(mediaUsages.tenantId, tenantId));
  await testApp.db.delete(mediaUploads).where(eq(mediaUploads.tenantId, tenantId));
  await testApp.db.delete(mediaObjects).where(eq(mediaObjects.tenantId, tenantId));
  await testApp.db.delete(documentChunks).where(eq(documentChunks.tenantId, tenantId));
  await testApp.db.delete(documentBlocks).where(eq(documentBlocks.tenantId, tenantId));
  await testApp.db.delete(documentCrdtSnapshots).where(eq(documentCrdtSnapshots.tenantId, tenantId));
  await testApp.db.delete(documentVersions).where(eq(documentVersions.tenantId, tenantId));
  await testApp.db.delete(searchItems).where(eq(searchItems.tenantId, tenantId));
  await testApp.db.delete(documents).where(eq(documents.tenantId, tenantId));
  await testApp.db.delete(moduleRecords).where(eq(moduleRecords.tenantId, tenantId));
  await testApp.db.delete(projectModuleFields).where(eq(projectModuleFields.tenantId, tenantId));
  await testApp.db.delete(projectModules).where(eq(projectModules.tenantId, tenantId));
  await testApp.db.delete(projectRecents).where(eq(projectRecents.tenantId, tenantId));
  await testApp.db.delete(projects).where(eq(projects.tenantId, tenantId));
}

async function request(path: string, init: RequestInit = {}, expectedStatuses = [200, 201]) {
  const response = await testApp.app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  expect(expectedStatuses).toContain(response.status);
  return { response, body };
}

function asRecord(value: unknown) {
  expect(value).toBeObject();
  return value as Record<string, unknown>;
}

function itemsOf(value: unknown) {
  const body = asRecord(value);
  expect(Array.isArray(body.items)).toBe(true);
  return body.items as Array<Record<string, unknown>>;
}

function stringOf(value: unknown) {
  expect(typeof value).toBe("string");
  return value as string;
}

async function seedTestIdentity() {
  const now = new Date();
  await testApp.db
    .insert(tenants)
    .values({
      id: tenantId,
      tenantId,
      name: "测试个人空间",
      kind: "personal",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: {
        name: "测试个人空间",
        updatedBy: userId,
        updatedAt: now,
      },
    });

  await testApp.db
    .insert(users)
    .values({
      id: userId,
      tenantId,
      email: "api-test@sharebrain.local",
      displayName: "API Test User",
      status: "active",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: "API Test User",
        status: "active",
        updatedBy: userId,
        updatedAt: now,
      },
    });

  await testApp.db
    .insert(tenantMemberships)
    .values({
      tenantId,
      userId,
      role: "admin",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [tenantMemberships.tenantId, tenantMemberships.userId],
      set: {
        role: "admin",
        updatedBy: userId,
        updatedAt: now,
      },
    });
}

async function seedTemplate() {
  const now = new Date();
  await testApp.db
    .insert(moduleTemplates)
    .values([
      {
        id: "00000000-0000-4000-9100-000000000001",
        tenantId,
        key: "test-log",
        name: "测试日志",
        kind: "timeline",
        description: "测试 timeline 模板",
        icon: "notebook-text",
        sortKey: "a0",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-9100-000000000002",
        tenantId,
        key: "test-docs",
        name: "测试文档",
        kind: "collection",
        description: "测试 collection 模板",
        icon: "book-open-text",
        sortKey: "b0",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
}

async function seedSystemTemplates() {
  const now = new Date();
  await testApp.db
    .insert(systemModuleTemplates)
    .values({
      id: "00000000-0000-4000-9900-000000000001",
      key: "system-test",
      name: "系统测试模块",
      kind: "timeline",
      description: "系统模板复制测试",
      icon: "boxes",
      sortKey: "z0",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemModuleTemplates.key,
      set: {
        name: "系统测试模块",
        updatedAt: now,
        deletedAt: null,
      },
    });

  await testApp.db
    .insert(systemModuleTemplateFields)
    .values({
      id: "00000000-0000-4000-9901-000000000001",
      templateId: "00000000-0000-4000-9900-000000000001",
      key: "image",
      label: "镜像",
      type: "text",
      required: false,
      defaultPolicy: "empty",
      options: [],
      sortKey: "a0",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [systemModuleTemplateFields.templateId, systemModuleTemplateFields.key],
      set: {
        label: "镜像",
        updatedAt: now,
        deletedAt: null,
      },
    });
}

beforeAll(async () => {
  await seedSystemTemplates();
  await seedTestIdentity();
  await resetTestWorkspace();
  await seedTemplate();
});

afterAll(async () => {
  await resetTestWorkspace();
  await testApp.close();
});

describe("platform API", () => {
  test("supports password registration, login, logout, and disabled registration", async () => {
    const email = `auth-${Date.now()}@sharebrain.local`;
    const password = "sharebrain123";
    const registerResponse = await testApp.app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName: "Auth Test" }),
    });
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("set-cookie")).toContain(testApp.env.AUTH_SESSION_COOKIE_NAME);
    const registerBody = asRecord(await registerResponse.json());
    const registeredTenantId = stringOf(asRecord(registerBody.tenant).id);
    const registeredUserId = stringOf(asRecord(registerBody.user).id);
    const registeredTemplates = await testApp.db
      .select()
      .from(moduleTemplates)
      .where(eq(moduleTemplates.tenantId, registeredTenantId));
    expect(registeredTemplates.some((template) => template.key === "system-test")).toBe(true);

    const logoutResponse = await testApp.app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: registerResponse.headers.get("set-cookie") ?? "",
      },
    });
    expect(logoutResponse.status).toBe(200);

    const loginResponse = await testApp.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain(testApp.env.AUTH_SESSION_COOKIE_NAME);

    const disabledApp = createTestApp({
      ...testRuntimeEnv,
      AUTH_PASSWORD_REGISTRATION_ENABLED: "false",
      AUTH_DEV_BYPASS_ENABLED: "false",
    });
    const unauthenticated = await disabledApp.app.request("/api/me");
    expect(unauthenticated.status).toBe(401);

    const disabledRegister = await disabledApp.app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `disabled-${Date.now()}@sharebrain.local`,
        password,
        displayName: "Disabled",
      }),
    });
    expect(disabledRegister.status).toBe(403);
    await disabledApp.close();

    await testApp.db.delete(moduleTemplateFields).where(eq(moduleTemplateFields.tenantId, registeredTenantId));
    await testApp.db.delete(moduleTemplates).where(eq(moduleTemplates.tenantId, registeredTenantId));
    await testApp.db.delete(authSessions).where(eq(authSessions.userId, registeredUserId));
    await testApp.db.delete(authAccounts).where(eq(authAccounts.userId, registeredUserId));
    await testApp.db.delete(tenantMemberships).where(eq(tenantMemberships.userId, registeredUserId));
    await testApp.db.delete(users).where(eq(users.id, registeredUserId));
    await testApp.db.delete(tenants).where(eq(tenants.id, registeredTenantId));
  });

  test("runs the personal workspace project/module/document/search/media path", async () => {
    const me = asRecord((await request("/api/me")).body);
    expect(asRecord(me.user).id).toBe(userId);
    expect(asRecord(me.tenant).id).toBe(tenantId);

    const projectA = asRecord(
      (
        await request("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: `API Test A ${Date.now()}` }),
        })
      ).body,
    );
    const projectB = asRecord(
      (
        await request("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: `API Test B ${Date.now()}` }),
        })
      ).body,
    );

    await request(`/api/projects/${String(projectA.id)}`);
    const recents = itemsOf((await request("/api/me/recents")).body);
    expect(recents.some((item) => item.id === projectA.id)).toBe(true);

    const modulesA = itemsOf((await request(`/api/projects/${String(projectA.id)}/modules`)).body);
    const modulesB = itemsOf((await request(`/api/projects/${String(projectB.id)}/modules`)).body);
    expect(modulesA).toHaveLength(2);
    expect(modulesB).toHaveLength(2);

    const templateBeforeCreate = itemsOf((await request("/api/module-templates")).body);
    expect(templateBeforeCreate).toHaveLength(2);
    const customTemplate = asRecord(
      (
        await request("/api/module-templates", {
          method: "POST",
          body: JSON.stringify({
            key: `custom-${Date.now()}`,
            name: "自定义默认模块",
            kind: "collection",
          }),
        })
      ).body,
    );
    expect(customTemplate.name).toBe("自定义默认模块");
    await request(`/api/module-templates/${String(customTemplate.id)}`, { method: "DELETE" });
    const templateAfterDelete = itemsOf((await request("/api/module-templates")).body);
    expect(templateAfterDelete.some((template) => template.id === customTemplate.id)).toBe(false);

    const timelineModule = modulesA.find((item) => item.kind === "timeline");
    const collectionModule = modulesA.find((item) => item.kind === "collection");
    expect(timelineModule).toBeDefined();
    expect(collectionModule).toBeDefined();

    const field = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "image",
            label: "镜像",
            type: "text",
            required: true,
            defaultPolicy: "empty",
            options: [],
          }),
        })
      ).body,
    );
    const record = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/records`, {
          method: "POST",
          body: JSON.stringify({
            title: "API Test timeline record",
            values: { [String(field.id)]: "registry.example/api-test:1.0.0" },
          }),
        })
      ).body,
    );
    const fieldId = stringOf(field.id);
    expect(Object.keys(asRecord(record.values))).toEqual([fieldId]);

    const invalidRecord = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/records`,
          {
            method: "POST",
            body: JSON.stringify({
              title: "Invalid record",
              values: {},
            }),
          },
          [422],
        )
      ).body,
    );
    expect(invalidRecord.code).toBe("FIELD_VALUE_INVALID");

    const document = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/documents`, {
          method: "POST",
          body: JSON.stringify({
            title: "API Test document",
            moduleId: collectionModule?.id,
          }),
        })
      ).body,
    );
    const recordDocument = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/documents`, {
          method: "POST",
          body: JSON.stringify({
            title: "API Test record document",
            moduleId: timelineModule?.id,
            moduleRecordId: record.id,
          }),
        })
      ).body,
    );
    expect(recordDocument.moduleRecordId).toBe(record.id);

    const crossProjectDocument = asRecord(
      (
        await request(
          `/api/projects/${String(projectB.id)}/documents`,
          {
            method: "POST",
            body: JSON.stringify({
              title: "Invalid cross-project document",
              moduleId: collectionModule?.id,
            }),
          },
          [404],
        )
      ).body,
    );
    expect(crossProjectDocument.code).toBe("MODULE_NOT_FOUND");

    const updatedDocument = asRecord(
      (
        await request(`/api/documents/${String(document.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: "API Test document updated",
            plateJson: [{ type: "p", children: [{ text: "api test searchable text" }] }],
            markdown: "api test searchable text",
            plainText: "api test searchable text",
          }),
        })
      ).body,
    );
    expect(updatedDocument.currentVersion).toBe(2);

    const documentSearch = itemsOf((await request("/api/search?q=api%20test%20searchable")).body);
    expect(documentSearch.some((item) => item.entityType === "document" && item.entityId === document.id)).toBe(true);
    const recordSearch = itemsOf((await request("/api/search?q=registry.example")).body);
    expect(recordSearch.some((item) => item.entityType === "module_record" && item.entityId === record.id)).toBe(true);

    const upload = asRecord(
      (
        await request("/api/media/uploads", {
          method: "POST",
          body: JSON.stringify({
            fileName: "avatar.png",
            mimeType: "image/png",
            byteSize: 128,
            usageKind: "avatar",
          }),
        })
      ).body,
    );
    expect(Object.keys(asRecord(upload.fields)).length).toBeGreaterThan(0);

    const completeWithoutObject = asRecord(
      (
        await request(
          `/api/media/uploads/${String(upload.uploadId)}/complete`,
          {
            method: "POST",
            body: JSON.stringify({
              byteSize: 128,
              mimeType: "image/png",
            }),
          },
          [422],
        )
      ).body,
    );
    expect(completeWithoutObject.code).toBe("MEDIA_OBJECT_UNAVAILABLE");
  });
});
