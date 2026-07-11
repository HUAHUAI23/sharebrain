// 管理项目内模块和项目字段定义，不处理空间模板或记录索引。
import {
  createModuleRequestSchema,
  updateModuleRequestSchema,
  upsertModuleFieldRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import {
  moduleTemplates,
  projectModuleFields,
  projectModules,
} from "@sharebrain/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { validateFieldDefinitionInput } from "../shared/dynamic-fields";
import { serializeField, serializeModule } from "../shared/serializers";
import { appendSortKey } from "../shared/sort-key";
import { ensureActiveMemberValues } from "./member-values";
import {
  assertModuleEditor,
  assertModuleInProject,
  ensureProject,
  ensureProjectModule,
  isProjectModuleFixed,
} from "./module-access";

import type { DatabaseClient } from "@sharebrain/db";

export class ProjectModulesService {
  constructor(private readonly db: DatabaseClient) {}

  async list(auth: AuthContext, projectId: string) {
    await ensureProject(this.db, auth, projectId);
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
    const fields = moduleIds.length
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
    const fieldsByModule = new Map<string, typeof fields>();
    for (const field of fields) {
      const items = fieldsByModule.get(field.moduleId) ?? [];
      items.push(field);
      fieldsByModule.set(field.moduleId, items);
    }
    const templates = await this.db
      .select({ id: moduleTemplates.id, sourceSystemTemplateId: moduleTemplates.sourceSystemTemplateId })
      .from(moduleTemplates)
      .where(and(eq(moduleTemplates.tenantId, auth.tenantId), isNull(moduleTemplates.deletedAt)));
    const fixedTemplateIds = new Set(
      templates.filter((template) => template.sourceSystemTemplateId !== null).map((template) => template.id),
    );

    return modules.map((module) =>
      serializeModule(module, fieldsByModule.get(module.id) ?? [], {
        isSystemFixed: module.sourceTemplateId !== null && fixedTemplateIds.has(module.sourceTemplateId),
      }),
    );
  }

  async create(auth: AuthContext, projectId: string, input: unknown) {
    assertModuleEditor(auth);
    await ensureProject(this.db, auth, projectId);
    const payload = parseJson(createModuleRequestSchema, input);
    const existingByKey = await this.findByKey(auth, projectId, payload.key);
    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("MODULE_KEY_EXISTS", "模块 key 已存在。", 409);
    }
    if (existingByKey && existingByKey.kind !== payload.kind) {
      throw new ApiError("MODULE_KEY_EXISTS", "已删除模块使用相同 key 且类型不同。", 409);
    }

    const values = {
      sourceTemplateId: null,
      name: payload.name,
      kind: payload.kind,
      description: payload.description ?? null,
      icon: null,
      sortKey: appendSortKey(),
      deletedAt: null,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    };
    const [module] = existingByKey
      ? await this.db
          .update(projectModules)
          .set(values)
          .where(
            and(
              eq(projectModules.id, existingByKey.id),
              eq(projectModules.tenantId, auth.tenantId),
              eq(projectModules.projectId, projectId),
            ),
          )
          .returning()
      : await this.db
          .insert(projectModules)
          .values({
            tenantId: auth.tenantId,
            projectId,
            key: payload.key,
            ...values,
            createdBy: auth.userId,
            createdAt: new Date(),
          })
          .returning();
    if (!module) throw new ApiError("MODULE_CREATE_FAILED", "模块创建失败。", 500);
    return serializeModule(module, await this.getFields(auth, module.id));
  }

  async update(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
    assertModuleEditor(auth);
    const payload = parseJson(updateModuleRequestSchema, input);
    const existing = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(existing, projectId);
    if ((await isProjectModuleFixed(this.db, auth, existing)) && payload.key) {
      throw new ApiError("MODULE_LOCKED", "固定模块不能修改 key。", 422);
    }
    if (payload.key && payload.key !== existing.key) {
      const existingByKey = await this.findByKey(auth, projectId, payload.key);
      if (existingByKey && existingByKey.id !== moduleId) {
        throw new ApiError("MODULE_KEY_EXISTS", "模块 key 已存在。", 409);
      }
    }

    const [module] = await this.db
      .update(projectModules)
      .set({ ...payload, updatedBy: auth.userId, updatedAt: new Date() })
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .returning();
    if (!module) throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    return serializeModule(module, await this.getFields(auth, module.id), {
      isSystemFixed: await isProjectModuleFixed(this.db, auth, module),
    });
  }

  async remove(auth: AuthContext, projectId: string, moduleId: string) {
    assertModuleEditor(auth);
    const existing = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(existing, projectId);
    if (await isProjectModuleFixed(this.db, auth, existing)) {
      throw new ApiError("MODULE_LOCKED", "固定模块不能删除。", 422);
    }

    const now = new Date();
    const [module] = await this.db
      .update(projectModules)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(projectModules.id, moduleId),
          eq(projectModules.tenantId, auth.tenantId),
          isNull(projectModules.deletedAt),
        ),
      )
      .returning();
    if (!module) throw new ApiError("MODULE_NOT_FOUND", "模块不存在。", 404);
    return serializeModule(module, []);
  }

  async upsertField(
    auth: AuthContext,
    projectId: string,
    moduleId: string,
    input: unknown,
  ) {
    assertModuleEditor(auth);
    const payload = parseJson(upsertModuleFieldRequestSchema, input);
    const module = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(module, projectId);
    if (module.kind !== "timeline") {
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
    const existingByKey = await this.findFieldByKey(auth, moduleId, payload.key);

    if (payload.id) {
      const existing = await this.findFieldById(auth, moduleId, payload.id);
      if (!existing || existing.deletedAt) throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      if (existing.type !== payload.type) {
        throw new ApiError("FIELD_TYPE_LOCKED", "项目字段类型创建后不能修改。", 422);
      }
      if (existingByKey && existingByKey.id !== payload.id) {
        throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
      }
      const [field] = await this.db
        .update(projectModuleFields)
        .set(fieldValues)
        .where(
          and(
            eq(projectModuleFields.id, payload.id),
            eq(projectModuleFields.moduleId, moduleId),
            eq(projectModuleFields.tenantId, auth.tenantId),
            isNull(projectModuleFields.deletedAt),
          ),
        )
        .returning();
      if (!field) throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
      return serializeField(field);
    }

    if (existingByKey && !existingByKey.deletedAt) {
      throw new ApiError("FIELD_KEY_EXISTS", "字段 key 已存在。", 409);
    }
    if (existingByKey && existingByKey.type !== payload.type) {
      throw new ApiError("FIELD_TYPE_LOCKED", "已删除项目字段恢复时不能修改类型。", 422);
    }
    const [field] = existingByKey
      ? await this.db
          .update(projectModuleFields)
          .set({ ...fieldValues, deletedAt: null })
          .where(
            and(
              eq(projectModuleFields.id, existingByKey.id),
              eq(projectModuleFields.moduleId, moduleId),
              eq(projectModuleFields.tenantId, auth.tenantId),
            ),
          )
          .returning()
      : await this.db
          .insert(projectModuleFields)
          .values({
            tenantId: auth.tenantId,
            moduleId,
            ...fieldValues,
            sortKey: appendSortKey(),
            createdBy: auth.userId,
            createdAt: new Date(),
          })
          .returning();
    if (!field) throw new ApiError("FIELD_CREATE_FAILED", "字段创建失败。", 500);
    return serializeField(field);
  }

  async removeField(auth: AuthContext, projectId: string, moduleId: string, fieldId: string) {
    assertModuleEditor(auth);
    const module = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(module, projectId);
    if (module.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能配置记录字段。", 422);
    }

    const now = new Date();
    const [field] = await this.db
      .update(projectModuleFields)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(projectModuleFields.id, fieldId),
          eq(projectModuleFields.moduleId, moduleId),
          eq(projectModuleFields.tenantId, auth.tenantId),
          isNull(projectModuleFields.deletedAt),
        ),
      )
      .returning();
    if (!field) throw new ApiError("FIELD_NOT_FOUND", "字段不存在。", 404);
    return serializeField(field);
  }

  private getFields(auth: AuthContext, moduleId: string) {
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

  private async findByKey(auth: AuthContext, projectId: string, key: string) {
    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(
        and(
          eq(projectModules.tenantId, auth.tenantId),
          eq(projectModules.projectId, projectId),
          eq(projectModules.key, key),
        ),
      )
      .limit(1);
    return module ?? null;
  }

  private async findFieldByKey(auth: AuthContext, moduleId: string, key: string) {
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

  private async findFieldById(auth: AuthContext, moduleId: string, fieldId: string) {
    const [field] = await this.db
      .select()
      .from(projectModuleFields)
      .where(
        and(
          eq(projectModuleFields.id, fieldId),
          eq(projectModuleFields.tenantId, auth.tenantId),
          eq(projectModuleFields.moduleId, moduleId),
        ),
      )
      .limit(1);
    return field ?? null;
  }
}
