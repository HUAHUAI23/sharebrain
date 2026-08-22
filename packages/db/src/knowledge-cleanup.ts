// 同步清理已删除知识来源的派生数据，并让 Worker 重试时复用同一套规则。
import { and, eq, inArray, or } from "drizzle-orm";

import {
  documentChunks,
  knowledgeEdges,
  knowledgeEmbeddings,
  knowledgeSourceScores,
  searchItems,
} from "./schema";
import { refreshKnowledgeConceptCounts } from "./knowledge-concept-counts";

import type { DatabaseClient } from "./client";

type KnowledgeCleanupClient = Pick<DatabaseClient, "delete" | "select" | "update">;

export async function cleanupKnowledgeTarget(
  db: DatabaseClient,
  input: {
    tenantId: string;
    targetType: "document" | "module_record" | "project";
    targetId: string;
    actorId: string;
    now?: Date;
  },
) {
  return db.transaction((tx) => cleanupKnowledgeTargetRows(tx, input));
}

async function cleanupKnowledgeTargetRows(
  db: KnowledgeCleanupClient,
  input: {
    tenantId: string;
    targetType: "document" | "module_record" | "project";
    targetId: string;
    actorId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const affectedConcepts = input.targetType === "document" || input.targetType === "project"
    ? await db
        .select({ id: knowledgeEdges.targetId })
        .from(knowledgeEdges)
        .where(
          and(
            eq(knowledgeEdges.tenantId, input.tenantId),
            eq(knowledgeEdges.sourceType, "document"),
            input.targetType === "document"
              ? eq(knowledgeEdges.sourceId, input.targetId)
              : eq(knowledgeEdges.sourceProjectId, input.targetId),
            eq(knowledgeEdges.targetType, "concept"),
            eq(knowledgeEdges.relation, "mentions"),
          ),
        )
    : [];

  if (input.targetType === "document") {
    const chunks = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.tenantId, input.tenantId),
          eq(documentChunks.documentId, input.targetId),
        ),
      );
    if (chunks.length > 0) {
      await db.delete(knowledgeEmbeddings).where(
        and(
          eq(knowledgeEmbeddings.tenantId, input.tenantId),
          eq(knowledgeEmbeddings.ownerType, "document_chunk"),
          inArray(knowledgeEmbeddings.ownerId, chunks.map((chunk) => chunk.id)),
        ),
      );
    }
    await db.delete(documentChunks).where(and(
      eq(documentChunks.tenantId, input.tenantId),
      eq(documentChunks.documentId, input.targetId),
    ));
  }

  if (input.targetType === "project") {
    await db.delete(documentChunks).where(and(
      eq(documentChunks.tenantId, input.tenantId),
      eq(documentChunks.projectId, input.targetId),
    ));
  }

  await db.delete(knowledgeEmbeddings).where(
    and(
      eq(knowledgeEmbeddings.tenantId, input.tenantId),
      input.targetType === "project"
        ? or(
            eq(knowledgeEmbeddings.projectId, input.targetId),
            and(
              eq(knowledgeEmbeddings.ownerType, "project"),
              eq(knowledgeEmbeddings.ownerId, input.targetId),
            ),
          )
        : and(
            eq(knowledgeEmbeddings.ownerType, input.targetType),
            eq(knowledgeEmbeddings.ownerId, input.targetId),
          ),
    ),
  );

  await db.delete(knowledgeEdges).where(
    and(
      eq(knowledgeEdges.tenantId, input.tenantId),
      or(
        and(eq(knowledgeEdges.sourceType, input.targetType), eq(knowledgeEdges.sourceId, input.targetId)),
        and(eq(knowledgeEdges.targetType, input.targetType), eq(knowledgeEdges.targetId, input.targetId)),
        input.targetType === "project"
          ? or(
              eq(knowledgeEdges.sourceProjectId, input.targetId),
              eq(knowledgeEdges.targetProjectId, input.targetId),
            )
          : undefined,
      ),
    ),
  );

  await db.delete(knowledgeSourceScores).where(and(
    eq(knowledgeSourceScores.tenantId, input.tenantId),
    input.targetType === "project"
      ? and(eq(knowledgeSourceScores.sourceType, "project"), eq(knowledgeSourceScores.sourceId, input.targetId))
      : and(
          eq(knowledgeSourceScores.sourceType, input.targetType),
          eq(knowledgeSourceScores.sourceId, input.targetId),
        ),
  ));

  await db.delete(searchItems).where(
    and(
      eq(searchItems.tenantId, input.tenantId),
      input.targetType === "project"
        ? eq(searchItems.projectId, input.targetId)
        : and(
            eq(searchItems.entityType, input.targetType),
            eq(searchItems.entityId, input.targetId),
          ),
    ),
  );

  if (affectedConcepts.length > 0) {
    await refreshKnowledgeConceptCounts(
      db,
      input.tenantId,
      affectedConcepts.map((concept) => concept.id),
      input.actorId,
      now,
    );
  }

  return { deleted: true };
}
