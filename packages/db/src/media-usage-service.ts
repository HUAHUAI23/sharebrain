import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { mediaObjects, mediaUsages } from "./schema";

type MediaUsageClient = Pick<DatabaseClient, "insert" | "select" | "update">;

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
  const now = input.now ?? new Date();
  const mediaIds = [...new Set(input.mediaIds)];
  let activeMediaIds: string[] = [];

  if (mediaIds.length > 0) {
    const reusableMedia = await db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.tenantId, input.tenantId),
          inArray(mediaObjects.id, mediaIds),
          inArray(mediaObjects.status, ["active", "deleted"]),
        ),
      );

    activeMediaIds = reusableMedia.map((media) => media.id);

    if (activeMediaIds.length > 0) {
      await db
        .update(mediaObjects)
        .set({
          status: "active",
          deletedAt: null,
          updatedBy: input.userId,
          updatedAt: now,
        })
        .where(and(eq(mediaObjects.tenantId, input.tenantId), inArray(mediaObjects.id, activeMediaIds)));

      for (const mediaId of activeMediaIds) {
        await upsertMediaUsageWithClient(db, {
          tenantId: input.tenantId,
          mediaId,
          resourceType: "document",
          resourceId: input.documentId,
          usageKind: "inline",
          userId: input.userId,
          now,
        });
      }
    }
  }

  const removeConditions = [
    eq(mediaUsages.tenantId, input.tenantId),
    eq(mediaUsages.resourceType, "document"),
    eq(mediaUsages.resourceId, input.documentId),
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
