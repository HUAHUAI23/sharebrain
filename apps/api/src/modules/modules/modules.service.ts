import {
  createModuleRecordRequestSchema,
  createModuleRequestSchema,
  createModuleTemplateRequestSchema,
  updateModuleRecordRequestSchema,
  updateModuleRequestSchema,
  updateModuleTemplateRequestSchema,
  upsertModuleFieldRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import {
  documents,
  moduleRecords,
  moduleTemplateFields,
  moduleTemplates,
  projectModuleFields,
  projectModules,
  projects,
} from "@sharebrain/db/schema";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { IndexerService } from "../indexer/indexer.service";
import { validateFieldDefinitionInput, validateRecordValues } from "../shared/dynamic-fields";
import { serializeField, serializeModule, serializeModuleRecord, serializeTemplateField } from "../shared/serializers";
import { nextSortKey } from "../shared/sort-key";

import type { DatabaseClient } from "@sharebrain/db";

export class ModulesService {
  private readonly indexer: IndexerService;

  constructor(private readonly db: DatabaseClient) {
    this.indexer = new IndexerService(db);
  }

  async listTemplates(auth: AuthContext) {
    const templates = await this.db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)))
      .orderBy(asc(moduleTemplates.sortKey));

    const templateIds = templates.map((template) => template.id);
    const fields =
      templateIds.length > 0
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

    return templates.map((template) => ({
      id: template.id,
      sourceSystemTemplateId: template.sourceSystemTemplateId,
      isSystemFixed: template.sourceSystemTemplateId !== null,
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      fields: fields.filter((field) => field.templateId === template.id).map(serializeTemplateField),
      icon: template.icon,
      sortKey: template.sortKey,
    }));
  }

  async createTemplate(auth: AuthContext, input: unknown) {
    this.ensureAdmin(auth);
    const payload = parseJson(createModuleTemplateRequestSchema, input);
    const existingByKey = await this.findTemplateByKey(auth, payload.key);
    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "默认模块 key 已存在。", 409);
    }
    if (existingByKey && existingByKey.kind !== payload.kind) {
      throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "已删除默认模块使用相同 key 且类型不同。", 409);
    }

    const [templateCountRow] = await this.db
      .select({ value: count() })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)));
    const templateCount = templateCountRow?.value ?? 0;

    if (existingByKey) {
      const [template] = await this.db
        .update(moduleTemplates)
        .set({
          sourceSystemTemplateId: null,
          name: payload.name,
          kind: payload.kind,
          description: payload.description ?? null,
          icon: payload.icon ?? null,
          sortKey: nextSortKey(templateCount),
          deletedAt: null,
          updatedBy: auth.userId,
          updatedAt: new Date(),
        })
        .where(and(eq(moduleTemplates.id, existingByKey.id), eq(moduleTemplates.tenantId, auth.tenantId)))
        .returning();

      if (!template) {
        throw new ApiError("MODULE_TEMPLATE_CREATE_FAILED", "默认模块创建失败。", 500);
      }

      const fields = await this.getTemplateFields(auth, template.id);
      return {
        id: template.id,
        sourceSystemTemplateId: template.sourceSystemTemplateId,
        isSystemFixed: false,
        key: template.key,
        name: template.name,
        kind: template.kind,
        description: template.description,
        icon: template.icon,
        sortKey: template.sortKey,
        fields: fields.map(serializeTemplateField),
      };
    }

    const [template] = await this.db
      .insert(moduleTemplates)
      .values({
        tenantId: auth.tenantId,
        key: payload.key,
        name: payload.name,
        kind: payload.kind,
        description: payload.description ?? null,
        icon: payload.icon ?? null,
        sortKey: nextSortKey(templateCount),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();

    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_CREATE_FAILED", "默认模块创建失败。", 500);
    }

    return {
      id: template.id,
      sourceSystemTemplateId: template.sourceSystemTemplateId,
      isSystemFixed: false,
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      icon: template.icon,
      sortKey: template.sortKey,
      fields: [],
    };
  }

  async updateTemplate(auth: AuthContext, templateId: string, input: unknown) {
    this.ensureAdmin(auth);
    const payload = parseJson(updateModuleTemplateRequestSchema, input);
    const existing = await this.ensureTemplate(auth, templateId);
    if (existing.sourceSystemTemplateId && payload.key) {
      throw new ApiError("MODULE_TEMPLATE_LOCKED", "固定默认模块不能修改 key。", 422);
    }
    if (payload.key && payload.key !== existing.key) {
      const existingByKey = await this.findTemplateByKey(auth, payload.key);
      if (existingByKey && existingByKey.id !== templateId) {
        throw new ApiError("MODULE_TEMPLATE_KEY_EXISTS", "默认模块 key 已存在。", 409);
      }
    }

    const [template] = await this.db
      .update(moduleTemplates)
      .set({
        ...payload,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(moduleTemplates.id, templateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .returning();

    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_UPDATE_FAILED", "默认模块更新失败。", 500);
    }

    const fields = await this.getTemplateFields(auth, template.id);
    return {
      id: template.id,
      sourceSystemTemplateId: template.sourceSystemTemplateId,
      isSystemFixed: template.sourceSystemTemplateId !== null,
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      icon: template.icon,
      sortKey: template.sortKey,
      fields: fields.map(serializeTemplateField),
    };
  }

  async softDeleteTemplate(auth: AuthContext, templateId: string) {
    this.ensureAdmin(auth);
    const existing = await this.ensureTemplate(auth, templateId);
    if (existing.sourceSystemTemplateId) {
      throw new ApiError("MODULE_TEMPLATE_LOCKED", "固定默认模块不能删除。", 422);
    }

    const [template] = await this.db
      .update(moduleTemplates)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(moduleTemplates.id, templateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .returning();

    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_NOT_FOUND", "默认模块不存在。", 404);
    }

    return {
      id: template.id,
      sourceSystemTemplateId: template.sourceSystemTemplateId,
      isSystemFixed: template.sourceSystemTemplateId !== null,
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      icon: template.icon,
      sortKey: template.sortKey,
      fields: [],
    };
  }

  async listProjectModules(auth: AuthContext, projectId: string) {
    await this.ensureProject(auth, projectId);
    const modules = await this.db
      .select()
      .from(projectModules)
      .where(
        and(
          eq(projectModules.tenantId, auth.tenantId),
          eq(projectModules.projectId, projectId),
          isNull(projectModules.deletedAt),
        ),
      )
      .orderBy(asc(projectModules.sortKey));

    const moduleIds = modules.map((module) => module.id);
    const fields =
      moduleIds.length > 0
        ? await this.db
            .select()
            .from(projectModuleFields)
            .where(
              and(
                eq(projectModuleFields.tenantId, auth.tenantId),
                inArray(projectModuleFields.moduleId, moduleIds),
                isNull(projectModuleFields.deletedAt),
              ),
            )
            .orderBy(asc(projectModuleFields.sortKey))
        : [];
    const templates = await this.db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)));
    const fixedTemplateIds = new Set(templates.filter((template) => template.sourceSystemTemplateId !== null).map((template) => template.id));

    return modules.map((module) =>
      serializeModule(
        module,
        fields.filter((field) => field.moduleId === module.id),
        { isSystemFixed: module.sourceTemplateId !== null && fixedTemplateIds.has(module.sourceTemplateId) },
      ),
    );
  }

  async createModule(auth: AuthContext, projectId: string, input: unknown) {
    this.ensureEditor(auth);
    await this.ensureProject(auth, projectId);
    const payload = parseJson(createModuleRequestSchema, input);
    const existingByKey = await this.findProjectModuleByKey(auth, projectId, payload.key);
    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("MODULE_KEY_EXISTS", "模块 key 已存在。", 409);
    }
    if (existingByKey && existingByKey.kind !== payload.kind) {
      throw new ApiError("MODULE_KEY_EXISTS", "已删除模块使用相同 key 且类型不同。", 409);
    }

    const [moduleCountRow] = await this.db
      .select({ value: count() })
      .from(projectModules)
      .where(
        and(
          eq(projectModules.tenantId, auth.tenantId),
          eq(projectModules.projectId, projectId),
          isNull(projectModules.deletedAt),
        ),
      );
    const moduleCount = moduleCountRow?.value ?? 0;

    if (existingByKey) {
      const [module] = await this.db
        .update(projectModules)
        .set({
          sourceTemplateId: null,
          name: payload.name,
          kind: payload.kind,
          description: payload.description ?? null,
          icon: null,
          sortKey: nextSortKey(moduleCount),
          deletedAt: null,
          updatedBy: auth.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectModules.id, existingByKey.id),
            eq(projectModules.tenantId, auth.tenantId),
            eq(projectModules.projectId, projectId),
          ),
        )
        .returning();

      if (!module) {
        throw new ApiError("MODULE_CREATE_FAILED", "模块创建失败。", 500);
      }

      const fields = await this.getModuleFields(auth, module.id);
      return serializeModule(module, fields);
    }

    const [module] = await this.db
      .insert(projectModules)
      .values({
        tenantId: auth.tenantId,
        projectId,
        key: payload.key,
        name: payload.name,
        kind: payload.kind,
        description: payload.description ?? null,
        sortKey: nextSortKey(moduleCount),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();

    if (!module) {
      throw new ApiError("MODULE_CREATE_FAILED", "模块创建失败。", 500);
    }

    return serializeModule(module, []);
  }

  async updateModule(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
    this.ensureEditor(auth);
    const payload = parseJson(updateModuleRequestSchema, input);
    const existing = await this.ensureModule(auth, moduleId);
    this.ensureModuleInProject(existing, projectId);
    if (await this.isProjectModuleFixed(auth, existing)) {
      if (payload.key) {
        throw new ApiError("MODULE_LOCKED", "固定模块不能修改 key。", 422);
      }
    }
    if (payload.key && payload.key !== existing.key) {
      const existingByKey = await this.findProjectModuleByKey(auth, projectId, payload.key);
      if (existingByKey && existingByKey.id !== moduleId) {
        throw new ApiError("MODULE_KEY_EXISTS", "模块 key 已存在。", 409);
      }
    }

    const [module] = await this.db
      .update(projectModules)
      .set({
        ...payload,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .returning();

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    const fields = await this.getModuleFields(auth, module.id);
    return serializeModule(module, fields, { isSystemFixed: await this.isProjectModuleFixed(auth, module) });
  }

  async softDeleteModule(auth: AuthContext, projectId: string, moduleId: string) {
    this.ensureEditor(auth);
    const existing = await this.ensureModule(auth, moduleId);
    this.ensureModuleInProject(existing, projectId);
    if (await this.isProjectModuleFixed(auth, existing)) {
      throw new ApiError("MODULE_LOCKED", "固定模块不能删除。", 422);
    }

    const [module] = await this.db
      .update(projectModules)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .returning();

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    return serializeModule(module, []);
  }

  async upsertTemplateField(auth: AuthContext, templateId: string, input: unknown) {
    this.ensureAdmin(auth);
    const payload = parseJson(upsertModuleFieldRequestSchema, input);
    const template = await this.ensureTemplate(auth, templateId);
    if (template.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const [fieldCountRow] = await this.db
      .select({ value: count() })
      .from(moduleTemplateFields)
      .where(
        and(
          eq(moduleTemplateFields.tenantId, auth.tenantId),
          eq(moduleTemplateFields.templateId, templateId),
          isNull(moduleTemplateFields.deletedAt),
        ),
      );
    const fieldCount = fieldCountRow?.value ?? 0;
    const normalized = validateFieldDefinitionInput(payload);

    const fieldValues = {
      key: payload.key,
      label: payload.label,
      type: payload.type,
      required: payload.required,
      defaultPolicy: payload.defaultPolicy,
      defaultValue: normalized.defaultValue,
      options: normalized.options,
      updatedBy: auth.userId,
    };

    const existingByKey = await this.findTemplateFieldByKey(auth, templateId, payload.key);

    if (payload.id) {
      if (existingByKey && existingByKey.id !== payload.id) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }

      const [field] = await this.db
        .update(moduleTemplateFields)
        .set({ ...fieldValues, updatedAt: new Date() })
        .where(
          and(
            eq(moduleTemplateFields.id, payload.id),
            eq(moduleTemplateFields.tenantId, auth.tenantId),
            eq(moduleTemplateFields.templateId, templateId),
            isNull(moduleTemplateFields.deletedAt),
          ),
        )
        .returning();
      if (!field) {
        throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      }
      return serializeTemplateField(field);
    }

    if (existingByKey) {
      if (!existingByKey.deletedAt) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }

      const [field] = await this.db
        .update(moduleTemplateFields)
        .set({ ...fieldValues, deletedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(moduleTemplateFields.id, existingByKey.id),
            eq(moduleTemplateFields.tenantId, auth.tenantId),
            eq(moduleTemplateFields.templateId, templateId),
          ),
        )
        .returning();
      if (!field) {
        throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
      }
      return serializeTemplateField(field);
    }

    const [field] = await this.db
      .insert(moduleTemplateFields)
      .values({
        tenantId: auth.tenantId,
        templateId,
        ...fieldValues,
        sortKey: nextSortKey(fieldCount),
        createdBy: auth.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!field) {
      throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
    }
    return serializeTemplateField(field);
  }

  async softDeleteTemplateField(auth: AuthContext, templateId: string, fieldId: string) {
    this.ensureAdmin(auth);
    const template = await this.ensureTemplate(auth, templateId);
    if (template.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const [field] = await this.db
      .update(moduleTemplateFields)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(moduleTemplateFields.id, fieldId),
          eq(moduleTemplateFields.templateId, templateId),
          eq(moduleTemplateFields.tenantId, auth.tenantId),
          isNull(moduleTemplateFields.deletedAt),
        ),
      )
      .returning();

    if (!field) {
      throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
    }

    return serializeTemplateField(field);
  }

  async upsertField(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
    this.ensureEditor(auth);
    const payload = parseJson(upsertModuleFieldRequestSchema, input);
    const module = await this.ensureModule(auth, moduleId);
    this.ensureModuleInProject(module, projectId);
    if (module.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const [fieldCountRow] = await this.db
      .select({ value: count() })
      .from(projectModuleFields)
      .where(
        and(
          eq(projectModuleFields.tenantId, auth.tenantId),
          eq(projectModuleFields.moduleId, moduleId),
          isNull(projectModuleFields.deletedAt),
        ),
      );
    const fieldCount = fieldCountRow?.value ?? 0;
    const normalized = validateFieldDefinitionInput(payload);

    const fieldValues = {
      key: payload.key,
      label: payload.label,
      type: payload.type,
      required: payload.required,
      defaultPolicy: payload.defaultPolicy,
      defaultValue: normalized.defaultValue,
      options: normalized.options,
      updatedBy: auth.userId,
    };

    const existingByKey = await this.findProjectFieldByKey(auth, moduleId, payload.key);

    if (payload.id) {
      if (existingByKey && existingByKey.id !== payload.id) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }

      const [field] = await this.db
        .update(projectModuleFields)
        .set({ ...fieldValues, updatedAt: new Date() })
        .where(
          and(
            eq(projectModuleFields.id, payload.id),
            eq(projectModuleFields.moduleId, moduleId),
            eq(projectModuleFields.tenantId, auth.tenantId),
            isNull(projectModuleFields.deletedAt),
          ),
        )
        .returning();
      if (!field) {
        throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      }
      return field;
    }

    if (existingByKey) {
      if (!existingByKey.deletedAt) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }

      const [field] = await this.db
        .update(projectModuleFields)
        .set({ ...fieldValues, deletedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(projectModuleFields.id, existingByKey.id),
            eq(projectModuleFields.moduleId, moduleId),
            eq(projectModuleFields.tenantId, auth.tenantId),
          ),
        )
        .returning();
      if (!field) {
        throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
      }
      return field;
    }

    const [field] = await this.db
      .insert(projectModuleFields)
      .values({
        tenantId: auth.tenantId,
        moduleId,
        ...fieldValues,
        sortKey: nextSortKey(fieldCount),
        createdBy: auth.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!field) {
      throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
    }
    return field;
  }

  async softDeleteField(auth: AuthContext, projectId: string, moduleId: string, fieldId: string) {
    this.ensureEditor(auth);
    const module = await this.ensureModule(auth, moduleId);
    this.ensureModuleInProject(module, projectId);
    if (module.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const [field] = await this.db
      .update(projectModuleFields)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(projectModuleFields.id, fieldId),
          eq(projectModuleFields.moduleId, moduleId),
          eq(projectModuleFields.tenantId, auth.tenantId),
          isNull(projectModuleFields.deletedAt),
        ),
      )
      .returning();

    if (!field) {
      throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
    }

    return serializeField(field);
  }

  async listRecords(auth: AuthContext, projectId: string, moduleId: string) {
    const module = await this.ensureModule(auth, moduleId);
    this.ensureModuleInProject(module, projectId);
    const records = await this.db
      .select()
      .from(moduleRecords)
      .where(
        and(
          eq(moduleRecords.tenantId, auth.tenantId),
          eq(moduleRecords.moduleId, moduleId),
          isNull(moduleRecords.deletedAt),
        ),
      )
      .orderBy(asc(moduleRecords.sortKey));

    const recordDocuments = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, auth.tenantId),
          eq(documents.moduleId, moduleId),
          isNull(documents.deletedAt),
        ),
      );

    return records.map((record) =>
      serializeModuleRecord(
        record,
        recordDocuments.filter((document) => document.moduleRecordId === record.id),
      ),
    );
  }

  async createRecord(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
    this.ensureEditor(auth);
    const module = await this.ensureModule(auth, moduleId);
    if (module.projectId !== projectId) {
      throw new ApiError("MODULE_PROJECT_MISMATCH", "模块不属于当前项目。", 404);
    }
    if (module.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能创建记录。", 422);
    }

    const payload = parseJson(createModuleRecordRequestSchema, input);
    const fields = await this.getModuleFields(auth, moduleId);
    const values = validateRecordValues(fields, payload.values);
    const [recordCountRow] = await this.db
      .select({ value: count() })
      .from(moduleRecords)
      .where(
        and(
          eq(moduleRecords.tenantId, auth.tenantId),
          eq(moduleRecords.moduleId, moduleId),
          isNull(moduleRecords.deletedAt),
        ),
      );
    const recordCount = recordCountRow?.value ?? 0;

    const [record] = await this.db
      .insert(moduleRecords)
      .values({
        tenantId: auth.tenantId,
        projectId,
        moduleId,
        title: payload.title,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
        values,
        sortKey: nextSortKey(recordCount),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();

    if (!record) {
      throw new ApiError("RECORD_CREATE_FAILED", "记录创建失败。", 500);
    }

    await this.indexer.indexModuleRecord(auth, record.id);
    return serializeModuleRecord(record, []);
  }

  async updateRecord(auth: AuthContext, recordId: string, input: unknown) {
    this.ensureEditor(auth);
    const payload = parseJson(updateModuleRecordRequestSchema, input);
    const [existing] = await this.db
      .select()
      .from(moduleRecords)
      .where(
        and(
          eq(moduleRecords.id, recordId),
          eq(moduleRecords.tenantId, auth.tenantId),
          isNull(moduleRecords.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new ApiError("RECORD_NOT_FOUND", "记录不存在。", 404);
    }

    const fields = await this.getModuleFields(auth, existing.moduleId);
    const values = payload.values ? validateRecordValues(fields, payload.values) : existing.values;
    const [record] = await this.db
      .update(moduleRecords)
      .set({
        title: payload.title ?? existing.title,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : existing.occurredAt,
        values,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(moduleRecords.id, recordId),
          eq(moduleRecords.tenantId, auth.tenantId),
          isNull(moduleRecords.deletedAt),
        ),
      )
      .returning();

    if (!record) {
      throw new ApiError("RECORD_UPDATE_FAILED", "记录更新失败。", 500);
    }

    await this.indexer.indexModuleRecord(auth, record.id);
    const recordDocuments = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, auth.tenantId),
          eq(documents.moduleRecordId, record.id),
          isNull(documents.deletedAt),
        ),
      );
    return serializeModuleRecord(record, recordDocuments);
  }

  async softDeleteRecord(auth: AuthContext, recordId: string) {
    this.ensureEditor(auth);
    const [record] = await this.db
      .update(moduleRecords)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(moduleRecords.id, recordId),
          eq(moduleRecords.tenantId, auth.tenantId),
          isNull(moduleRecords.deletedAt),
        ),
      )
      .returning();

    if (!record) {
      throw new ApiError("RECORD_NOT_FOUND", "记录不存在。", 404);
    }

    await this.indexer.removeModuleRecord(auth, record.id);
    return serializeModuleRecord(record, []);
  }

  private async ensureProject(auth: AuthContext, projectId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.tenantId, auth.tenantId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    return project;
  }

  private ensureAdmin(auth: AuthContext) {
    if (auth.role !== "admin") {
      throw new ApiError("FORBIDDEN", "当前账号没有管理空间模块的权限。", 403);
    }
  }

  private ensureEditor(auth: AuthContext) {
    if (auth.role === "viewer" || auth.role === "auditor") {
      throw new ApiError("FORBIDDEN", "当前账号没有编辑权限。", 403);
    }
  }

  private ensureModuleInProject(module: typeof projectModules.$inferSelect, projectId: string) {
    if (module.projectId !== projectId) {
      throw new ApiError("MODULE_PROJECT_MISMATCH", "模块不属于当前项目。", 404);
    }
  }

  private async ensureModule(auth: AuthContext, moduleId: string) {
    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .limit(1);

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    return module;
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

    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_NOT_FOUND", "默认模块不存在。", 404);
    }

    return template;
  }

  private async getTemplateFields(auth: AuthContext, templateId: string) {
    return this.db
      .select()
      .from(moduleTemplateFields)
      .where(
        and(
          eq(moduleTemplateFields.tenantId, auth.tenantId),
          eq(moduleTemplateFields.templateId, templateId),
          isNull(moduleTemplateFields.deletedAt),
        ),
      )
      .orderBy(asc(moduleTemplateFields.sortKey));
  }

  private async findTemplateByKey(auth: AuthContext, key: string) {
    const [template] = await this.db
      .select()
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), eq(moduleTemplates.key, key)))
      .limit(1);
    return template ?? null;
  }

  private async findTemplateFieldByKey(auth: AuthContext, templateId: string, key: string) {
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

  private async getModuleFields(auth: AuthContext, moduleId: string) {
    return this.db
      .select()
      .from(projectModuleFields)
      .where(
        and(
          eq(projectModuleFields.tenantId, auth.tenantId),
          eq(projectModuleFields.moduleId, moduleId),
          isNull(projectModuleFields.deletedAt),
        ),
      )
      .orderBy(asc(projectModuleFields.sortKey));
  }

  private async findProjectModuleByKey(auth: AuthContext, projectId: string, key: string) {
    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(and(eq(projectModules.tenantId, auth.tenantId), eq(projectModules.projectId, projectId), eq(projectModules.key, key)))
      .limit(1);
    return module ?? null;
  }

  private async findProjectFieldByKey(auth: AuthContext, moduleId: string, key: string) {
    const [field] = await this.db
      .select()
      .from(projectModuleFields)
      .where(
        and(
          eq(projectModuleFields.tenantId, auth.tenantId),
          eq(projectModuleFields.moduleId, moduleId),
          eq(projectModuleFields.key, key),
        ),
      )
      .limit(1);
    return field ?? null;
  }

  private async isProjectModuleFixed(auth: AuthContext, module: typeof projectModules.$inferSelect) {
    if (!module.sourceTemplateId) {
      return false;
    }

    const [template] = await this.db
      .select({ sourceSystemTemplateId: moduleTemplates.sourceSystemTemplateId })
      .from(moduleTemplates)
      .where(
        and(
          eq(moduleTemplates.id, module.sourceTemplateId),
          eq(moduleTemplates.tenantId, auth.tenantId),
          isNull(moduleTemplates.deletedAt),
        ),
      )
      .limit(1);
    return template?.sourceSystemTemplateId !== null && template?.sourceSystemTemplateId !== undefined;
  }
}
