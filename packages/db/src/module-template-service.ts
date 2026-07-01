import { and, eq, isNull } from "drizzle-orm";

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

  for (const template of templates) {
    await db
      .insert(moduleTemplates)
      .values({
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
      })
      .onConflictDoNothing({
        target: [moduleTemplates.tenantId, moduleTemplates.key],
      });

    const [tenantTemplate] = await db
      .select({ id: moduleTemplates.id })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, tenantId), eq(moduleTemplates.key, template.key)))
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
