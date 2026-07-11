// 管理空间级新项目初始模块、模板字段、排序与系统默认恢复。
import {
  createModuleTemplateRequestSchema,
  reorderRequestSchema,
  updateModuleTemplateRequestSchema,
  upsertModuleFieldRequestSchema,
  type AuthContext,
  type ModuleTemplate,
} from "@sharebrain/contracts";
import {
  moduleTemplateFields,
  moduleTemplates,
  systemModuleTemplateFields,
  systemModuleTemplates,
} from "@sharebrain/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { validateFieldDefinitionInput } from "../shared/dynamic-fields";
import { serializeTemplateField } from "../shared/serializers";
import { appendSortKey, nextSortKey } from "../shared/sort-key";
import { ensureActiveMemberValues } from "./member-values";
import { assertModuleAdmin } from "./module-access";

import type { DatabaseClient } from "@sharebrain/db";

export class ModuleTemplatesService {
  constructor(private readonly db: DatabaseClient) {}

  async list(auth: AuthContext) {
    const templates = await this.db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)))
      .orderBy(asc(moduleTemplates.sortKey));
    const templateIds = templates.map((template) => template.id);
    const fields = templateIds.length
      ? await this.db
          .select()
          .from(moduleTemplateFields)
          .where(
            and(
              eq(moduleTemplateFields.tenantId, auth.tenantId),
              inArray(moduleTemplateFields.templateId, templateIds),
              isNull(moduleTemplateFields.deletedAt),
            ),
          )
          .orderBy(asc(moduleTemplateFields.sortKey))
      : [];
    const fieldsByTemplate = new Map<string, typeof fields>();
    for (const field of fields) {
      const items = fieldsByTemplate.get(field.templateId) ?? [];
      items.push(field);
      fieldsByTemplate.set(field.templateId, items);
    }

    return templates.map((template) =>
      presentTemplate(template, fieldsByTemplate.get(template.id) ?? []),
    );
  }

  async create(auth: AuthContext, input: unknown) {
    assertModuleAdmin(auth);
    const payload = parseJson(createModuleTemplateRequestSchema, input);
    const existingByKey = await this.findByKey(auth, payload.key);
    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "初始模块 key 已存在。", 409);
    }
    if (existingByKey && existingByKey.kind !== payload.kind) {
      throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "已删除初始模块使用相同 key 且类型不同。", 409);
    }

    const values = {
      sourceSystemTemplateId: null,
      name: payload.name,
      kind: payload.kind,
      description: payload.description ?? null,
      icon: payload.icon ?? null,
      includedInNewProjects: payload.includedInNewProjects,
      sortKey: appendSortKey(),
      deletedAt: null,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    };
    const [template] = existingByKey
      ? await this.db
          .update(moduleTemplates)
          .set(values)
          .where(and(eq(moduleTemplates.id, existingByKey.id), eq(moduleTemplates.tenantId, auth.tenantId)))
          .returning()
      : await this.db
          .insert(moduleTemplates)
          .values({
            tenantId: auth.tenantId,
            key: payload.key,
            ...values,
            createdBy: auth.userId,
            createdAt: new Date(),
          })
          .returning();
    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_CREATE_FAILED", "初始模块创建失败。", 500);
    }

    return presentTemplate(template, await this.getFields(auth, template.id));
  }

  async update(auth: AuthContext, templateId: string, input: unknown) {
    assertModuleAdmin(auth);
    const payload = parseJson(updateModuleTemplateRequestSchema, input);
    const existing = await this.ensureTemplate(auth, templateId);
    if (existing.sourceSystemTemplateId && payload.key) {
      throw new ApiError("MODULE_TEMPLATE_LOCKED", "固定初始模块不能修改 key。", 422);
    }
    if (existing.sourceSystemTemplateId && payload.includedInNewProjects === false) {
      throw new ApiError("MODULE_TEMPLATE_LOCKED", "系统初始模块必须包含在新项目中。", 422);
    }
    if (payload.key && payload.key !== existing.key) {
      const existingByKey = await this.findByKey(auth, payload.key);
      if (existingByKey && existingByKey.id !== templateId) {
        throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "初始模块 key 已存在。", 409);
      }
    }

    const [template] = await this.db
      .update(moduleTemplates)
      .set({ ...payload, updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(moduleTemplates.id, templateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .returning();
    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_UPDATE_FAILED", "初始模块更新失败。", 500);
    }
    return presentTemplate(template, await this.getFields(auth, template.id));
  }

  async reorder(auth: AuthContext, input: unknown) {
    assertModuleAdmin(auth);
    const payload = parseJson(reorderRequestSchema, input);
    const templates = await this.db
      .select({ id: moduleTemplates.id })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)));
    ensureCompleteOrder(payload.ids, templates.map((template) => template.id));
    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const [index, id] of payload.ids.entries()) {
        await tx
          .update(moduleTemplates)
          .set({ sortKey: nextSortKey(index), updatedBy: auth.userId, updatedAt: now })
          .where(and(eq(moduleTemplates.id, id), eq(moduleTemplates.tenantId, auth.tenantId)));
      }
    });
    return { ids: payload.ids };
  }

  async reorderFields(auth: AuthContext, templateId: string, input: unknown) {
    assertModuleAdmin(auth);
    await this.ensureTemplate(auth, templateId);
    const payload = parseJson(reorderRequestSchema, input);
    const fields = await this.getFields(auth, templateId);
    ensureCompleteOrder(payload.ids, fields.map((field) => field.id));
    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const [index, id] of payload.ids.entries()) {
        await tx
          .update(moduleTemplateFields)
          .set({ sortKey: nextSortKey(index), updatedBy: auth.userId, updatedAt: now })
          .where(
            and(
              eq(moduleTemplateFields.id, id),
              eq(moduleTemplateFields.templateId, templateId),
              eq(moduleTemplateFields.tenantId, auth.tenantId),
            ),
          );
      }
    });
    return { ids: payload.ids };
  }

  async resetSystem(auth: AuthContext, templateId: string) {
    assertModuleAdmin(auth);
    const template = await this.ensureTemplate(auth, templateId);
    if (!template.sourceSystemTemplateId) {
      throw new ApiError("MODULE_TEMPLATE_NOT_SYSTEM", "只有系统初始模块可以恢复默认配置。", 422);
    }

    const [source] = await this.db
      .select()
      .from(systemModuleTemplates)
      .where(
        and(
          eq(systemModuleTemplates.id, template.sourceSystemTemplateId),
          isNull(systemModuleTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!source) {
      throw new ApiError("SYSTEM_MODULE_TEMPLATE_NOT_FOUND", "系统模块源不存在。", 404);
    }
    const sourceFields = await this.db
      .select()
      .from(systemModuleTemplateFields)
      .where(
        and(
          eq(systemModuleTemplateFields.templateId, source.id),
          isNull(systemModuleTemplateFields.deletedAt),
        ),
      )
      .orderBy(asc(systemModuleTemplateFields.sortKey));
    const existingFields = await this.getFields(auth, templateId, true);
    const existingByKey = new Map(existingFields.map((field) => [field.key, field]));
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(moduleTemplates)
        .set({
          name: source.name,
          kind: source.kind,
          description: source.description,
          icon: source.icon,
          includedInNewProjects: true,
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(and(eq(moduleTemplates.id, templateId), eq(moduleTemplates.tenantId, auth.tenantId)));
      await tx
        .update(moduleTemplateFields)
        .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
        .where(and(eq(moduleTemplateFields.templateId, templateId), eq(moduleTemplateFields.tenantId, auth.tenantId)));

      for (const sourceField of sourceFields) {
        const existing = existingByKey.get(sourceField.key);
        const values = {
          label: sourceField.label,
          type: sourceField.type,
          required: sourceField.required,
          defaultKind: sourceField.defaultKind,
          defaultValue: sourceField.defaultValue,
          options: sourceField.options,
          sortKey: sourceField.sortKey,
          deletedAt: null,
          updatedBy: auth.userId,
          updatedAt: now,
        };
        if (existing) {
          await tx.update(moduleTemplateFields).set(values).where(eq(moduleTemplateFields.id, existing.id));
        } else {
          await tx.insert(moduleTemplateFields).values({
            tenantId: auth.tenantId,
            templateId,
            key: sourceField.key,
            ...values,
            createdBy: auth.userId,
            createdAt: now,
          });
        }
      }
    });

    const restored = await this.ensureTemplate(auth, templateId);
    return presentTemplate(restored, await this.getFields(auth, templateId));
  }

  async remove(auth: AuthContext, templateId: string) {
    assertModuleAdmin(auth);
    const existing = await this.ensureTemplate(auth, templateId);
    if (existing.sourceSystemTemplateId) {
      throw new ApiError("MODULE_TEMPLATE_LOCKED", "固定初始模块不能删除。", 422);
    }

    const now = new Date();
    const [template] = await this.db
      .update(moduleTemplates)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(moduleTemplates.id, templateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .returning();
    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_NOT_FOUND", "初始模块不存在。", 404);
    }
    return presentTemplate(template, []);
  }

  async upsertField(auth: AuthContext, templateId: string, input: unknown) {
    assertModuleAdmin(auth);
    const payload = parseJson(upsertModuleFieldRequestSchema, input);
    const template = await this.ensureTemplate(auth, templateId);
    if (template.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const normalized = validateFieldDefinitionInput(payload);
    await ensureActiveMemberValues(
      this.db,
      auth,
      [{ id: "default", type: payload.type }],
      { default: normalized.defaultValue },
    );
    const fieldValues = {
      key: payload.key,
      label: payload.label,
      type: payload.type,
      required: payload.required,
      defaultKind: payload.defaultKind,
      defaultValue: normalized.defaultValue,
      options: normalized.options,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    };
    const existingByKey = await this.findFieldByKey(auth, templateId, payload.key);

    if (payload.id) {
      if (existingByKey && existingByKey.id !== payload.id) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }
      const [field] = await this.db
        .update(moduleTemplateFields)
        .set(fieldValues)
        .where(
          and(
            eq(moduleTemplateFields.id, payload.id),
            eq(moduleTemplateFields.tenantId, auth.tenantId),
            eq(moduleTemplateFields.templateId, templateId),
            isNull(moduleTemplateFields.deletedAt),
          ),
        )
        .returning();
      if (!field) throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      return serializeTemplateField(field);
    }

    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
    }
    const [field] = existingByKey
      ? await this.db
          .update(moduleTemplateFields)
          .set({ ...fieldValues, deletedAt: null })
          .where(
            and(
              eq(moduleTemplateFields.id, existingByKey.id),
              eq(moduleTemplateFields.tenantId, auth.tenantId),
              eq(moduleTemplateFields.templateId, templateId),
            ),
          )
          .returning()
      : await this.db
          .insert(moduleTemplateFields)
          .values({
            tenantId: auth.tenantId,
            templateId,
            ...fieldValues,
            sortKey: appendSortKey(),
            createdBy: auth.userId,
            createdAt: new Date(),
          })
          .returning();
    if (!field) throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
    return serializeTemplateField(field);
  }

  async removeField(auth: AuthContext, templateId: string, fieldId: string) {
    assertModuleAdmin(auth);
    const template = await this.ensureTemplate(auth, templateId);
    if (template.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const now = new Date();
    const [field] = await this.db
      .update(moduleTemplateFields)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(moduleTemplateFields.id, fieldId),
          eq(moduleTemplateFields.templateId, templateId),
          eq(moduleTemplateFields.tenantId, auth.tenantId),
          isNull(moduleTemplateFields.deletedAt),
        ),
      )
      .returning();
    if (!field) throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
    return serializeTemplateField(field);
  }

  private async ensureTemplate(auth: AuthContext, templateId: string) {
    const [template] = await this.db
      .select()
      .from(moduleTemplates)
      .where(
        and(
          eq(moduleTemplates.id, templateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!template) throw new ApiError("MODULE_TEMPLATE_NOT_FOUND", "初始模块不存在。", 404);
    return template;
  }

  private getFields(auth: AuthContext, templateId: string, includeDeleted = false) {
    return this.db
      .select()
      .from(moduleTemplateFields)
      .where(
        includeDeleted
          ? and(
              eq(moduleTemplateFields.tenantId, auth.tenantId),
              eq(moduleTemplateFields.templateId, templateId),
            )
          : and(
              eq(moduleTemplateFields.tenantId, auth.tenantId),
              eq(moduleTemplateFields.templateId, templateId),
              isNull(moduleTemplateFields.deletedAt),
            ),
      )
      .orderBy(asc(moduleTemplateFields.sortKey));
  }

  private async findByKey(auth: AuthContext, key: string) {
    const [template] = await this.db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), eq(moduleTemplates.key, key)))
      .limit(1);
    return template ?? null;
  }

  private async findFieldByKey(auth: AuthContext, templateId: string, key: string) {
    const [field] = await this.db
      .select()
      .from(moduleTemplateFields)
      .where(
        and(
          eq(moduleTemplateFields.tenantId, auth.tenantId),
          eq(moduleTemplateFields.templateId, templateId),
          eq(moduleTemplateFields.key, key),
        ),
      )
      .limit(1);
    return field ?? null;
  }
}

function presentTemplate(
  template: typeof moduleTemplates.$inferSelect,
  fields: Array<typeof moduleTemplateFields.$inferSelect>,
): ModuleTemplate {
  return {
    id: template.id,
    sourceSystemTemplateId: template.sourceSystemTemplateId,
    isSystemFixed: template.sourceSystemTemplateId !== null,
    key: template.key,
    name: template.name,
    kind: template.kind as ModuleTemplate["kind"],
    description: template.description,
    icon: template.icon,
    includedInNewProjects: template.includedInNewProjects,
    sortKey: template.sortKey,
    fields: fields.map(serializeTemplateField),
  };
}

function ensureCompleteOrder(inputIds: string[], existingIds: string[]) {
  const input = new Set(inputIds);
  if (
    input.size !== inputIds.length ||
    input.size !== existingIds.length ||
    existingIds.some((id) => !input.has(id))
  ) {
    throw new ApiError("ORDER_INVALID", "排序项必须完整且不能重复。", 422);
  }
}
