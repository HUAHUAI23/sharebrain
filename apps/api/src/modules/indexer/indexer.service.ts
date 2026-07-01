import { documentBlocks, documentChunks, documents, moduleRecords, projectModules, searchItems } from "@sharebrain/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import type { AuthContext } from "@sharebrain/contracts";
import type { DatabaseClient } from "@sharebrain/db";

function extractTextFromPlate(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextFromPlate).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ownText = typeof record.text === "string" ? record.text : "";
    const childText = extractTextFromPlate(record.children);
    return [ownText, childText].filter(Boolean).join("");
  }

  return "";
}

export class IndexerService {
  constructor(private readonly db: DatabaseClient) {}

  async indexDocument(auth: AuthContext, documentId: string, plateJson: unknown, explicitPlainText?: string) {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId), isNull(documents.deletedAt)))
      .limit(1);

    if (!document) {
      return;
    }

    const plainText = explicitPlainText ?? extractTextFromPlate(plateJson);
    await this.db
      .delete(documentBlocks)
      .where(and(eq(documentBlocks.tenantId, auth.tenantId), eq(documentBlocks.documentId, documentId)));
    await this.db
      .delete(documentChunks)
      .where(and(eq(documentChunks.tenantId, auth.tenantId), eq(documentChunks.documentId, documentId)));
    await this.db
      .delete(searchItems)
      .where(and(eq(searchItems.tenantId, auth.tenantId), eq(searchItems.entityType, "document"), eq(searchItems.entityId, documentId)));

    await this.db.insert(searchItems).values({
      tenantId: auth.tenantId,
      projectId: document.projectId,
      entityType: "document",
      entityId: document.id,
      documentId: document.id,
      title: document.title,
      content: plainText || document.title,
      pathText: document.title,
      tags: [],
      metadata: {},
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });

    if (plainText.trim().length > 0) {
      await this.db.insert(documentBlocks).values({
        tenantId: auth.tenantId,
        projectId: document.projectId,
        documentId: document.id,
        blockId: "root",
        blockType: "document",
        path: [0],
        headingPath: [],
        textContent: plainText,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });

      await this.db.insert(documentChunks).values({
        tenantId: auth.tenantId,
        projectId: document.projectId,
        documentId: document.id,
        versionNo: document.currentVersion,
        chunkIndex: 0,
        headingPath: [],
        content: plainText,
        tokenCount: Math.ceil(plainText.length / 4),
        metadata: {},
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
    }
  }

  async indexModuleRecord(auth: AuthContext, recordId: string) {
    const [record] = await this.db
      .select()
      .from(moduleRecords)
      .where(and(eq(moduleRecords.id, recordId), eq(moduleRecords.tenantId, auth.tenantId), isNull(moduleRecords.deletedAt)))
      .limit(1);

    if (!record) {
      return;
    }

    const [module] = await this.db
      .select()
      .from(projectModules)
      .where(eq(projectModules.id, record.moduleId))
      .limit(1);

    const fieldText = Object.values(record.values)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value))
      .join(" ");

    await this.db
      .delete(searchItems)
      .where(and(eq(searchItems.tenantId, auth.tenantId), eq(searchItems.entityType, "module_record"), eq(searchItems.entityId, record.id)));

    await this.db.insert(searchItems).values({
      tenantId: auth.tenantId,
      projectId: record.projectId,
      entityType: "module_record",
      entityId: record.id,
      moduleRecordId: record.id,
      title: record.title,
      subtitle: module?.name ?? null,
      content: [record.title, fieldText].filter(Boolean).join("\n"),
      pathText: module ? `${module.name} / ${record.title}` : record.title,
      tags: [],
      metadata: { moduleId: record.moduleId },
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
  }

  async removeModuleRecord(auth: AuthContext, recordId: string) {
    await this.db
      .delete(searchItems)
      .where(and(eq(searchItems.tenantId, auth.tenantId), eq(searchItems.entityType, "module_record"), eq(searchItems.entityId, recordId)));
  }
}
