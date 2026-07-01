import { type AuthContext } from "@sharebrain/contracts";
import { searchItems } from "@sharebrain/db/schema";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";

import { toIso } from "../shared/serializers";

import type { DatabaseClient } from "@sharebrain/db";

export class SearchService {
  constructor(private readonly db: DatabaseClient) {}

  async search(auth: AuthContext, query: string) {
    const pattern = `%${query}%`;
    const rows = await this.db
      .select()
      .from(searchItems)
      .where(
        and(
          eq(searchItems.tenantId, auth.tenantId),
          isNull(searchItems.deletedAt),
          or(ilike(searchItems.title, pattern), ilike(searchItems.content, pattern), ilike(searchItems.pathText, pattern)),
        ),
      )
      .orderBy(desc(searchItems.updatedAt))
      .limit(30);

    return rows.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      projectId: item.projectId,
      documentId: item.documentId,
      blockId: item.blockId,
      title: item.title,
      path: item.pathText,
      snippet: item.content.slice(0, 240),
      updatedAt: toIso(item.updatedAt),
    }));
  }
}
