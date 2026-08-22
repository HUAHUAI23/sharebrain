// 验证知识索引的阶段提交、增量向量复用、失败退避与项目删除传播。
import "@sharebrain/config/dotenv";

import { afterAll, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import {
  completeKnowledgeIndexJob,
  createDatabaseClient,
  failKnowledgeIndexJob,
} from "@sharebrain/db";
import {
  auditLogs,
  documentChunks,
  documentRevisions,
  documents,
  KNOWLEDGE_EMBEDDING_DIM,
  knowledgeConceptAliases,
  knowledgeConcepts,
  knowledgeEdges,
  knowledgeEmbeddings,
  knowledgeIndexJobs,
  knowledgeMergeProposals,
  knowledgeSourceScores,
  projectModules,
  projects,
  searchItems,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { processKnowledgeIndexJob } from "./knowledge-indexing";

import type { ServerEnv } from "@sharebrain/config";
import type { DocumentVersionValue } from "@sharebrain/contracts";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const tenantIds: string[] = [];

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function embeddingVector(seed = 1) {
  const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIM).fill(0);
  vector[seed % KNOWLEDGE_EMBEDDING_DIM] = 1;
  return vector;
}

function createModelServer(options: { failEmbeddings?: boolean; failGeneration?: boolean } = {}) {
  const embeddedBatches: number[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/embeddings")) {
        const body = await request.json() as { input?: unknown };
        const values = Array.isArray(body.input) ? body.input : [body.input];
        embeddedBatches.push(values.length);
        if (options.failEmbeddings) {
          return Response.json({ error: { message: "embedding unavailable" } }, { status: 503 });
        }
        return Response.json({
          object: "list",
          data: values.map((_, index) => ({
            object: "embedding",
            index,
            embedding: embeddingVector(index + 1),
          })),
          model: "test-embedding",
          usage: { prompt_tokens: values.length, total_tokens: values.length },
        });
      }
      if (options.failGeneration) {
        return Response.json({ error: { message: "generation unavailable" } }, { status: 503 });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return { server, embeddedBatches };
}

function configuredEnv(server: ReturnType<typeof Bun.serve>, conceptExtraction = false) {
  return loadServerEnv({
    ...process.env,
    AI_BASE_URL: `${server.url}v1`,
    AI_API_KEY: "test-key",
    AI_MODEL: "test-chat",
    AI_EXTRACTION_MODEL: "test-chat",
    AI_EMBEDDING_BASE_URL: `${server.url}v1`,
    AI_EMBEDDING_API_KEY: "test-key",
    AI_EMBEDDING_MODEL: "test-embedding",
    AI_EMBEDDING_BATCH_SIZE: "32",
    KNOWLEDGE_CONCEPT_EXTRACTION_ENABLED: String(conceptExtraction),
  });
}

async function createFixture(input: {
  plateJson?: DocumentVersionValue;
  plainText?: string;
} = {}) {
  const tenantId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const moduleId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const plateJson = input.plateJson ?? [
    { id: "paragraph", type: "p", children: [{ text: "Durable keyword content" }] },
  ];
  const plainText = input.plainText ?? "Durable keyword content";
  tenantIds.push(tenantId);
  await db.insert(tenants).values({
    id: tenantId,
    tenantId,
    name: "Knowledge indexing tenant",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(users).values({
    id: actorId,
    tenantId,
    email: `${actorId}@indexing.test`,
    displayName: "Indexing Actor",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(projects).values({
    id: projectId,
    tenantId,
    name: "Indexing project",
    ownerId: actorId,
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(projectModules).values({
    id: moduleId,
    tenantId,
    projectId,
    key: "documents",
    name: "Documents",
    kind: "documents",
    sortKey: "a0",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(documents).values({
    id: documentId,
    tenantId,
    projectId,
    moduleId,
    title: "Indexing document",
    sortKey: "a0",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(documentRevisions).values({
    id: revisionId,
    tenantId,
    documentId,
    formatVersion: 1,
    contentHash: `revision-${revisionId}`,
    plateJson,
    plainText,
    createdBy: actorId,
    updatedBy: actorId,
  });
  return { tenantId, actorId, projectId, moduleId, documentId, revisionId };
}

async function createProcessingJob(
  fixture: Fixture,
  input: {
    targetType?: "document" | "project";
    targetId?: string;
    revisionId?: string | null;
    reason?: "revision_sealed" | "deleted";
    now?: Date;
  } = {},
) {
  const now = input.now ?? new Date();
  const leaseId = crypto.randomUUID();
  const [job] = await db.insert(knowledgeIndexJobs).values({
    tenantId: fixture.tenantId,
    targetType: input.targetType ?? "document",
    targetId: input.targetId ?? fixture.documentId,
    revisionId: input.revisionId === undefined ? fixture.revisionId : input.revisionId,
    reason: input.reason ?? "revision_sealed",
    status: "processing",
    attempts: 1,
    nextAttemptAt: now,
    // 租约新鲜度用真实时间：测试的 now 是固定的逻辑时刻，若拿它当 processingAt，
    // 任何并发运行的 worker 都会把这条任务当成"卡死"回收，租约随之失效。
    processingAt: new Date(),
    leaseId,
    createdBy: fixture.actorId,
    updatedBy: fixture.actorId,
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!job) throw new Error("Failed to create indexing test job");
  return job;
}

async function processAndFail(envOverride: ServerEnv, job: Awaited<ReturnType<typeof createProcessingJob>>, now: Date) {
  let failure: unknown;
  try {
    await processKnowledgeIndexJob(db, envOverride, job, now);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeTruthy();
  expect(await failKnowledgeIndexJob(db, {
    id: job.id,
    leaseId: job.leaseId!,
    error: failure,
    now,
  })).toBe(true);
}

afterAll(async () => {
  if (tenantIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.tenantId, tenantIds));
    await db.delete(knowledgeIndexJobs).where(inArray(knowledgeIndexJobs.tenantId, tenantIds));
    await db.delete(knowledgeEdges).where(inArray(knowledgeEdges.tenantId, tenantIds));
    await db.delete(knowledgeEmbeddings).where(inArray(knowledgeEmbeddings.tenantId, tenantIds));
    await db.delete(knowledgeSourceScores).where(inArray(knowledgeSourceScores.tenantId, tenantIds));
    await db.delete(knowledgeMergeProposals).where(inArray(knowledgeMergeProposals.tenantId, tenantIds));
    await db.delete(knowledgeConceptAliases).where(inArray(knowledgeConceptAliases.tenantId, tenantIds));
    await db.delete(knowledgeConcepts).where(inArray(knowledgeConcepts.tenantId, tenantIds));
    await db.delete(searchItems).where(inArray(searchItems.tenantId, tenantIds));
    await db.delete(documentChunks).where(inArray(documentChunks.tenantId, tenantIds));
    await db.delete(documentRevisions).where(inArray(documentRevisions.tenantId, tenantIds));
    await db.delete(documents).where(inArray(documents.tenantId, tenantIds));
    await db.delete(projectModules).where(inArray(projectModules.tenantId, tenantIds));
    await db.delete(projects).where(inArray(projects.tenantId, tenantIds));
    await db.delete(users).where(inArray(users.tenantId, tenantIds));
    await db.delete(tenants).where(inArray(tenants.id, tenantIds));
  }
  await db.$client.end({ timeout: 1 });
});

describe("knowledge indexing", () => {
  test("commits FTS chunks before an embedding provider failure and backs off the job", async () => {
    const fixture = await createFixture();
    const model = createModelServer({ failEmbeddings: true });
    const now = new Date("2026-08-17T12:00:00.000Z");
    try {
      const job = await createProcessingJob(fixture, { now });
      await processAndFail(configuredEnv(model.server), job, now);

      expect(await db.select().from(documentChunks).where(and(
        eq(documentChunks.tenantId, fixture.tenantId),
        eq(documentChunks.documentId, fixture.documentId),
      ))).toHaveLength(1);
      expect(await db.select().from(searchItems).where(and(
        eq(searchItems.tenantId, fixture.tenantId),
        eq(searchItems.entityId, fixture.documentId),
      ))).toHaveLength(1);
      expect(await db.select().from(knowledgeEmbeddings).where(
        eq(knowledgeEmbeddings.tenantId, fixture.tenantId),
      )).toHaveLength(0);
      const [failed] = await db.select().from(knowledgeIndexJobs)
        .where(eq(knowledgeIndexJobs.id, job.id));
      expect(failed).toMatchObject({ status: "failed", attempts: 1, leaseId: null });
      expect(failed!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      model.server.stop(true);
    }
  });

  test("reuses the unchanged chunk id and vector across revisions", async () => {
    const stableText = "const stable = true;";
    const fixture = await createFixture({
      plateJson: [
        { id: "stable", type: "code_block", children: [{ text: stableText }] },
        { id: "mutable", type: "code_block", children: [{ text: "before" }] },
      ],
      plainText: `${stableText}\nbefore`,
    });
    const model = createModelServer();
    try {
      const firstJob = await createProcessingJob(fixture);
      await processKnowledgeIndexJob(db, configuredEnv(model.server), firstJob);
      await completeKnowledgeIndexJob(db, { id: firstJob.id, leaseId: firstJob.leaseId! });
      const firstChunks = await db.select().from(documentChunks).where(and(
        eq(documentChunks.tenantId, fixture.tenantId),
        eq(documentChunks.documentId, fixture.documentId),
      ));
      const stableChunk = firstChunks.find((chunk) => chunk.blockIds.includes("stable"));
      expect(stableChunk).toBeTruthy();
      const [stableVector] = await db.select().from(knowledgeEmbeddings).where(and(
        eq(knowledgeEmbeddings.tenantId, fixture.tenantId),
        eq(knowledgeEmbeddings.ownerType, "document_chunk"),
        eq(knowledgeEmbeddings.ownerId, stableChunk!.id),
      ));

      const nextRevisionId = crypto.randomUUID();
      await db.insert(documentRevisions).values({
        id: nextRevisionId,
        tenantId: fixture.tenantId,
        documentId: fixture.documentId,
        formatVersion: 1,
        contentHash: `revision-${nextRevisionId}`,
        plateJson: [
          { id: "stable", type: "code_block", children: [{ text: stableText }] },
          { id: "mutable", type: "code_block", children: [{ text: "after" }] },
        ],
        plainText: `${stableText}\nafter`,
        createdBy: fixture.actorId,
        updatedBy: fixture.actorId,
      });
      const secondJob = await createProcessingJob(fixture, { revisionId: nextRevisionId });
      await processKnowledgeIndexJob(db, configuredEnv(model.server), secondJob);
      const secondChunks = await db.select().from(documentChunks).where(and(
        eq(documentChunks.tenantId, fixture.tenantId),
        eq(documentChunks.documentId, fixture.documentId),
        eq(documentChunks.isCurrent, true),
      ));
      const reusedChunk = secondChunks.find((chunk) => chunk.blockIds.includes("stable"));
      const [reusedVector] = await db.select().from(knowledgeEmbeddings).where(and(
        eq(knowledgeEmbeddings.tenantId, fixture.tenantId),
        eq(knowledgeEmbeddings.ownerType, "document_chunk"),
        eq(knowledgeEmbeddings.ownerId, stableChunk!.id),
      ));

      expect(reusedChunk?.id).toBe(stableChunk!.id);
      expect(reusedChunk?.revisionId).toBe(nextRevisionId);
      expect(reusedVector?.id).toBe(stableVector?.id);
      expect(model.embeddedBatches).toEqual([2, 1]);
    } finally {
      model.server.stop(true);
    }
  });

  test("keeps chunks and embeddings when concept extraction fails, then backs off", async () => {
    const longText = "Evidence-backed concept extraction content. ".repeat(12);
    const fixture = await createFixture({
      plateJson: [{ id: "long", type: "p", children: [{ text: longText }] }],
      plainText: longText,
    });
    const model = createModelServer({ failGeneration: true });
    const now = new Date("2026-08-17T13:00:00.000Z");
    try {
      const job = await createProcessingJob(fixture, { now });
      await processAndFail(configuredEnv(model.server, true), job, now);

      expect(await db.select().from(documentChunks).where(
        eq(documentChunks.tenantId, fixture.tenantId),
      )).toHaveLength(1);
      const embeddings = await db.select().from(knowledgeEmbeddings).where(
        eq(knowledgeEmbeddings.tenantId, fixture.tenantId),
      );
      expect(embeddings.map((embedding) => embedding.ownerType).sort()).toEqual([
        "document",
        "document_chunk",
      ]);
      const [failed] = await db.select().from(knowledgeIndexJobs)
        .where(eq(knowledgeIndexJobs.id, job.id));
      expect(failed?.status).toBe("failed");
      expect(failed!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      model.server.stop(true);
    }
  });

  test("project deletion removes knowledge rows and refreshes concept counts", async () => {
    const fixture = await createFixture();
    const conceptId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    await db.insert(documentChunks).values({
      id: chunkId,
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      revisionId: fixture.revisionId,
      chunkIndex: 0,
      blockIds: ["delete"],
      headingPath: [],
      content: "delete",
      embedText: "delete",
      contentHash: "delete-chunk",
      searchText: "delete",
      tokenCount: 1,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(searchItems).values({
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      entityType: "document",
      entityId: fixture.documentId,
      documentId: fixture.documentId,
      title: "Delete",
      content: "Delete",
      searchText: "delete",
      tags: [],
      metadata: {},
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeEmbeddings).values([
      {
        tenantId: fixture.tenantId,
        ownerType: "document_chunk",
        ownerId: chunkId,
        projectId: fixture.projectId,
        model: "delete-test@1024",
        embedding: embeddingVector(),
        contentHash: "delete-chunk",
        createdBy: fixture.actorId,
        updatedBy: fixture.actorId,
      },
      {
        tenantId: fixture.tenantId,
        ownerType: "document",
        ownerId: fixture.documentId,
        projectId: fixture.projectId,
        model: "delete-test@1024",
        embedding: embeddingVector(),
        contentHash: "delete-document",
        createdBy: fixture.actorId,
        updatedBy: fixture.actorId,
      },
    ]);
    await db.insert(knowledgeConcepts).values({
      id: conceptId,
      tenantId: fixture.tenantId,
      name: "Deletion concept",
      normalizedName: "deletionconcept",
      type: "practice",
      status: "active",
      mentionCount: 1,
      projectSpread: 1,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeEdges).values({
      tenantId: fixture.tenantId,
      sourceType: "document",
      sourceId: fixture.documentId,
      sourceProjectId: fixture.projectId,
      targetType: "concept",
      targetId: conceptId,
      relation: "mentions",
      weight: 1,
      origin: "ai",
      status: "active",
      evidence: { kind: "mention", salience: "primary", quotes: ["Delete"] },
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });

    const job = await createProcessingJob(fixture, {
      targetType: "project",
      targetId: fixture.projectId,
      revisionId: null,
      reason: "deleted",
    });
    await processKnowledgeIndexJob(db, env, job);

    expect(await db.select().from(documentChunks).where(
      eq(documentChunks.tenantId, fixture.tenantId),
    )).toHaveLength(0);
    expect(await db.select().from(knowledgeEmbeddings).where(
      eq(knowledgeEmbeddings.tenantId, fixture.tenantId),
    )).toHaveLength(0);
    expect(await db.select().from(knowledgeEdges).where(
      eq(knowledgeEdges.tenantId, fixture.tenantId),
    )).toHaveLength(0);
    expect(await db.select().from(searchItems).where(
      eq(searchItems.tenantId, fixture.tenantId),
    )).toHaveLength(0);
    const [concept] = await db.select().from(knowledgeConcepts)
      .where(eq(knowledgeConcepts.id, conceptId));
    expect(concept).toMatchObject({ mentionCount: 0, projectSpread: 0 });
  });

  test("document deletion removes chunks, vectors, graph edges, and source scores", async () => {
    const fixture = await createFixture();
    const conceptId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    await db.insert(documentChunks).values({
      id: chunkId,
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      revisionId: fixture.revisionId,
      chunkIndex: 0,
      blockIds: ["delete-document"],
      headingPath: [],
      content: "delete document",
      embedText: "delete document",
      contentHash: "delete-document-chunk",
      searchText: "delete document",
      tokenCount: 2,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(searchItems).values({
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      entityType: "document",
      entityId: fixture.documentId,
      documentId: fixture.documentId,
      title: "Delete document",
      content: "Delete document",
      searchText: "delete document",
      tags: [],
      metadata: {},
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeEmbeddings).values({
      tenantId: fixture.tenantId,
      ownerType: "document",
      ownerId: fixture.documentId,
      projectId: fixture.projectId,
      model: "delete-document@1024",
      embedding: embeddingVector(),
      contentHash: "delete-document",
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeEmbeddings).values({
      tenantId: fixture.tenantId,
      ownerType: "document_chunk",
      ownerId: chunkId,
      projectId: fixture.projectId,
      model: "delete-document@1024",
      embedding: embeddingVector(2),
      contentHash: "delete-document-chunk",
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeConcepts).values({
      id: conceptId,
      tenantId: fixture.tenantId,
      name: "Document deletion concept",
      normalizedName: "documentdeletionconcept",
      type: "practice",
      status: "active",
      mentionCount: 1,
      projectSpread: 1,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeEdges).values({
      tenantId: fixture.tenantId,
      sourceType: "document",
      sourceId: fixture.documentId,
      sourceProjectId: fixture.projectId,
      targetType: "concept",
      targetId: conceptId,
      relation: "mentions",
      weight: 1,
      origin: "ai",
      status: "active",
      evidence: { kind: "mention", salience: "primary" },
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });
    await db.insert(knowledgeSourceScores).values({
      tenantId: fixture.tenantId,
      sourceType: "document",
      sourceId: fixture.documentId,
      createdBy: fixture.actorId,
      updatedBy: fixture.actorId,
    });

    const job = await createProcessingJob(fixture, {
      targetType: "document",
      targetId: fixture.documentId,
      reason: "deleted",
    });
    await processKnowledgeIndexJob(db, env, job);

    expect(await db.select().from(documentChunks).where(eq(documentChunks.documentId, fixture.documentId))).toHaveLength(0);
    expect(await db.select().from(knowledgeEmbeddings).where(eq(knowledgeEmbeddings.tenantId, fixture.tenantId))).toHaveLength(0);
    expect(await db.select().from(knowledgeEdges).where(eq(knowledgeEdges.tenantId, fixture.tenantId))).toHaveLength(0);
    expect(await db.select().from(searchItems).where(eq(searchItems.tenantId, fixture.tenantId))).toHaveLength(0);
    expect(await db.select().from(knowledgeSourceScores).where(eq(knowledgeSourceScores.tenantId, fixture.tenantId))).toHaveLength(0);
    const [concept] = await db.select().from(knowledgeConcepts).where(eq(knowledgeConcepts.id, conceptId));
    expect(concept).toMatchObject({ mentionCount: 0, projectSpread: 0 });
  });
});
