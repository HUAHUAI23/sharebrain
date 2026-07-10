import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

import { copySystemModuleTemplatesToTenant, seedSystemModuleTemplates } from "@sharebrain/db";
import { createTestApp } from "../test/test-app";
import { MediaService } from "./media/media.service";

import {
  authAccounts,
  authSessions,
  auditLogs,
  documentBlocks,
  documentChunks,
  documentCrdtSnapshots,
  documentDiscussionReadStates,
  documentReviewStates,
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
  await testApp.db.delete(documentDiscussionReadStates).where(eq(documentDiscussionReadStates.tenantId, tenantId));
  await testApp.db.delete(documentReviewStates).where(eq(documentReviewStates.tenantId, tenantId));
  await testApp.db.delete(documentCrdtSnapshots).where(eq(documentCrdtSnapshots.tenantId, tenantId));
  await testApp.db.delete(documentVersions).where(eq(documentVersions.tenantId, tenantId));
  await testApp.db.delete(searchItems).where(eq(searchItems.tenantId, tenantId));
  await testApp.db.delete(documents).where(eq(documents.tenantId, tenantId));
  await testApp.db.delete(moduleRecords).where(eq(moduleRecords.tenantId, tenantId));
  await testApp.db.delete(projectModuleFields).where(eq(projectModuleFields.tenantId, tenantId));
  await testApp.db.delete(projectModules).where(eq(projectModules.tenantId, tenantId));
  await testApp.db.delete(projectRecents).where(eq(projectRecents.tenantId, tenantId));
  await testApp.db.delete(projects).where(eq(projects.tenantId, tenantId));
  await testApp.db.delete(moduleTemplateFields).where(eq(moduleTemplateFields.tenantId, tenantId));
  await testApp.db.delete(moduleTemplates).where(eq(moduleTemplates.tenantId, tenantId));
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
        id: "00000000-0000-4000-9100-000000000000",
        tenantId,
        sourceSystemTemplateId: "00000000-0000-4000-8300-000000000001",
        key: "logs",
        name: "日志",
        kind: "timeline",
        description: "按时间线记录项目日志、变更、问题和关键事件。",
        icon: "list-tree",
        sortKey: "a0",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-9100-000000000001",
        tenantId,
        sourceSystemTemplateId: "00000000-0000-4000-8300-000000000002",
        key: "project-background",
        name: "项目背景",
        kind: "collection",
        description: "沉淀项目目标、背景资料、范围约束和关键上下文。",
        icon: "file-text",
        sortKey: "b0",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "00000000-0000-4000-9100-000000000002",
        tenantId,
        sourceSystemTemplateId: "00000000-0000-4000-8300-000000000003",
        key: "knowledge-base",
        name: "知识库",
        kind: "collection",
        description: "组织长期复用的项目知识、操作手册和排障文档。",
        icon: "book-open-text",
        sortKey: "c0",
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
}

beforeAll(async () => {
  await seedSystemModuleTemplates(testApp.db);
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
    expect(registeredTemplates.map((template) => template.key)).toEqual(expect.arrayContaining(["logs", "project-background", "knowledge-base"]));
    expect(registeredTemplates.find((template) => template.key === "logs")?.name).toBe("日志");

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
    expect(modulesA).toHaveLength(3);
    expect(modulesB).toHaveLength(3);
    expect(modulesA.some((module) => module.isSystemFixed === true)).toBe(true);

    let templateBeforeCreate = itemsOf((await request("/api/module-templates")).body);
    expect(templateBeforeCreate).toHaveLength(3);
    let fixedTemplate = templateBeforeCreate.find((template) => template.isSystemFixed === true);
    expect(fixedTemplate).toBeDefined();
    const fixedTemplateId = String(fixedTemplate?.id);
    await testApp.db
      .update(moduleTemplates)
      .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(eq(moduleTemplates.id, fixedTemplateId));
    await copySystemModuleTemplatesToTenant(testApp.db, tenantId, userId);
    templateBeforeCreate = itemsOf((await request("/api/module-templates")).body);
    fixedTemplate = templateBeforeCreate.find((template) => template.id === fixedTemplateId);
    expect(fixedTemplate?.isSystemFixed).toBe(true);
    const lockedTemplateDelete = asRecord(
      (
        await request(
          `/api/module-templates/${String(fixedTemplate?.id)}`,
          { method: "DELETE" },
          [422],
        )
      ).body,
    );
    expect(lockedTemplateDelete.code).toBe("MODULE_TEMPLATE_LOCKED");
    const forbiddenTemplateCreate = asRecord(
      (
        await request(
          "/api/module-templates",
          {
            method: "POST",
            headers: { "x-dev-role": "viewer" },
            body: JSON.stringify({
              key: `viewer-${Date.now()}`,
              name: "Viewer template",
              kind: "timeline",
            }),
          },
          [403],
        )
      ).body,
    );
    expect(forbiddenTemplateCreate.code).toBe("FORBIDDEN");
    const templateField = asRecord(
      (
        await request(`/api/module-templates/${String(fixedTemplate?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "status",
            label: "状态",
            type: "select",
            required: false,
            defaultPolicy: "fixed",
            defaultValue: "todo",
            options: [{ id: "todo", label: "待处理" }],
          }),
        })
      ).body,
    );
    expect(templateField.key).toBe("status");
    const templateFieldConflictSource = asRecord(
      (
        await request(`/api/module-templates/${String(fixedTemplate?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "priority",
            label: "优先级",
            type: "text",
            required: false,
            defaultPolicy: "empty",
            options: [],
          }),
        })
      ).body,
    );
    const templateFieldKeyConflict = asRecord(
      (
        await request(
          `/api/module-templates/${String(fixedTemplate?.id)}/fields`,
          {
            method: "POST",
            body: JSON.stringify({
              id: templateFieldConflictSource.id,
              key: "status",
              label: "状态冲突",
              type: "text",
              required: false,
              defaultPolicy: "empty",
              options: [],
            }),
          },
          [409],
        )
      ).body,
    );
    expect(templateFieldKeyConflict.code).toBe("FIELD_KEY_EXISTS");
    const deletedTemplateField = asRecord(
      (
        await request(`/api/module-templates/${String(fixedTemplate?.id)}/fields/${String(templateField.id)}`, {
          method: "DELETE",
        })
      ).body,
    );
    expect(deletedTemplateField.id).toBe(templateField.id);
    const restoredTemplateField = asRecord(
      (
        await request(`/api/module-templates/${String(fixedTemplate?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "status",
            label: "状态",
            type: "select",
            required: false,
            defaultPolicy: "fixed",
            defaultValue: "todo",
            options: [{ id: "todo", label: "待处理" }],
          }),
        })
      ).body,
    );
    expect(restoredTemplateField.id).toBe(templateField.id);
    const collectionTemplate = templateBeforeCreate.find((template) => template.kind === "collection");
    const invalidTemplateField = asRecord(
      (
        await request(
          `/api/module-templates/${String(collectionTemplate?.id)}/fields`,
          {
            method: "POST",
            body: JSON.stringify({
              key: "owner",
              label: "负责人",
              type: "text",
              options: [],
            }),
          },
          [422],
        )
      ).body,
    );
    expect(invalidTemplateField.code).toBe("MODULE_KIND_INVALID");
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
    const duplicatedTemplate = asRecord(
      (
        await request(
          "/api/module-templates",
          {
            method: "POST",
            body: JSON.stringify({
              key: customTemplate.key,
              name: "重复默认模块",
              kind: "collection",
            }),
          },
          [409],
        )
      ).body,
    );
    expect(duplicatedTemplate.code).toBe("MODULE_TEMPLATE_KEY_EXISTS");
    const anotherCustomTemplate = asRecord(
      (
        await request("/api/module-templates", {
          method: "POST",
          body: JSON.stringify({
            key: `custom-other-${Date.now()}`,
            name: "另一个默认模块",
            kind: "timeline",
          }),
        })
      ).body,
    );
    const templateKeyConflict = asRecord(
      (
        await request(
          `/api/module-templates/${String(anotherCustomTemplate.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ key: customTemplate.key }),
          },
          [409],
        )
      ).body,
    );
    expect(templateKeyConflict.code).toBe("MODULE_TEMPLATE_KEY_EXISTS");
    await request(`/api/module-templates/${String(anotherCustomTemplate.id)}`, { method: "DELETE" });
    const immutableTemplateKind = asRecord(
      (
        await request(
          `/api/module-templates/${String(customTemplate.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ kind: "timeline" }),
          },
          [422],
        )
      ).body,
    );
    expect(immutableTemplateKind.code).toBe("VALIDATION_FAILED");
    await request(`/api/module-templates/${String(customTemplate.id)}`, { method: "DELETE" });
    const restoredCustomTemplate = asRecord(
      (
        await request("/api/module-templates", {
          method: "POST",
          body: JSON.stringify({
            key: customTemplate.key,
            name: "恢复默认模块",
            kind: "collection",
          }),
        })
      ).body,
    );
    expect(restoredCustomTemplate.id).toBe(customTemplate.id);
    await request(`/api/module-templates/${String(restoredCustomTemplate.id)}`, { method: "DELETE" });
    const templateAfterDelete = itemsOf((await request("/api/module-templates")).body);
    expect(templateAfterDelete.some((template) => template.id === customTemplate.id)).toBe(false);

    const timelineModule = modulesA.find((item) => item.kind === "timeline");
    const collectionModule = modulesA.find((item) => item.kind === "collection");
    const fixedModule = modulesA.find((item) => item.isSystemFixed === true);
    expect(timelineModule).toBeDefined();
    expect(collectionModule).toBeDefined();
    expect(fixedModule).toBeDefined();

    const lockedModuleDelete = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(fixedModule?.id)}`,
          { method: "DELETE" },
          [422],
        )
      ).body,
    );
    expect(lockedModuleDelete.code).toBe("MODULE_LOCKED");
    const immutableModuleKind = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ kind: "collection" }),
          },
          [422],
        )
      ).body,
    );
    expect(immutableModuleKind.code).toBe("VALIDATION_FAILED");
    const customModule = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules`, {
          method: "POST",
          body: JSON.stringify({
            key: `project-custom-${Date.now()}`,
            name: "项目自定义模块",
            kind: "collection",
          }),
        })
      ).body,
    );
    const duplicatedModule = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules`,
          {
            method: "POST",
            body: JSON.stringify({
              key: customModule.key,
              name: "重复项目模块",
              kind: "collection",
            }),
          },
          [409],
        )
      ).body,
    );
    expect(duplicatedModule.code).toBe("MODULE_KEY_EXISTS");
    const anotherCustomModule = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules`, {
          method: "POST",
          body: JSON.stringify({
            key: `project-custom-other-${Date.now()}`,
            name: "另一个项目模块",
            kind: "timeline",
          }),
        })
      ).body,
    );
    const moduleKeyConflict = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(anotherCustomModule.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ key: customModule.key }),
          },
          [409],
        )
      ).body,
    );
    expect(moduleKeyConflict.code).toBe("MODULE_KEY_EXISTS");
    await request(`/api/projects/${String(projectA.id)}/modules/${String(anotherCustomModule.id)}`, { method: "DELETE" });
    await request(`/api/projects/${String(projectA.id)}/modules/${String(customModule.id)}`, { method: "DELETE" });
    const restoredCustomModule = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules`, {
          method: "POST",
          body: JSON.stringify({
            key: customModule.key,
            name: "恢复项目模块",
            kind: "collection",
          }),
        })
      ).body,
    );
    expect(restoredCustomModule.id).toBe(customModule.id);
    await request(`/api/projects/${String(projectA.id)}/modules/${String(restoredCustomModule.id)}`, { method: "DELETE" });

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
    const updatedField = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            id: field.id,
            key: "image",
            label: "镜像地址",
            type: "text",
            required: true,
            defaultPolicy: "empty",
            options: [],
          }),
        })
      ).body,
    );
    expect(updatedField.sortKey).toBe(field.sortKey);
    const selectField = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "record-status",
            label: "记录状态",
            type: "select",
            required: false,
            defaultPolicy: "empty",
            options: [{ id: "todo", label: "待处理" }, { id: "done", label: "已完成" }],
          }),
        })
      ).body,
    );
    const fieldKeyConflict = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields`,
          {
            method: "POST",
            body: JSON.stringify({
              id: selectField.id,
              key: "image",
              label: "冲突字段",
              type: "select",
              required: false,
              defaultPolicy: "empty",
              options: [{ id: "todo", label: "待处理" }, { id: "done", label: "已完成" }],
            }),
          },
          [409],
        )
      ).body,
    );
    expect(fieldKeyConflict.code).toBe("FIELD_KEY_EXISTS");
    const booleanField = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            key: "confirmed",
            label: "已确认",
            type: "boolean",
            required: false,
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
            values: {
              [String(field.id)]: "registry.example/api-test:1.0.0",
              [String(selectField.id)]: "todo",
              [String(booleanField.id)]: false,
            },
          }),
        })
      ).body,
    );
    const fieldId = stringOf(field.id);
    expect(asRecord(record.values)[fieldId]).toBe("registry.example/api-test:1.0.0");
    expect(asRecord(record.values)[String(selectField.id)]).toBe("todo");
    expect(asRecord(record.values)[String(booleanField.id)]).toBe(false);

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
    const invalidRequiredTextRecord = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/records`,
          {
            method: "POST",
            body: JSON.stringify({
              title: "Invalid required text",
              values: { [String(field.id)]: "" },
            }),
          },
          [422],
        )
      ).body,
    );
    expect(invalidRequiredTextRecord.code).toBe("FIELD_VALUE_INVALID");

    const invalidCollectionField = asRecord(
      (
        await request(
          `/api/projects/${String(projectA.id)}/modules/${String(collectionModule?.id)}/fields`,
          {
            method: "POST",
            body: JSON.stringify({
              key: "category",
              label: "分类",
              type: "text",
              options: [],
            }),
          },
          [422],
        )
      ).body,
    );
    expect(invalidCollectionField.code).toBe("MODULE_KIND_INVALID");
    const crossProjectField = asRecord(
      (
        await request(
          `/api/projects/${String(projectB.id)}/modules/${String(timelineModule?.id)}/fields`,
          {
            method: "POST",
            body: JSON.stringify({
              key: "cross",
              label: "Cross project",
              type: "text",
              options: [],
            }),
          },
          [404],
        )
      ).body,
    );
    expect(crossProjectField.code).toBe("MODULE_PROJECT_MISMATCH");
    const deletedField = asRecord(
      (
        await request(`/api/projects/${String(projectA.id)}/modules/${String(timelineModule?.id)}/fields/${String(booleanField.id)}`, {
          method: "DELETE",
        })
      ).body,
    );
    expect(deletedField.id).toBe(booleanField.id);

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

    const mediaService = new MediaService(testApp.db, testApp.env, {
      createPostPolicy: async () => ({
        url: "https://storage.test/upload",
        fields: { "Content-Type": "image/png" },
      }),
      createReadUrl: async (key) => `https://storage.test/${key}`,
      headObject: async () => ({ ContentLength: 64, ContentType: "image/png" }) as never,
    });
    const auth = {
      userId,
      tenantId,
      role: "admin" as const,
      requestId: "media-usage-test",
    };
    const inlineUpload = await mediaService.createUpload(auth, {
      fileName: "inline.png",
      mimeType: "image/png",
      byteSize: 64,
      usageKind: "inline",
    });
    const completeInlineWithoutUsage = await mediaService
      .completeUpload(auth, inlineUpload.uploadId, {
        byteSize: 64,
        mimeType: "image/png",
      })
      .catch((error: unknown) => error);
    expect(completeInlineWithoutUsage).toMatchObject({ code: "MEDIA_USAGE_REQUIRED" });
    await mediaService.completeUpload(auth, inlineUpload.uploadId, {
      byteSize: 64,
      mimeType: "image/png",
      usage: {
        resourceType: "document",
        resourceId: String(document.id),
        usageKind: "inline",
      },
    });
    const [activeUsageAfterComplete] = await testApp.db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.mediaId, inlineUpload.mediaId),
          eq(mediaUsages.resourceType, "document"),
          eq(mediaUsages.resourceId, String(document.id)),
          eq(mediaUsages.usageKind, "inline"),
          isNull(mediaUsages.deletedAt),
        ),
      )
      .limit(1);
    expect(activeUsageAfterComplete).toBeDefined();

    await request(`/api/documents/${String(document.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        plateJson: [
          {
            type: "img",
            sourceKey: inlineUpload.mediaId,
            url: `/api/media/${inlineUpload.mediaId}/raw`,
            children: [{ text: "" }],
          },
        ],
        markdown: "",
        plainText: "",
      }),
    });
    const [activeUsageAfterMaterialize] = await testApp.db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.mediaId, inlineUpload.mediaId),
          eq(mediaUsages.resourceType, "document"),
          eq(mediaUsages.resourceId, String(document.id)),
          eq(mediaUsages.usageKind, "inline"),
          isNull(mediaUsages.deletedAt),
        ),
      )
      .limit(1);
    expect(activeUsageAfterMaterialize).toBeDefined();

    await request(`/api/documents/${String(document.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        plateJson: [{ type: "p", children: [{ text: "api test searchable text without media" }] }],
        markdown: "api test searchable text without media",
        plainText: "api test searchable text without media",
      }),
    });
    const [removedUsage] = await testApp.db
      .select()
      .from(mediaUsages)
      .where(
        and(
          eq(mediaUsages.mediaId, inlineUpload.mediaId),
          eq(mediaUsages.resourceType, "document"),
          eq(mediaUsages.resourceId, String(document.id)),
          eq(mediaUsages.usageKind, "inline"),
        ),
      )
      .limit(1);
    expect(removedUsage?.deletedAt).toBeInstanceOf(Date);

    const now = new Date().toISOString();
    await testApp.db.insert(documentReviewStates).values({
      tenantId,
      documentId: String(document.id),
      discussions: [
        {
          id: "discussion-api-test",
          comments: [
            {
              id: "comment-api-test",
              contentRich: [{ type: "p", children: [{ text: "review state is persisted" }] }],
              createdAt: now,
              discussionId: "discussion-api-test",
              isEdited: false,
              updatedAt: now,
              userId,
            },
          ],
          createdAt: now,
          documentContent: "api test searchable text",
          isResolved: false,
          updatedAt: now,
          userId,
        },
      ],
      updatedBy: userId,
    });
    const discussions = asRecord((await request(`/api/documents/${String(document.id)}/discussions`)).body);
    expect(Array.isArray(discussions.discussions)).toBe(true);
    expect(Array.isArray(discussions.readStates)).toBe(true);
    expect((discussions.discussions as Array<Record<string, unknown>>)[0]?.id).toBe("discussion-api-test");
    const readStateResponse = asRecord(
      (
        await request(`/api/documents/${String(document.id)}/discussions/read`, {
          method: "POST",
          body: JSON.stringify({
            items: [{ discussionId: "discussion-api-test", activityKey: "activity-1" }],
          }),
        })
      ).body,
    );
    expect((readStateResponse.readStates as Array<Record<string, unknown>>)[0]?.activityKey).toBe("activity-1");

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
  }, 15_000);
});
