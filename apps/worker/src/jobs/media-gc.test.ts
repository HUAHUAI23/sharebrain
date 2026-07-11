import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { createDatabaseClient, syncDocumentInlineMediaUsages } from "@sharebrain/db";
import {
  mediaDeletionJobs,
  mediaObjects,
  mediaUploads,
  mediaUsages,
  tenantMemberships,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { eq } from "drizzle-orm";

import { assertMediaBucketVersioning, runMediaGarbageCollection } from "./media-gc";

const tenantId = "00000000-0000-4000-9200-000000000101";
const userId = "00000000-0000-4000-9200-000000000001";
const mediaIds = {
  success: "00000000-0000-4000-9300-000000000001",
  failure: "00000000-0000-4000-9300-000000000002",
  stale: "00000000-0000-4000-9300-000000000003",
  referenced: "00000000-0000-4000-9300-000000000004",
  restored: "00000000-0000-4000-9300-000000000005",
};
const env = loadServerEnv({
  ...process.env,
  MEDIA_GC_BATCH_SIZE: "50",
  MEDIA_GC_PROCESSING_TIMEOUT_SECONDS: "300",
});
const db = createDatabaseClient(env.DATABASE_URL);

async function cleanup() {
  await db.delete(mediaUsages).where(eq(mediaUsages.tenantId, tenantId));
  await db.delete(mediaDeletionJobs).where(eq(mediaDeletionJobs.tenantId, tenantId));
  await db.delete(mediaUploads).where(eq(mediaUploads.tenantId, tenantId));
  await db.delete(mediaObjects).where(eq(mediaObjects.tenantId, tenantId));
  await db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
  await db.delete(users).where(eq(users.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  await db.insert(tenants).values({
    id: tenantId,
    tenantId,
    name: "Worker GC test",
    kind: "personal",
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: "worker-gc-test@sharebrain.local",
    displayName: "Worker GC Test",
    status: "active",
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenantMemberships).values({
    tenantId,
    userId,
    role: "admin",
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await cleanup();
  await db.$client.end({ timeout: 1 });
});

describe("media garbage collection", () => {
  test("deletes by recorded bucket, retries failures, and safely reclaims stale jobs", async () => {
    const now = new Date("2026-07-10T06:00:00.000Z");
    const staleAt = new Date(now.getTime() - 10 * 60 * 1000);
    await db.insert(mediaObjects).values(
      Object.entries(mediaIds).map(([name, id]) => ({
        id,
        tenantId,
        bucket: "worker-test-bucket",
        objectKey: `gc/${name}.webp`,
        fileName: `${name}.webp`,
        mimeType: "image/webp",
        byteSize: 128,
        purpose: "avatar",
        status: name === "restored" ? "active" : name === "stale" ? "deleting" : "pending_delete",
        deletedAt: name === "restored" ? null : now,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: name === "stale" ? staleAt : now,
      })),
    );
    await db.insert(mediaDeletionJobs).values(
      Object.entries(mediaIds).map(([name, mediaId]) => ({
        tenantId,
        mediaId,
        status: name === "stale" ? "processing" : "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: name === "stale" ? staleAt : now,
      })),
    );
    await db.insert(mediaUsages).values({
      tenantId,
      mediaId: mediaIds.referenced,
      resourceType: "user",
      resourceId: userId,
      usageKind: "avatar",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const deleteCalls: Array<{ bucket: string; key: string }> = [];
    const storage = {
      deleteObject: async (bucket: string, key: string) => {
        deleteCalls.push({ bucket, key });
        if (key.endsWith("failure.webp")) {
          throw new Error("object storage unavailable");
        }
      },
    };
    const first = await runMediaGarbageCollection(db, env, storage, { now, tenantId });

    expect(first).toMatchObject({ purgedMedia: 2, failedDeletions: 1 });
    expect(deleteCalls).toContainEqual({ bucket: "worker-test-bucket", key: "gc/success.webp" });
    expect(deleteCalls).toContainEqual({ bucket: "worker-test-bucket", key: "gc/stale.webp" });
    expect(deleteCalls.some((call) => call.key === "gc/referenced.webp")).toBe(false);
    expect(deleteCalls.some((call) => call.key === "gc/restored.webp")).toBe(false);

    const jobs = await db.select().from(mediaDeletionJobs).where(eq(mediaDeletionJobs.tenantId, tenantId));
    expect(jobs.find((job) => job.mediaId === mediaIds.success)?.status).toBe("completed");
    expect(jobs.find((job) => job.mediaId === mediaIds.stale)?.status).toBe("completed");
    expect(jobs.find((job) => job.mediaId === mediaIds.failure)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "object storage unavailable",
    });
    expect(jobs.find((job) => job.mediaId === mediaIds.referenced)?.status).toBe("cancelled");
    expect(jobs.find((job) => job.mediaId === mediaIds.restored)?.status).toBe("cancelled");

    const callsAfterFirstRun = deleteCalls.length;
    const immediateRetry = await runMediaGarbageCollection(db, env, storage, { now, tenantId });
    expect(immediateRetry.purgedMedia).toBe(0);
    expect(deleteCalls).toHaveLength(callsAfterFirstRun);

    await db
      .update(mediaDeletionJobs)
      .set({ nextAttemptAt: new Date(now.getTime() - 1) })
      .where(eq(mediaDeletionJobs.mediaId, mediaIds.failure));
    const successfulRetry = await runMediaGarbageCollection(
      db,
      env,
      {
        deleteObject: async (bucket, key) => {
          deleteCalls.push({ bucket, key });
        },
      },
      { now, tenantId },
    );
    expect(successfulRetry.purgedMedia).toBe(1);

    const finalRun = await runMediaGarbageCollection(db, env, storage, { now, tenantId });
    expect(finalRun).toMatchObject({ purgedMedia: 0, failedDeletions: 0 });
  });

  test("prevents usage restoration after deletion crosses the deleting barrier", async () => {
    const now = new Date("2026-07-10T06:00:00.000Z");
    const mediaId = "00000000-0000-4000-9300-000000000006";
    await db.insert(mediaObjects).values({
      id: mediaId,
      tenantId,
      bucket: "worker-test-bucket",
      objectKey: "gc/concurrent.webp",
      fileName: "concurrent.webp",
      mimeType: "image/webp",
      byteSize: 128,
      purpose: "inline",
      status: "pending_delete",
      deletedAt: now,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(mediaDeletionJobs).values({
      tenantId,
      mediaId,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    let signalDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    let releaseDelete: (() => void) | undefined;
    const deleteReleased = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const collection = runMediaGarbageCollection(
      db,
      env,
      {
        deleteObject: async () => {
          signalDeleteStarted?.();
          await deleteReleased;
        },
      },
      { now, tenantId },
    );

    await deleteStarted;
    const syncResult = await syncDocumentInlineMediaUsages(db, {
      tenantId,
      documentId: "00000000-0000-4000-9400-000000000001",
      mediaIds: [mediaId],
      userId,
      now,
    });
    expect(syncResult.activeMedia).toBe(0);
    const activeUsages = await db
      .select()
      .from(mediaUsages)
      .where(eq(mediaUsages.mediaId, mediaId));
    expect(activeUsages).toHaveLength(0);

    releaseDelete?.();
    const result = await collection;
    expect(result.purgedMedia).toBe(1);
    const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId));
    expect(media?.status).toBe("purged");
  });

  test("rejects versioned buckets because a key delete cannot prove physical purge", () => {
    expect(() => assertMediaBucketVersioning("Enabled")).toThrow("unversioned bucket");
    expect(() => assertMediaBucketVersioning("Suspended")).toThrow("unversioned bucket");
    expect(() => assertMediaBucketVersioning(undefined)).not.toThrow();
  });
});
