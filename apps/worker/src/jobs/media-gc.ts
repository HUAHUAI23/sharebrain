import { mediaObjects, mediaUploads, mediaUsages } from "@sharebrain/db/schema";
import { and, eq, isNull, lt, notExists, sql } from "drizzle-orm";

import type { AuthContext } from "@sharebrain/contracts";
import type { DatabaseClient } from "@sharebrain/db";

export type MediaGcResult = {
  expiredUploads: number;
  orphanedMedia: number;
};

export async function runMediaGarbageCollection(db: DatabaseClient, auth: AuthContext): Promise<MediaGcResult> {
  const now = new Date();
  const expiredUploads = await db
    .update(mediaUploads)
    .set({
      status: "expired",
      deletedAt: now,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaUploads.tenantId, auth.tenantId),
        eq(mediaUploads.status, "pending"),
        lt(mediaUploads.expiresAt, now),
        isNull(mediaUploads.deletedAt),
      ),
    )
    .returning({ id: mediaUploads.id });

  const graceDate = new Date(now.getTime() - 60 * 60 * 1000);
  const orphanedMedia = await db
    .update(mediaObjects)
    .set({
      status: "deleted",
      deletedAt: now,
      updatedBy: auth.userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaObjects.tenantId, auth.tenantId),
        eq(mediaObjects.status, "active"),
        lt(mediaObjects.createdAt, graceDate),
        isNull(mediaObjects.deletedAt),
        notExists(
          db
            .select({ id: mediaUsages.id })
            .from(mediaUsages)
            .where(and(eq(mediaUsages.mediaId, mediaObjects.id), isNull(mediaUsages.deletedAt))),
        ),
      ),
    )
    .returning({ id: mediaObjects.id });

  await db.execute(sql`select 1`);

  return {
    expiredUploads: expiredUploads.length,
    orphanedMedia: orphanedMedia.length,
  };
}
