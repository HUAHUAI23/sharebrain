// 验证知识索引任务的 tenant 幂等边界、租约状态机、退避和错误信息脱敏。
import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { and, eq, inArray } from "drizzle-orm";

import { createDatabaseClient } from "./client";
import {
  claimKnowledgeIndexJobs,
  completeKnowledgeIndexJob,
  enqueueKnowledgeIndexJob,
  failKnowledgeIndexJob,
  summarizeKnowledgeIndexError,
} from "./knowledge-index-store";
import { knowledgeIndexJobs, tenants, users } from "./schema";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const tenantIds = [crypto.randomUUID(), crypto.randomUUID()];
const actorIds = [crypto.randomUUID(), crypto.randomUUID()];
const sharedTargetId = crypto.randomUUID();
const stateTargetIds = [crypto.randomUUID(), crypto.randomUUID()];

beforeAll(async () => {
  await db.insert(tenants).values(tenantIds.map((id, index) => ({
    id,
    tenantId: id,
    name: `Knowledge job tenant ${index + 1}`,
    createdBy: actorIds[index]!,
    updatedBy: actorIds[index]!,
  })));
  await db.insert(users).values(actorIds.map((id, index) => ({
    id,
    tenantId: tenantIds[index]!,
    email: `knowledge-job-${id}@sharebrain.test`,
    displayName: `Knowledge Job Actor ${index + 1}`,
    createdBy: id,
    updatedBy: id,
  })));
});

afterAll(async () => {
  await db.delete(knowledgeIndexJobs).where(inArray(knowledgeIndexJobs.tenantId, tenantIds));
  await db.delete(users).where(inArray(users.id, actorIds));
  await db.delete(tenants).where(inArray(tenants.id, tenantIds));
  await db.$client.end({ timeout: 1 });
});

describe("knowledge index store", () => {
  test("keeps in-flight deduplication isolated by tenant", async () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    const first = await enqueueKnowledgeIndexJob(db, {
      tenantId: tenantIds[0]!,
      targetType: "document",
      targetId: sharedTargetId,
      reason: "manual",
      actorId: actorIds[0]!,
      now,
    });
    const second = await enqueueKnowledgeIndexJob(db, {
      tenantId: tenantIds[1]!,
      targetType: "document",
      targetId: sharedTargetId,
      reason: "manual",
      actorId: actorIds[1]!,
      now,
    });
    const repeated = await enqueueKnowledgeIndexJob(db, {
      tenantId: tenantIds[0]!,
      targetType: "document",
      targetId: sharedTargetId,
      reason: "deleted",
      actorId: actorIds[0]!,
      now,
    });

    expect(first?.id).not.toBe(second?.id);
    expect(repeated?.id).toBe(first?.id);
    expect(repeated).toMatchObject({ tenantId: tenantIds[0], reason: "deleted" });
    expect(await db.select().from(knowledgeIndexJobs).where(and(
      eq(knowledgeIndexJobs.targetId, sharedTargetId),
      inArray(knowledgeIndexJobs.tenantId, tenantIds),
    ))).toHaveLength(2);
  });

  test("claims with a lease and only completes for the current lease", async () => {
    const now = new Date("1990-01-01T00:00:00.000Z");
    const queued = await enqueueKnowledgeIndexJob(db, {
      tenantId: tenantIds[0]!,
      targetType: "project",
      targetId: stateTargetIds[0]!,
      reason: "manual",
      actorId: actorIds[0]!,
      now,
    });
    const claimed = await claimKnowledgeIndexJobs(db, {
      batchSize: 1,
      processingTimeoutSeconds: 60,
      now,
    });

    expect(claimed[0]).toMatchObject({ id: queued?.id, status: "processing", attempts: 1 });
    expect(await completeKnowledgeIndexJob(db, {
      id: queued!.id,
      leaseId: crypto.randomUUID(),
      now,
    })).toBe(false);
    expect(await completeKnowledgeIndexJob(db, {
      id: queued!.id,
      leaseId: claimed[0]!.leaseId!,
      now,
    })).toBe(true);
  });

  test("backs off failures without persisting provider messages", async () => {
    const now = new Date("1980-01-01T00:00:00.000Z");
    const queued = await enqueueKnowledgeIndexJob(db, {
      tenantId: tenantIds[0]!,
      targetType: "module_record",
      targetId: stateTargetIds[1]!,
      reason: "manual",
      actorId: actorIds[0]!,
      now,
    });
    const [claimed] = await claimKnowledgeIndexJobs(db, {
      batchSize: 1,
      processingTimeoutSeconds: 60,
      now,
    });
    const error = Object.assign(new Error("prompt and api key must not be stored"), {
      name: "AI_APICallError",
      code: "rate_limit_exceeded",
      statusCode: 429,
    });

    expect(await failKnowledgeIndexJob(db, {
      id: queued!.id,
      leaseId: claimed!.leaseId!,
      error,
      now,
    })).toBe(true);
    const [failed] = await db.select().from(knowledgeIndexJobs)
      .where(eq(knowledgeIndexJobs.id, queued!.id));
    expect(failed).toMatchObject({
      status: "failed",
      lastError: "AI_APICallError code=rate_limit_exceeded status=429",
    });
    expect(failed!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(summarizeKnowledgeIndexError("raw provider body")).toBe("UnknownError");
  });
});
