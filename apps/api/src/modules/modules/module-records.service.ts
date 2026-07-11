// 管理 timeline 记录、动态字段值校验和记录搜索索引副作用。
import {
  createModuleRecordRequestSchema,
  updateModuleRecordRequestSchema,
  type AuthContext,
} from "@sharebrain/contracts";
import { documents, moduleRecords, projectModuleFields } from "@sharebrain/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { parseJson } from "../../app/validation";
import { IndexerService } from "../indexer/indexer.service";
import { validateRecordValuePatch, validateRecordValues } from "../shared/dynamic-fields";
import { serializeModuleRecord } from "../shared/serializers";
import { appendSortKey } from "../shared/sort-key";
import { ensureActiveMemberValues } from "./member-values";
import {
  assertModuleEditor,
  assertModuleInProject,
  ensureProjectModule,
} from "./module-access";

import type { DatabaseClient } from "@sharebrain/db";

export class ModuleRecordsService {
  private readonly indexer: IndexerService;

  constructor(private readonly db: DatabaseClient) {
    this.indexer = new IndexerService(db);
  }

  async list(auth: AuthContext, projectId: string, moduleId: string) {
    const module = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(module, projectId);
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
    const documentsByRecord = new Map<string, typeof recordDocuments>();
    for (const document of recordDocuments) {
      if (!document.moduleRecordId) continue;
      const items = documentsByRecord.get(document.moduleRecordId) ?? [];
      items.push(document);
      documentsByRecord.set(document.moduleRecordId, items);
    }

    return records.map((record) =>
      serializeModuleRecord(record, documentsByRecord.get(record.id) ?? []),
    );
  }

  async create(auth: AuthContext, projectId: string, moduleId: string, input: unknown) {
    assertModuleEditor(auth);
    const module = await ensureProjectModule(this.db, auth, moduleId);
    assertModuleInProject(module, projectId);
    if (module.kind !== "timeline") {
      throw new ApiError("MODULE_KIND_INVALID", "collection 模块不能创建记录。", 422);
    }

    const payload = parseJson(createModuleRecordRequestSchema, input);
    const fields = await this.getFields(auth, moduleId);
    const now = new Date();
    const values = validateRecordValues(fields, payload.values, {
      now,
      userId: auth.userId,
      timezoneOffsetMinutes: payload.timezoneOffsetMinutes,
    });
    await ensureActiveMemberValues(this.db, auth, fields, values);
    const [record] = await this.db
      .insert(moduleRecords)
      .values({
        tenantId: auth.tenantId,
        projectId,
        moduleId,
        title: payload.title,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : now,
        values,
        sortKey: appendSortKey(),
        createdBy: auth.userId,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!record) throw new ApiError("RECORD_CREATE_FAILED", "记录创建失败。", 500);

    await this.indexer.indexModuleRecord(auth, record.id);
    return serializeModuleRecord(record, []);
  }

  async update(auth: AuthContext, recordId: string, input: unknown) {
    assertModuleEditor(auth);
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
    if (!existing) throw new ApiError("RECORD_NOT_FOUND", "记录不存在。", 404);

    const fields = await this.getFields(auth, existing.moduleId);
    const patchValues =
      payload.values === undefined ? undefined : validateRecordValuePatch(fields, payload.values);
    if (patchValues) {
      await ensureActiveMemberValues(this.db, auth, fields, patchValues);
    }
    const values = patchValues ? { ...existing.values, ...patchValues } : existing.values;
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
    if (!record) throw new ApiError("RECORD_UPDATE_FAILED", "记录更新失败。", 500);

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

  async remove(auth: AuthContext, recordId: string) {
    assertModuleEditor(auth);
    const now = new Date();
    const [record] = await this.db
      .update(moduleRecords)
      .set({ deletedAt: now, updatedBy: auth.userId, updatedAt: now })
      .where(
        and(
          eq(moduleRecords.id, recordId),
          eq(moduleRecords.tenantId, auth.tenantId),
          isNull(moduleRecords.deletedAt),
        ),
      )
      .returning();
    if (!record) throw new ApiError("RECORD_NOT_FOUND", "记录不存在。", 404);

    await this.indexer.removeModuleRecord(auth, record.id);
    return serializeModuleRecord(record, []);
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
}
