// 统一按 active mentions 边重算概念计数，供索引与治理事务共享同一口径。
import { and, eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { knowledgeConcepts } from "./schema";

type KnowledgeConceptCountClient = Pick<DatabaseClient, "update">;

export async function refreshKnowledgeConceptCounts(
  db: KnowledgeConceptCountClient,
  tenantId: string,
  conceptIds: string[],
  actorId: string,
  now = new Date(),
) {
  for (const conceptId of new Set(conceptIds)) {
    await db
      .update(knowledgeConcepts)
      .set({
        mentionCount: sql<number>`(
          select count(*)::int from knowledge_edges
          where tenant_id = ${tenantId}
            and target_type = 'concept'
            and target_id = ${conceptId}
            and relation = 'mentions'
            and status = 'active'
            and deleted_at is null
        )`,
        projectSpread: sql<number>`(
          select count(distinct source_project_id)::int from knowledge_edges
          where tenant_id = ${tenantId}
            and target_type = 'concept'
            and target_id = ${conceptId}
            and relation = 'mentions'
            and status = 'active'
            and deleted_at is null
        )`,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(and(
        eq(knowledgeConcepts.tenantId, tenantId),
        eq(knowledgeConcepts.id, conceptId),
      ));
  }
}
