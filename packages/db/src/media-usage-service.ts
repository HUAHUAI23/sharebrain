import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { mediaDeletionJobs, mediaObjects, mediaUsages } from "./schema";

type MediaUsageClient = Pick<DatabaseClient, "execute" | "insert" | "select" | "update">;

export class MediaUsageUnavailableError extends Error {
  constructor(
    readonly mediaId: string,
    readonly status: string | null,
  ) {
    super(`Media ${mediaId} cannot accept a usage in status ${status ?? "missing"}`);
    this.name = "MediaUsageUnavailableError";
  }
}

export type MediaUsageReference = {
  tenantId: string;
  mediaId: string;
  resourceType: string;
  resourceId: string;
  usageKind: string;
  metadata?: Record<string, unknown>;
  userId: string;
  now?: Date;
};

export type DocumentInlineMediaUsageSyncInput = {
  tenantId: string;
  documentId: string;
  mediaIds: string[];
  userId: string;
  now?: Date;
};

export type InlineMediaUsageSyncInput = {
  tenantId: string;
  resourceType: "document" | "document_version" | "document_revision";
  resourceId: string;
  mediaIds: string[];
  metadata?: Record<string, unknown>;
  userId: string;
  now?: Date;
};

export async function upsertMediaUsage(
  db: DatabaseClient,
  input: MediaUsageReference,
) {
  return db.transaction((tx) => upsertMediaUsageWithClient(tx, input));
}

export async function upsertMediaUsageWithClient(
  db: MediaUsageClient,
  input: MediaUsageReference,
) {
  const now = input.now ?? new Date();
  const [media] = await lockMediaRows(db, input.tenantId, [input.mediaId]);
  if (!media || !isReusableMediaStatus(media.status)) {
    throw new MediaUsageUnavailableError(input.mediaId, media?.status ?? null);
  }

  await restoreMediaForUsage(db, input.tenantId, [media.id], input.userId, now);
  await upsertMediaUsageRow(db, input, now);
}

async function upsertMediaUsageRow(
  db: MediaUsageClient,
  input: MediaUsageReference,
  now: Date,
) {
  await db
    .insert(mediaUsages)
    .values({
      tenantId: input.tenantId,
      mediaId: input.mediaId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      usageKind: input.usageKind,
      metadata: input.metadata ?? {},
      createdBy: input.userId,
      updatedBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [mediaUsages.mediaId, mediaUsages.resourceType, mediaUsages.resourceId, mediaUsages.usageKind],
      set: {
        metadata: input.metadata ?? {},
        deletedAt: null,
        updatedBy: input.userId,
        updatedAt: now,
      },
    });
}

export async function syncDocumentInlineMediaUsages(
  db: DatabaseClient,
  input: DocumentInlineMediaUsageSyncInput,
) {
  return db.transaction((tx) => syncDocumentInlineMediaUsagesWithClient(tx, input));
}

export async function syncDocumentInlineMediaUsagesWithClient(
  db: MediaUsageClient,
  input: DocumentInlineMediaUsageSyncInput,
) {
  return syncInlineMediaUsagesWithClient(db, {
    tenantId: input.tenantId,
    resourceType: "document",
    resourceId: input.documentId,
    mediaIds: input.mediaIds,
    userId: input.userId,
    ...(input.now ? { now: input.now } : {}),
  });
}

export async function syncInlineMediaUsagesWithClient(
  db: MediaUsageClient,
  input: InlineMediaUsageSyncInput,
) {
  const now = input.now ?? new Date();
  const mediaIds = [...new Set(input.mediaIds)];
  let activeMediaIds: string[] = [];

  if (mediaIds.length > 0) {
    const lockedMedia = await lockMediaRows(db, input.tenantId, mediaIds);
    const reusableMedia = lockedMedia.filter((media) => isReusableMediaStatus(media.status));

    activeMediaIds = reusableMedia.map((media) => media.id);

    if (activeMediaIds.length > 0) {
      await restoreMediaForUsage(db, input.tenantId, activeMediaIds, input.userId, now);

      for (const mediaId of activeMediaIds) {
        await upsertMediaUsageRow(db, {
          tenantId: input.tenantId,
          mediaId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          usageKind: "inline",
          ...(input.metadata ? { metadata: input.metadata } : {}),
          userId: input.userId,
        }, now);
      }
    }
  }

  const removeConditions = [
    eq(mediaUsages.tenantId, input.tenantId),
    eq(mediaUsages.resourceType, input.resourceType),
    eq(mediaUsages.resourceId, input.resourceId),
    eq(mediaUsages.usageKind, "inline"),
    isNull(mediaUsages.deletedAt),
  ];

  if (activeMediaIds.length > 0) {
    removeConditions.push(notInArray(mediaUsages.mediaId, activeMediaIds));
  }

  const removedUsages = await db
    .update(mediaUsages)
    .set({
      deletedAt: now,
      updatedBy: input.userId,
      updatedAt: now,
    })
    .where(and(...removeConditions))
    .returning({ id: mediaUsages.id });

  return {
    activeMedia: activeMediaIds.length,
    removedUsages: removedUsages.length,
  };
}

function isReusableMediaStatus(status: string) {
  return status === "active" || status === "pending_delete";
}

async function lockMediaRows(db: MediaUsageClient, tenantId: string, mediaIds: string[]) {
  const orderedIds = [...new Set(mediaIds)].sort();
  for (const mediaId of orderedIds) {
    await db.execute(
      sql`select id from media_objects where id = ${mediaId} and tenant_id = ${tenantId} for update`,
    );
  }

  if (orderedIds.length === 0) return [];
  return db
    .select({ id: mediaObjects.id, status: mediaObjects.status })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.tenantId, tenantId), inArray(mediaObjects.id, orderedIds)));
}

async function restoreMediaForUsage(
  db: MediaUsageClient,
  tenantId: string,
  mediaIds: string[],
  userId: string,
  now: Date,
) {
  await db
    .update(mediaObjects)
    .set({
      status: "active",
      deletedAt: null,
      updatedBy: userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaObjects.tenantId, tenantId),
        inArray(mediaObjects.id, mediaIds),
        inArray(mediaObjects.status, ["active", "pending_delete"]),
      ),
    );

  await db
    .update(mediaDeletionJobs)
    .set({
      status: "cancelled",
      completedAt: now,
      updatedBy: userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaDeletionJobs.tenantId, tenantId),
        inArray(mediaDeletionJobs.mediaId, mediaIds),
        inArray(mediaDeletionJobs.status, ["pending", "failed", "processing"]),
      ),
    );
}
