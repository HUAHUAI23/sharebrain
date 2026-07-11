import { DeleteObjectCommand, GetBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import {
  mediaDeletionJobs,
  mediaObjects,
  mediaUploads,
  mediaUsages,
} from "@sharebrain/db/schema";
import { and, asc, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";

import type { ServerEnv } from "@sharebrain/config";
import type { DatabaseClient } from "@sharebrain/db";

type ObjectStorage = {
  deleteObject(bucket: string, key: string): Promise<void>;
};

type MediaGcOptions = {
  now?: Date;
  tenantId?: string;
};

export type MediaGcResult = {
  expiredUploads: number;
  orphanedMedia: number;
  purgedMedia: number;
  failedDeletions: number;
};

class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly versioningChecks = new Map<string, Promise<void>>();

  constructor(env: ServerEnv) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async deleteObject(bucket: string, key: string) {
    await this.ensureBucketIsUnversioned(bucket);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  private ensureBucketIsUnversioned(bucket: string) {
    const existing = this.versioningChecks.get(bucket);
    if (existing) return existing;

    const check = this.client
      .send(new GetBucketVersioningCommand({ Bucket: bucket }))
      .then((response) => assertMediaBucketVersioning(response.Status))
      .catch((error) => {
        this.versioningChecks.delete(bucket);
        throw error;
      });
    this.versioningChecks.set(bucket, check);
    return check;
  }
}

export function assertMediaBucketVersioning(status: string | undefined) {
  if (status === "Enabled" || status === "Suspended") {
    throw new Error(`Media deletion requires an unversioned bucket; current status is ${status}`);
  }
}

export async function runMediaGarbageCollection(
  db: DatabaseClient,
  env: ServerEnv,
  storage: ObjectStorage = new S3ObjectStorage(env),
  options: MediaGcOptions = {},
): Promise<MediaGcResult> {
  const now = options.now ?? new Date();
  const staleProcessingDate = new Date(
    now.getTime() - env.MEDIA_GC_PROCESSING_TIMEOUT_SECONDS * 1000,
  );
  const expired = await db
    .select({
      uploadId: mediaUploads.id,
      mediaId: mediaObjects.id,
      tenantId: mediaObjects.tenantId,
      actorId: mediaObjects.updatedBy,
    })
    .from(mediaUploads)
    .innerJoin(mediaObjects, eq(mediaUploads.mediaId, mediaObjects.id))
    .where(
      and(
        eq(mediaUploads.status, "pending"),
        lt(mediaUploads.expiresAt, now),
        isNull(mediaUploads.deletedAt),
        options.tenantId ? eq(mediaObjects.tenantId, options.tenantId) : undefined,
      ),
    )
    .orderBy(asc(mediaUploads.expiresAt), asc(mediaUploads.id))
    .limit(env.MEDIA_GC_BATCH_SIZE);

  let expiredUploads = 0;
  for (const item of expired) {
    const transitioned = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from media_uploads where id = ${item.uploadId} for update`);
      await tx.execute(sql`select id from media_objects where id = ${item.mediaId} for update`);
      const [expiredUpload] = await tx
        .update(mediaUploads)
        .set({ status: "expired", deletedAt: now, updatedAt: now })
        .where(and(eq(mediaUploads.id, item.uploadId), eq(mediaUploads.status, "pending")))
        .returning({ id: mediaUploads.id });
      if (!expiredUpload) return false;

      const [pendingMedia] = await tx
        .update(mediaObjects)
        .set({ status: "pending_delete", deletedAt: now, updatedAt: now })
        .where(and(eq(mediaObjects.id, item.mediaId), eq(mediaObjects.status, "uploading")))
        .returning({ id: mediaObjects.id });
      if (!pendingMedia) return false;

      await queueDeletion(tx, item, now);
      return true;
    });
    if (transitioned) expiredUploads += 1;
  }

  const graceDate = new Date(now.getTime() - 60 * 60 * 1000);
  const orphans = await db
    .select({
      mediaId: mediaObjects.id,
      tenantId: mediaObjects.tenantId,
      actorId: mediaObjects.updatedBy,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.status, "active"),
        lt(mediaObjects.createdAt, graceDate),
        isNull(mediaObjects.deletedAt),
        options.tenantId ? eq(mediaObjects.tenantId, options.tenantId) : undefined,
        notExists(
          db
            .select({ id: mediaUsages.id })
            .from(mediaUsages)
            .where(and(eq(mediaUsages.mediaId, mediaObjects.id), isNull(mediaUsages.deletedAt))),
        ),
      ),
    )
    .orderBy(asc(mediaObjects.createdAt), asc(mediaObjects.id))
    .limit(env.MEDIA_GC_BATCH_SIZE);

  let orphanedMedia = 0;
  for (const item of orphans) {
    const transitioned = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from media_objects where id = ${item.mediaId} for update`);
      const [activeUsage] = await tx
        .select({ id: mediaUsages.id })
        .from(mediaUsages)
        .where(and(eq(mediaUsages.mediaId, item.mediaId), isNull(mediaUsages.deletedAt)))
        .limit(1);
      if (activeUsage) return false;

      const [pendingMedia] = await tx
        .update(mediaObjects)
        .set({ status: "pending_delete", deletedAt: now, updatedAt: now })
        .where(and(eq(mediaObjects.id, item.mediaId), eq(mediaObjects.status, "active")))
        .returning({ id: mediaObjects.id });
      if (!pendingMedia) return false;

      await queueDeletion(tx, item, now);
      return true;
    });
    if (transitioned) orphanedMedia += 1;
  }

  const jobs = await db
    .select({ job: mediaDeletionJobs, media: mediaObjects })
    .from(mediaDeletionJobs)
    .innerJoin(mediaObjects, eq(mediaDeletionJobs.mediaId, mediaObjects.id))
    .where(
      and(
        options.tenantId ? eq(mediaDeletionJobs.tenantId, options.tenantId) : undefined,
        or(
          and(
            inArray(mediaDeletionJobs.status, ["pending", "failed"]),
            lte(mediaDeletionJobs.nextAttemptAt, now),
          ),
          and(
            eq(mediaDeletionJobs.status, "processing"),
            lte(mediaDeletionJobs.updatedAt, staleProcessingDate),
          ),
        ),
      ),
    )
    .orderBy(asc(mediaDeletionJobs.nextAttemptAt), asc(mediaDeletionJobs.createdAt))
    .limit(env.MEDIA_GC_BATCH_SIZE);

  let purgedMedia = 0;
  let failedDeletions = 0;
  for (const row of jobs) {
    const [claimed] = await db
      .update(mediaDeletionJobs)
      .set({ status: "processing", updatedAt: now })
      .where(
        and(
          eq(mediaDeletionJobs.id, row.job.id),
          or(
            and(
              inArray(mediaDeletionJobs.status, ["pending", "failed"]),
              lte(mediaDeletionJobs.nextAttemptAt, now),
            ),
            and(
              eq(mediaDeletionJobs.status, "processing"),
              lte(mediaDeletionJobs.updatedAt, staleProcessingDate),
            ),
          ),
        ),
      )
      .returning({ id: mediaDeletionJobs.id });
    if (!claimed) continue;

    const deletionTarget = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from media_objects where id = ${row.media.id} for update`);
      const [currentJob] = await tx
        .select({ id: mediaDeletionJobs.id })
        .from(mediaDeletionJobs)
        .where(and(eq(mediaDeletionJobs.id, row.job.id), eq(mediaDeletionJobs.status, "processing")))
        .limit(1);
      if (!currentJob) return null;

      const [currentMedia] = await tx
        .select({
          id: mediaObjects.id,
          bucket: mediaObjects.bucket,
          objectKey: mediaObjects.objectKey,
          status: mediaObjects.status,
        })
        .from(mediaObjects)
        .where(eq(mediaObjects.id, row.media.id))
        .limit(1);
      if (!currentMedia) return null;

      const [activeUsage] = await tx
        .select({ id: mediaUsages.id })
        .from(mediaUsages)
        .where(and(eq(mediaUsages.mediaId, currentMedia.id), isNull(mediaUsages.deletedAt)))
        .limit(1);
      if (activeUsage) {
        if (currentMedia.status === "deleting" || currentMedia.status === "purged") {
          await tx
            .update(mediaDeletionJobs)
            .set({
              status: "failed",
              attempts: row.job.attempts + 1,
              nextAttemptAt: new Date(now.getTime() + 60 * 60 * 1000),
              lastError: `Invariant violation: active usage exists while media is ${currentMedia.status}`,
              updatedAt: now,
            })
            .where(eq(mediaDeletionJobs.id, currentJob.id));
          return null;
        }

        await tx
          .update(mediaObjects)
          .set({ status: "active", deletedAt: null, updatedAt: now })
          .where(and(eq(mediaObjects.id, currentMedia.id), inArray(mediaObjects.status, ["active", "pending_delete"])));
        await tx
          .update(mediaDeletionJobs)
          .set({ status: "cancelled", completedAt: now, updatedAt: now })
          .where(eq(mediaDeletionJobs.id, currentJob.id));
        return null;
      }

      if (currentMedia.status === "purged") {
        await tx
          .update(mediaDeletionJobs)
          .set({ status: "completed", completedAt: now, lastError: null, updatedAt: now })
          .where(eq(mediaDeletionJobs.id, currentJob.id));
        return null;
      }
      if (currentMedia.status !== "pending_delete" && currentMedia.status !== "deleting") {
        await tx
          .update(mediaDeletionJobs)
          .set({ status: "cancelled", completedAt: now, updatedAt: now })
          .where(eq(mediaDeletionJobs.id, currentJob.id));
        return null;
      }

      const [deletingMedia] = await tx
        .update(mediaObjects)
        .set({ status: "deleting", updatedAt: now })
        .where(and(eq(mediaObjects.id, currentMedia.id), inArray(mediaObjects.status, ["pending_delete", "deleting"])))
        .returning({ id: mediaObjects.id });
      return deletingMedia ? currentMedia : null;
    });
    if (!deletionTarget) continue;

    try {
      await storage.deleteObject(deletionTarget.bucket, deletionTarget.objectKey);
      const completedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(mediaObjects)
          .set({ status: "purged", purgedAt: completedAt, updatedAt: completedAt })
          .where(and(eq(mediaObjects.id, deletionTarget.id), eq(mediaObjects.status, "deleting")));
        await tx
          .update(mediaDeletionJobs)
          .set({ status: "completed", completedAt, lastError: null, updatedAt: completedAt })
          .where(and(eq(mediaDeletionJobs.id, row.job.id), eq(mediaDeletionJobs.status, "processing")));
      });
      console.info(
        JSON.stringify({
          event: "media_gc_delete_completed",
          jobId: row.job.id,
          mediaId: deletionTarget.id,
          bucket: deletionTarget.bucket,
          objectKey: deletionTarget.objectKey,
        }),
      );
      purgedMedia += 1;
    } catch (error) {
      const attempts = row.job.attempts + 1;
      const retryAt = new Date(now.getTime() + Math.min(2 ** attempts * 30_000, 60 * 60 * 1000));
      const reason = error instanceof Error ? error.message.slice(0, 1000) : "unknown";
      await db.transaction(async (tx) => {
        await tx
          .update(mediaObjects)
          .set({ status: "pending_delete", updatedAt: new Date() })
          .where(and(eq(mediaObjects.id, deletionTarget.id), eq(mediaObjects.status, "deleting")));
        await tx
          .update(mediaDeletionJobs)
          .set({
            status: "failed",
            attempts,
            nextAttemptAt: retryAt,
            lastError: reason,
            updatedAt: new Date(),
          })
          .where(and(eq(mediaDeletionJobs.id, row.job.id), eq(mediaDeletionJobs.status, "processing")));
      });
      console.error(
        JSON.stringify({
          event: "media_gc_delete_failed",
          jobId: row.job.id,
          mediaId: deletionTarget.id,
          bucket: deletionTarget.bucket,
          objectKey: deletionTarget.objectKey,
          reason,
          attempts,
          retryAt: retryAt.toISOString(),
        }),
      );
      failedDeletions += 1;
    }
  }

  return {
    expiredUploads,
    orphanedMedia,
    purgedMedia,
    failedDeletions,
  };
}

async function queueDeletion(
  tx: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  item: { mediaId: string; tenantId: string; actorId: string },
  now: Date,
) {
  await tx
    .insert(mediaDeletionJobs)
    .values({
      tenantId: item.tenantId,
      mediaId: item.mediaId,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdBy: item.actorId,
      updatedBy: item.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mediaDeletionJobs.mediaId,
      set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        completedAt: null,
        updatedAt: now,
      },
    });
}
