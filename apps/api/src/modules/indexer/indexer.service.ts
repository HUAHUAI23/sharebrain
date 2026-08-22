// 维护轻量搜索读模型并投递 durable 知识索引任务，禁止在 HTTP 热路径执行 embedding。
import { cleanupKnowledgeTarget, enqueueKnowledgeIndexJob } from "@sharebrain/db";
import {
  documents,
  moduleRecords,
  projectModules,
  projects,
  searchItems,
} from "@sharebrain/db/schema";
import { tokenizeForSearch } from "@sharebrain/knowledge";
import { and, eq, isNull } from "drizzle-orm";

import type { AuthContext } from "@sharebrain/contracts";
import type { DatabaseClient } from "@sharebrain/db";

export function extractTextFromPlate(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractTextFromPlate).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const childText = extractTextFromPlate(record.children);
  return [ownText, childText].filter(Boolean).join("");
}

export class IndexerService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly knowledgeIndexEnabled = true,
  ) {}

  async indexDocument(
    auth: AuthContext,
    documentId: string,
    plateJson: unknown,
    explicitPlainText?: string,
    revisionId?: string | null,
  ) {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!document) return;

    const plainText = explicitPlainText ?? extractTextFromPlate(plateJson);
    const content = plainText || document.title;
    await this.replaceSearchItem(auth, {
      projectId: document.projectId,
      entityType: "document",
      entityId: document.id,
      documentId: document.id,
      moduleRecordId: null,
      title: document.title,
      subtitle: null,
      content,
      pathText: document.title,
      metadata: {},
    });

    if (this.knowledgeIndexEnabled && revisionId) {
      await enqueueKnowledgeIndexJob(this.db, {
        tenantId: auth.tenantId,
        targetType: "document",
        targetId: document.id,
        revisionId,
        reason: "revision_sealed",
        actorId: auth.userId,
      });
    }
  }

  async enqueueDocument(auth: AuthContext, documentId: string, revisionId?: string | null) {
    if (!this.knowledgeIndexEnabled) return;
    await enqueueKnowledgeIndexJob(this.db, {
      tenantId: auth.tenantId,
      targetType: "document",
      targetId: documentId,
      ...(revisionId !== undefined ? { revisionId } : {}),
      reason: revisionId ? "revision_sealed" : "manual",
      actorId: auth.userId,
    });
  }

  async removeDocument(auth: AuthContext, documentId: string) {
    await cleanupKnowledgeTarget(this.db, {
      tenantId: auth.tenantId,
      targetType: "document",
      targetId: documentId,
      actorId: auth.userId,
    });
    if (!this.knowledgeIndexEnabled) return;
    await enqueueKnowledgeIndexJob(this.db, {
      tenantId: auth.tenantId,
      targetType: "document",
      targetId: documentId,
      reason: "deleted",
      actorId: auth.userId,
    });
  }

  async indexModuleRecord(auth: AuthContext, recordId: string) {
    const [record] = await this.db
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
    if (!record) return;

    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(eq(projectModules.id, record.moduleId))
      .limit(1);
    const fieldText = Object.values(record.values)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value))
      .join(" ");
    const content = [record.title, fieldText].filter(Boolean).join("\n");
    await this.replaceSearchItem(auth, {
      projectId: record.projectId,
      entityType: "module_record",
      entityId: record.id,
      documentId: null,
      moduleRecordId: record.id,
      title: record.title,
      subtitle: module?.name ?? null,
      content,
      pathText: module ? `${module.name} / ${record.title}` : record.title,
      metadata: { moduleId: record.moduleId },
    });

    if (this.knowledgeIndexEnabled) {
      await enqueueKnowledgeIndexJob(this.db, {
        tenantId: auth.tenantId,
        targetType: "module_record",
        targetId: record.id,
        reason: "record_changed",
        actorId: auth.userId,
      });
    }
  }

  async removeModuleRecord(auth: AuthContext, recordId: string) {
    await this.removeSearchItem(auth, "module_record", recordId);
    if (!this.knowledgeIndexEnabled) return;
    await enqueueKnowledgeIndexJob(this.db, {
      tenantId: auth.tenantId,
      targetType: "module_record",
      targetId: recordId,
      reason: "deleted",
      actorId: auth.userId,
    });
  }

  async indexProject(auth: AuthContext, projectId: string) {
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
    if (!project) return;

    const content = [project.name, project.description, ...project.tags].filter(Boolean).join("\n");
    await this.replaceSearchItem(auth, {
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
      documentId: null,
      moduleRecordId: null,
      title: project.name,
      subtitle: null,
      content,
      pathText: project.name,
      metadata: {},
    });
    if (this.knowledgeIndexEnabled) {
      await enqueueKnowledgeIndexJob(this.db, {
        tenantId: auth.tenantId,
        targetType: "project",
        targetId: project.id,
        reason: "project_changed",
        actorId: auth.userId,
      });
    }
  }

  async removeProject(auth: AuthContext, projectId: string) {
    await this.removeSearchItem(auth, "project", projectId);
    if (!this.knowledgeIndexEnabled) return;
    await enqueueKnowledgeIndexJob(this.db, {
      tenantId: auth.tenantId,
      targetType: "project",
      targetId: projectId,
      reason: "deleted",
      actorId: auth.userId,
    });
  }

  private async removeSearchItem(auth: AuthContext, entityType: string, entityId: string) {
    await this.db
      .delete(searchItems)
      .where(
        and(
          eq(searchItems.tenantId, auth.tenantId),
          eq(searchItems.entityType, entityType),
          eq(searchItems.entityId, entityId),
        ),
      );
  }

  private async replaceSearchItem(
    auth: AuthContext,
    input: {
      projectId: string;
      entityType: string;
      entityId: string;
      documentId: string | null;
      moduleRecordId: string | null;
      title: string;
      subtitle: string | null;
      content: string;
      pathText: string;
      metadata: Record<string, unknown>;
    },
  ) {
    await this.removeSearchItem(auth, input.entityType, input.entityId);
    await this.db.insert(searchItems).values({
      tenantId: auth.tenantId,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      documentId: input.documentId,
      moduleRecordId: input.moduleRecordId,
      title: input.title,
      subtitle: input.subtitle,
      content: input.content,
      searchText: tokenizeForSearch(
        [input.title, input.subtitle, input.pathText, input.content].filter(Boolean).join("\n"),
      ),
      pathText: input.pathText,
      tags: [],
      metadata: input.metadata,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
  }
}
