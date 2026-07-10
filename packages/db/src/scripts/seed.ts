import "@sharebrain/config/dotenv";

import { loadServerEnv } from "@sharebrain/config";
import { and, eq, isNull } from "drizzle-orm";

import { createDatabaseClient } from "../client";
import {
  authAccounts,
  moduleTemplateFields,
  moduleTemplates,
  projectModuleFields,
  projectModules,
  projects,
  tenantMemberships,
  tenants,
  users,
} from "../schema";
import { copySystemModuleTemplatesToTenant, seedSystemModuleTemplates } from "../module-template-service";

const env = loadServerEnv(process.env);
const db = createDatabaseClient(env.DATABASE_URL);

const devUserId = env.DEV_AUTH_USER_ID;
const devTenantId = env.DEV_AUTH_TENANT_ID;
const now = new Date();

async function seed() {
  await db
    .insert(tenants)
    .values({
      id: devTenantId,
      tenantId: devTenantId,
      name: "个人空间",
      kind: "personal",
      createdBy: devUserId,
      updatedBy: devUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: {
        name: "个人空间",
        kind: "personal",
        updatedBy: devUserId,
        updatedAt: now,
      },
    });

  await db
    .insert(users)
    .values({
      id: devUserId,
      tenantId: devTenantId,
      email: "dev@sharebrain.local",
      displayName: "Dev User",
      status: "active",
      createdBy: devUserId,
      updatedBy: devUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: "dev@sharebrain.local",
        displayName: "Dev User",
        status: "active",
        updatedBy: devUserId,
        updatedAt: now,
      },
    });

  await db
    .insert(tenantMemberships)
    .values({
      id: "00000000-0000-4000-8300-000000000001",
      tenantId: devTenantId,
      userId: devUserId,
      role: env.DEV_AUTH_ROLE,
      createdBy: devUserId,
      updatedBy: devUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [tenantMemberships.tenantId, tenantMemberships.userId],
      set: {
        role: env.DEV_AUTH_ROLE,
        updatedBy: devUserId,
        updatedAt: now,
      },
    });

  const devPasswordHash = await Bun.password.hash("sharebrain123", {
    algorithm: "argon2id",
  });

  await db
    .insert(authAccounts)
    .values({
      id: "00000000-0000-4000-8500-000000000001",
      tenantId: devTenantId,
      userId: devUserId,
      provider: "password",
      providerAccountId: "dev@sharebrain.local",
      passwordHash: devPasswordHash,
      status: "active",
      createdBy: devUserId,
      updatedBy: devUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [authAccounts.provider, authAccounts.providerAccountId],
      set: {
        tenantId: devTenantId,
        userId: devUserId,
        passwordHash: devPasswordHash,
        status: "active",
        updatedBy: devUserId,
        updatedAt: now,
      },
    });

  await seedSystemModuleTemplates(db);
  await copySystemModuleTemplatesToTenant(db, devTenantId, devUserId);

  const existingProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, devTenantId))
    .limit(1);

  if (existingProjects.length === 0) {
    const projectId = "00000000-0000-4000-8400-000000000001";
    await db.insert(projects).values({
      id: projectId,
      tenantId: devTenantId,
      name: "私有化项目示例",
      status: "active",
      ownerId: devUserId,
      description: "用于开发期验证个人项目、模块、记录和文档流程。",
      tags: ["dev"],
      createdBy: devUserId,
      updatedBy: devUserId,
      createdAt: now,
      updatedAt: now,
    });

    const tenantTemplates = await db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, devTenantId), isNull(moduleTemplates.deletedAt)))
      .orderBy(moduleTemplates.sortKey);

    for (const template of tenantTemplates) {
      const moduleId = crypto.randomUUID();
      await db.insert(projectModules).values({
        id: moduleId,
        tenantId: devTenantId,
        projectId,
        sourceTemplateId: template.id,
        key: template.key,
        name: template.name,
        kind: template.kind,
        description: template.description,
        icon: template.icon,
        sortKey: template.sortKey,
        createdBy: devUserId,
        updatedBy: devUserId,
        createdAt: now,
        updatedAt: now,
      });

      const fields = await db
        .select()
        .from(moduleTemplateFields)
        .where(and(eq(moduleTemplateFields.templateId, template.id), isNull(moduleTemplateFields.deletedAt)))
        .orderBy(moduleTemplateFields.sortKey);

      for (const field of fields) {
        await db.insert(projectModuleFields).values({
          tenantId: devTenantId,
          moduleId,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          defaultPolicy: field.defaultPolicy,
          defaultValue: field.defaultValue,
          options: field.options,
          sortKey: field.sortKey,
          createdBy: devUserId,
          updatedBy: devUserId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  console.info("ShareBrain dev seed 已完成。");
}

try {
  await seed();
} finally {
  await db.$client.end({ timeout: 1 });
}
