import {
  createModuleRecordRequestSchema,
  createModuleRequestSchema,
  createModuleTemplateRequestSchema,
  updateModuleRecordRequestSchema,
  updateModuleRequestSchema,
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
import { and, asc, count, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { IndexerService } from "../indexer/indexer.service";
import { validateRecordValues } from "../shared/dynamic-fields";
import { serializeModule, serializeModuleRecord } from "../shared/serializers";
import { nextSortKey } from "../shared/sort-key";

import type { DatabaseClient } from "@sharebrain/db";

function normalizeOptions(options: Array<{ id: string; label: string; color?: string | undefined }>) {
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.color ? { color: option.color } : {}),
  }));
}

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

    const fields = await this.db
      .select()
      .from(moduleTemplateFields)
      .where(and(eq(moduleTemplateFields.tenantId, auth.tenantId), isNull(moduleTemplateFields.deletedAt)))
      .orderBy(asc(moduleTemplateFields.sortKey));

    return templates.map((template) => ({
      id: template.id,
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      fields: fields
        .filter((field) => field.templateId === template.id)
        .map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          defaultPolicy: field.defaultPolicy,
          defaultValue: field.defaultValue ?? null,
          options: field.options,
          sortKey: field.sortKey,
        })),
      icon: template.icon,
      sortKey: template.sortKey,
    }));
  }

  async createTemplate(auth: AuthContext, input: unknown) {
    const payload = parseJson(createModuleTemplateRequestSchema, input);
    const [templateCountRow] = await this.db
      .select({ value: count() })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)));
    const templateCount = templateCountRow?.value ?? 0;

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
      key: template.key,
      name: template.name,
      kind: template.kind,
      description: template.description,
      icon: template.icon,
      sortKey: template.sortKey,
      fields: [],
    };
  }

  async softDeleteTemplate(auth: AuthContext, templateId: string) {
    const [template] = await this.db
      .update(moduleTemplates)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(and(eq(moduleTemplates.id, templateId), eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)))
      .returning();

    if (!template) {
      throw new ApiError("MODULE_TEMPLATE_NOT_FOUND", "默认模块不存在。", 404);
    }

    return {
      id: template.id,
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
      .where(and(eq(projectModules.tenantId, auth.tenantId), eq(projectModules.projectId, projectId), isNull(projectModules.deletedAt)))
      .orderBy(asc(projectModules.sortKey));

    const fields = await this.db
      .select()
      .from(projectModuleFields)
      .where(and(eq(projectModuleFields.tenantId, auth.tenantId), isNull(projectModuleFields.deletedAt)))
      .orderBy(asc(projectModuleFields.sortKey));

    return modules.map((module) =>
      serializeModule(
        module,
        fields.filter((field) => field.moduleId === module.id),
      ),
    );
  }

  async createModule(auth: AuthContext, projectId: string, input: unknown) {
    await this.ensureProject(auth, projectId);
    const payload = parseJson(createModuleRequestSchema, input);
    const [moduleCountRow] = await this.db
      .select({ value: count() })
      .from(projectModules)
      .where(and(eq(projectModules.tenantId, auth.tenantId), eq(projectModules.projectId, projectId)));
    const moduleCount = moduleCountRow?.value ?? 0;

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

  async updateModule(auth: AuthContext, moduleId: string, input: unknown) {
    const payload = parseJson(updateModuleRequestSchema, input);
    const [module] = await this.db
      .update(projectModules)
      .set({
        ...payload,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(projectModules.id, moduleId), eq(projectModules.tenantId, auth.tenantId), isNull(projectModules.deletedAt)))
      .returning();

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    const fields = await this.getModuleFields(auth, module.id);
    return serializeModule(module, fields);
  }

  async softDeleteModule(auth: AuthContext, moduleId: string) {
    const [module] = await this.db
      .update(projectModules)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(and(eq(projectModules.id, moduleId), eq(projectModules.tenantId, auth.tenantId), isNull(projectModules.deletedAt)))
      .returning();

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    return serializeModule(module, []);
  }

  async upsertField(auth: AuthContext, moduleId: string, input: unknown) {
    const payload = parseJson(upsertModuleFieldRequestSchema, input);
    await this.ensureModule(auth, moduleId);
    const [fieldCountRow] = await this.db
      .select({ value: count() })
      .from(projectModuleFields)
      .where(and(eq(projectModuleFields.tenantId, auth.tenantId), eq(projectModuleFields.moduleId, moduleId)));
    const fieldCount = fieldCountRow?.value ?? 0;

    const values = {
      tenantId: auth.tenantId,
      moduleId,
      key: payload.key,
      label: payload.label,
      type: payload.type,
      required: payload.required,
      defaultPolicy: payload.defaultPolicy,
      defaultValue: payload.defaultValue ?? null,
      options: normalizeOptions(payload.options),
      sortKey: nextSortKey(fieldCount),
      createdBy: auth.userId,
      updatedBy: auth.userId,
    };

    if (payload.id) {
      const [field] = await this.db
        .update(projectModuleFields)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(projectModuleFields.id, payload.id), eq(projectModuleFields.tenantId, auth.tenantId), isNull(projectModuleFields.deletedAt)))
        .returning();
      if (!field) {
        throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      }
      return field;
    }

    const [field] = await this.db.insert(projectModuleFields).values(values).returning();
    if (!field) {
      throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
    }
    return field;
  }

  async listRecords(auth: AuthContext, moduleId: string) {
    await this.ensureModule(auth, moduleId);
    const records = await this.db
      .select()
      .from(moduleRecords)
      .where(and(eq(moduleRecords.tenantId, auth.tenantId), eq(moduleRecords.moduleId, moduleId), isNull(moduleRecords.deletedAt)))
      .orderBy(asc(moduleRecords.sortKey));

    const recordDocuments = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, auth.tenantId), eq(documents.moduleId, moduleId), isNull(documents.deletedAt)));

    return records.map((record) =>
      serializeModuleRecord(
        record,
        recordDocuments.filter((document) => document.moduleRecordId === record.id),
      ),
    );
  }

  async createRecord(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
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
      .where(and(eq(moduleRecords.tenantId, auth.tenantId), eq(moduleRecords.moduleId, moduleId)));
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
    const payload = parseJson(updateModuleRecordRequestSchema, input);
    const [existing] = await this.db
      .select()
      .from(moduleRecords)
      .where(and(eq(moduleRecords.id, recordId), eq(moduleRecords.tenantId, auth.tenantId), isNull(moduleRecords.deletedAt)))
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
      .where(eq(moduleRecords.id, recordId))
      .returning();

    if (!record) {
      throw new ApiError("RECORD_UPDATE_FAILED", "记录更新失败。", 500);
    }

    await this.indexer.indexModuleRecord(auth, record.id);
    const recordDocuments = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, auth.tenantId), eq(documents.moduleRecordId, record.id), isNull(documents.deletedAt)));
    return serializeModuleRecord(record, recordDocuments);
  }

  async softDeleteRecord(auth: AuthContext, recordId: string) {
    const [record] = await this.db
      .update(moduleRecords)
      .set({ deletedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() })
      .where(and(eq(moduleRecords.id, recordId), eq(moduleRecords.tenantId, auth.tenantId), isNull(moduleRecords.deletedAt)))
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
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, auth.tenantId), isNull(projects.deletedAt)))
      .limit(1);

    if (!project) {
      throw new ApiError("PROJECT_NOT_FOUND", "项目不存在。", 404);
    }

    return project;
  }

  private async ensureModule(auth: AuthContext, moduleId: string) {
    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(and(eq(projectModules.id, moduleId), eq(projectModules.tenantId, auth.tenantId), isNull(projectModules.deletedAt)))
      .limit(1);

    if (!module) {
      throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    }

    return module;
  }

  private async getModuleFields(auth: AuthContext, moduleId: string) {
    return this.db
      .select()
      .from(projectModuleFields)
      .where(and(eq(projectModuleFields.tenantId, auth.tenantId), eq(projectModuleFields.moduleId, moduleId), isNull(projectModuleFields.deletedAt)))
      .orderBy(asc(projectModuleFields.sortKey));
  }
}
