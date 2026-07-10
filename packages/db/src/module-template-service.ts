import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

import { moduleTemplateSeeds } from "./module-template-seeds";
import {
  moduleTemplateFields,
  moduleTemplates,
  systemModuleTemplateFields,
  systemModuleTemplates,
} from "./schema";

import type { DatabaseClient } from "./client";

export async function seedSystemModuleTemplates(db: DatabaseClient) {
  const now = new Date();
  const seedKeys = moduleTemplateSeeds.map((template) => template.key);
  const staleTemplates = await db
    .select({ id: systemModuleTemplates.id })
    .from(systemModuleTemplates)
    .where(and(notInArray(systemModuleTemplates.key, seedKeys), isNull(systemModuleTemplates.deletedAt)));
  const staleTemplateIds = staleTemplates.map((template) => template.id);

  if (staleTemplateIds.length > 0) {
    await db
      .update(systemModuleTemplateFields)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(systemModuleTemplateFields.templateId, staleTemplateIds),
          isNull(systemModuleTemplateFields.deletedAt),
        ),
      );
  }

  await db
    .update(systemModuleTemplates)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(notInArray(systemModuleTemplates.key, seedKeys));

  for (const template of moduleTemplateSeeds) {
    await db
      .insert(systemModuleTemplates)
      .values({
        id: template.id,
        key: template.key,
        name: template.name,
        kind: template.kind,
        description: template.description,
        icon: template.icon,
        sortKey: template.sortKey,
        metadata: template.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemModuleTemplates.key,
        set: {
          name: template.name,
          kind: template.kind,
          description: template.description,
          icon: template.icon,
          sortKey: template.sortKey,
          metadata: template.metadata,
          updatedAt: now,
          deletedAt: null,
        },
      });

    for (const field of template.fields) {
      await db
        .insert(systemModuleTemplateFields)
        .values({
          id: field.id,
          templateId: template.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          defaultPolicy: field.defaultPolicy,
          defaultValue: field.defaultValue,
          options: field.options,
          sortKey: field.sortKey,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [systemModuleTemplateFields.templateId, systemModuleTemplateFields.key],
          set: {
            label: field.label,
            type: field.type,
            required: field.required,
            defaultPolicy: field.defaultPolicy,
            defaultValue: field.defaultValue,
            options: field.options,
            sortKey: field.sortKey,
            updatedAt: now,
            deletedAt: null,
          },
        });
    }

    const fieldKeys = template.fields.map((field) => field.key);
    const fieldCleanupWhere =
      fieldKeys.length > 0
        ? and(
            eq(systemModuleTemplateFields.templateId, template.id),
            notInArray(systemModuleTemplateFields.key, fieldKeys),
            isNull(systemModuleTemplateFields.deletedAt),
          )
        : and(
            eq(systemModuleTemplateFields.templateId, template.id),
            isNull(systemModuleTemplateFields.deletedAt),
          );
    await db
      .update(systemModuleTemplateFields)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(fieldCleanupWhere);
  }
}

export async function copySystemModuleTemplatesToTenant(
  db: DatabaseClient,
  tenantId: string,
  actorId: string,
) {
  const now = new Date();
  const templates = await db
    .select()
    .from(systemModuleTemplates)
    .where(isNull(systemModuleTemplates.deletedAt))
    .orderBy(systemModuleTemplates.sortKey);
  const activeSystemTemplateIds = templates.map((template) => template.id);

  if (activeSystemTemplateIds.length > 0) {
    const staleTenantTemplates = await db
      .select({ id: moduleTemplates.id })
      .from(moduleTemplates)
      .where(
        and(
          eq(moduleTemplates.tenantId, tenantId),
          notInArray(moduleTemplates.sourceSystemTemplateId, activeSystemTemplateIds),
          isNull(moduleTemplates.deletedAt),
        ),
      );
    const staleTenantTemplateIds = staleTenantTemplates.map((template) => template.id);

    if (staleTenantTemplateIds.length > 0) {
      await db
        .update(moduleTemplateFields)
        .set({
          deletedAt: now,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(
          and(
            eq(moduleTemplateFields.tenantId, tenantId),
            inArray(moduleTemplateFields.templateId, staleTenantTemplateIds),
            isNull(moduleTemplateFields.deletedAt),
          ),
        );
    }

    await db
      .update(moduleTemplates)
      .set({
        deletedAt: now,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(
        and(
          eq(moduleTemplates.tenantId, tenantId),
          notInArray(moduleTemplates.sourceSystemTemplateId, activeSystemTemplateIds),
          isNull(moduleTemplates.deletedAt),
        ),
      );
  }

  for (const template of templates) {
    const [existingTenantTemplate] = await db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, tenantId), eq(moduleTemplates.key, template.key)))
      .limit(1);
    const shouldRestoreTenantTemplate =
      existingTenantTemplate &&
      (existingTenantTemplate.deletedAt !== null ||
        existingTenantTemplate.sourceSystemTemplateId !== template.id);

    if (shouldRestoreTenantTemplate) {
      await db
        .update(moduleTemplates)
        .set({
          sourceSystemTemplateId: template.id,
          name: template.name,
          kind: template.kind,
          description: template.description,
          icon: template.icon,
          sortKey: template.sortKey,
          deletedAt: null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(and(eq(moduleTemplates.id, existingTenantTemplate.id), eq(moduleTemplates.tenantId, tenantId)));
    }

    if (!existingTenantTemplate) {
      await db.insert(moduleTemplates).values({
        id: crypto.randomUUID(),
        tenantId,
        sourceSystemTemplateId: template.id,
        key: template.key,
        name: template.name,
        kind: template.kind,
        description: template.description,
        icon: template.icon,
        sortKey: template.sortKey,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [tenantTemplate] = await db
      .select({ id: moduleTemplates.id })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, tenantId), eq(moduleTemplates.key, template.key), isNull(moduleTemplates.deletedAt)))
      .limit(1);

    if (!tenantTemplate) {
      continue;
    }

    const fields = await db
      .select()
      .from(systemModuleTemplateFields)
      .where(and(eq(systemModuleTemplateFields.templateId, template.id), isNull(systemModuleTemplateFields.deletedAt)))
      .orderBy(systemModuleTemplateFields.sortKey);

    for (const field of fields) {
      await db
        .insert(moduleTemplateFields)
        .values({
          id: crypto.randomUUID(),
          tenantId,
          templateId: tenantTemplate.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          defaultPolicy: field.defaultPolicy,
          defaultValue: field.defaultValue,
          options: field.options,
          sortKey: field.sortKey,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [moduleTemplateFields.templateId, moduleTemplateFields.key],
        });
    }
  }
}
