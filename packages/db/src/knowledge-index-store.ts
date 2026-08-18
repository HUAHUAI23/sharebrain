import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { knowledgeIndexJobs } from "./schema";

import type { DatabaseClient } from "./client";

type KnowledgeJobClient = Pick<
  DatabaseClient,
  "delete" | "execute" | "insert" | "select" | "update"
>;

export type EnqueueKnowledgeIndexJobInput = {
  tenantId: string;
  targetType: "document" | "module_record" | "project";
  targetId: string;
  revisionId?: string | null;
  reason:
    | "revision_sealed"
    | "record_changed"
    | "project_changed"
    | "deleted"
    | "model_migration"
    | "manual";
  actorId: string;
  now?: Date;
};

export async function enqueueKnowledgeIndexJob(
  db: KnowledgeJobClient,
  input: EnqueueKnowledgeIndexJobInput,
) {
  const now = input.now ?? new Date();
  const [updated] = await db
    .update(knowledgeIndexJobs)
    .set({
      tenantId: input.tenantId,
      revisionId: input.revisionId ?? null,
      reason: input.reason,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      processingAt: null,
      leaseId: null,
      completedAt: null,
      lastError: null,
      updatedBy: input.actorId,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeIndexJobs.tenantId, input.tenantId),
        eq(knowledgeIndexJobs.targetType, input.targetType),
        eq(knowledgeIndexJobs.targetId, input.targetId),
        inArray(knowledgeIndexJobs.status, ["pending", "processing"]),
        isNull(knowledgeIndexJobs.deletedAt),
      ),
    )
    .returning();
  if (updated) return updated;

  const [inserted] = await db
    .insert(knowledgeIndexJobs)
    .values({
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      revisionId: input.revisionId ?? null,
      reason: input.reason,
      nextAttemptAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [winner] = await db
    .select()
    .from(knowledgeIndexJobs)
    .where(
      and(
        eq(knowledgeIndexJobs.tenantId, input.tenantId),
        eq(knowledgeIndexJobs.targetType, input.targetType),
        eq(knowledgeIndexJobs.targetId, input.targetId),
        inArray(knowledgeIndexJobs.status, ["pending", "processing"]),
        isNull(knowledgeIndexJobs.deletedAt),
      ),
    )
    .limit(1);
  return winner ?? null;
}

export async function claimKnowledgeIndexJobs(
  db: DatabaseClient,
  input: { batchSize: number; processingTimeoutSeconds: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - input.processingTimeoutSeconds * 1000);
  const leaseId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(knowledgeIndexJobs)
      .where(
        and(
          isNull(knowledgeIndexJobs.deletedAt),
          or(
            and(
              inArray(knowledgeIndexJobs.status, ["pending", "failed"]),
              lte(knowledgeIndexJobs.nextAttemptAt, now),
            ),
            and(
              eq(knowledgeIndexJobs.status, "processing"),
              lt(knowledgeIndexJobs.processingAt, staleBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(knowledgeIndexJobs.nextAttemptAt), asc(knowledgeIndexJobs.id))
      .limit(input.batchSize)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    const claimed = [];
    for (const candidate of candidates) {
      const [row] = await tx
        .update(knowledgeIndexJobs)
        .set({
          status: "processing",
          processingAt: now,
          leaseId,
          attempts: candidate.attempts + 1,
          updatedAt: now,
        })
        .where(eq(knowledgeIndexJobs.id, candidate.id))
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  });
}

export async function completeKnowledgeIndexJob(
  db: KnowledgeJobClient,
  input: { id: string; leaseId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const [completed] = await db
    .update(knowledgeIndexJobs)
    .set({
      status: "completed",
      completedAt: now,
      processingAt: null,
      leaseId: null,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeIndexJobs.id, input.id),
        eq(knowledgeIndexJobs.status, "processing"),
        eq(knowledgeIndexJobs.leaseId, input.leaseId),
      ),
    )
    .returning({ id: knowledgeIndexJobs.id });
  return !!completed;
}

export async function failKnowledgeIndexJob(
  db: KnowledgeJobClient,
  input: { id: string; leaseId: string; error: unknown; now?: Date },
) {
  const now = input.now ?? new Date();
  const [current] = await db
    .select({ attempts: knowledgeIndexJobs.attempts })
    .from(knowledgeIndexJobs)
    .where(
      and(
        eq(knowledgeIndexJobs.id, input.id),
        eq(knowledgeIndexJobs.status, "processing"),
        eq(knowledgeIndexJobs.leaseId, input.leaseId),
      ),
    )
    .limit(1);
  if (!current) return false;

  const delaySeconds = Math.min(3600, 2 ** Math.min(current.attempts, 10) * 5);
  const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);
  const message = summarizeKnowledgeIndexError(input.error);
  const [failed] = await db
    .update(knowledgeIndexJobs)
    .set({
      status: "failed",
      nextAttemptAt,
      processingAt: null,
      leaseId: null,
      lastError: message.slice(0, 1000),
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeIndexJobs.id, input.id),
        eq(knowledgeIndexJobs.status, "processing"),
        eq(knowledgeIndexJobs.leaseId, input.leaseId),
      ),
    )
    .returning({ id: knowledgeIndexJobs.id });
  return !!failed;
}

export function summarizeKnowledgeIndexError(error: unknown) {
  if (!(error instanceof Error)) return "UnknownError";
  const record = error as Error & { code?: unknown; status?: unknown; statusCode?: unknown };
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : "Error";
  const code = typeof record.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(record.code)
    ? record.code
    : null;
  const rawStatus = record.statusCode ?? record.status;
  const status = typeof rawStatus === "number" && Number.isInteger(rawStatus)
    ? rawStatus
    : null;
  return [name, code ? `code=${code}` : null, status ? `status=${status}` : null]
    .filter(Boolean)
    .join(" ");
}
