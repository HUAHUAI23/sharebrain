// 消费 durable 知识任务，物化 FTS chunk、embedding、解析边、相似边与概念层。
import type { ServerEnv } from "@sharebrain/config";
import {
  claimKnowledgeIndexJobs,
  completeKnowledgeIndexJob,
  cleanupKnowledgeTarget,
  failKnowledgeIndexJob,
  summarizeKnowledgeIndexError,
} from "@sharebrain/db";
import {
  auditLogs,
  documentChunks,
  documentRevisions,
  documents,
  documentVersions,
  knowledgeEdges,
  knowledgeEmbeddings,
  moduleRecords,
  projects,
  searchItems,
} from "@sharebrain/db/schema";
import {
  chunkPlateDocument,
  estimateTokens,
  tokenizeForSearch,
} from "@sharebrain/knowledge";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import {
  embedKnowledgeTexts,
  embeddingModelTag,
  isEmbeddingConfigured,
} from "../knowledge-ai";
import {
  extractAndStoreDocumentConcepts,
} from "./knowledge-concepts";
import { refreshDocumentSimilarityEdges } from "./knowledge-similarity";

import type { DatabaseClient } from "@sharebrain/db";

type KnowledgeIndexJob = typeof import("@sharebrain/db/schema").knowledgeIndexJobs.$inferSelect;

export type KnowledgeIndexingResult = {
  enabled: boolean;
  claimed: number;
  completed: number;
  failed: number;
};

export async function runKnowledgeIndexing(
  db: DatabaseClient,
  env: ServerEnv,
  options: { now?: Date } = {},
): Promise<KnowledgeIndexingResult> {
  if (!env.KNOWLEDGE_INDEX_ENABLED) {
    return { enabled: false, claimed: 0, completed: 0, failed: 0 };
  }
  const jobs = await claimKnowledgeIndexJobs(db, {
    batchSize: env.KNOWLEDGE_JOB_BATCH_SIZE,
    processingTimeoutSeconds: env.KNOWLEDGE_JOB_PROCESSING_TIMEOUT_SECONDS,
    ...(options.now ? { now: options.now } : {}),
  });
  let completed = 0;
  let failed = 0;

  for (let offset = 0; offset < jobs.length; offset += env.WORKER_CONCURRENCY) {
    const batch = jobs.slice(offset, offset + env.WORKER_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (job) => {
        if (!job.leaseId) return false;
        try {
          const summary = await processKnowledgeIndexJob(db, env, job, options.now);
          const accepted = await completeKnowledgeIndexJob(db, {
            id: job.id,
            leaseId: job.leaseId,
            ...(options.now ? { now: options.now } : {}),
          });
          console.info(JSON.stringify({
            event: "knowledge.index.completed",
            jobId: job.id,
            targetType: job.targetType,
            targetId: job.targetId,
            attempts: job.attempts,
            accepted,
            ...summary,
          }));
          return accepted;
        } catch (error) {
          await failKnowledgeIndexJob(db, {
            id: job.id,
            leaseId: job.leaseId,
            error,
            ...(options.now ? { now: options.now } : {}),
          });
          console.error(JSON.stringify({
            event: "knowledge.index.failed",
            jobId: job.id,
            targetType: job.targetType,
            targetId: job.targetId,
            attempts: job.attempts,
            error: summarizeKnowledgeIndexError(error),
            retry: "exponential_backoff",
          }));
          return false;
        }
      }),
    );
    completed += results.filter(Boolean).length;
    failed += results.filter((result) => !result).length;
  }
  return { enabled: true, claimed: jobs.length, completed, failed };
}

export async function processKnowledgeIndexJob(
  db: DatabaseClient,
  env: ServerEnv,
  job: KnowledgeIndexJob,
  now = new Date(),
) {
  if (job.reason === "deleted") {
    return cleanupKnowledgeTargetForJob(db, job, now);
  }
  if (job.targetType === "document") return indexDocument(db, env, job, now);
  if (job.targetType === "module_record") return indexModuleRecord(db, env, job, now);
  return indexProject(db, env, job, now);
}

async function indexDocument(
  db: DatabaseClient,
  env: ServerEnv,
  job: KnowledgeIndexJob,
  now: Date,
) {
  const source = await getDocumentSource(db, job);
  if (!source) return cleanupKnowledgeTargetForJob(db, { ...job, reason: "deleted" }, now);

  const chunks = chunkPlateDocument({
    projectName: source.projectName,
    documentTitle: source.documentTitle,
    value: source.plateJson,
  });
  const prepared = await Promise.all(
    chunks.map(async (chunk) => ({ ...chunk, contentHash: await sha256(chunk.embedText) })),
  );
  const existingChunks = await db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.tenantId, job.tenantId),
        eq(documentChunks.documentId, job.targetId),
        eq(documentChunks.isCurrent, true),
      ),
    );
  const oldAllChunks = await db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.tenantId, job.tenantId),
        eq(documentChunks.documentId, job.targetId),
      ),
    );
  const model = embeddingModelTag(env);
  const configured = isEmbeddingConfigured(env);
  const existingVectors = configured && existingChunks.length > 0
    ? await db
        .select()
        .from(knowledgeEmbeddings)
        .where(
          and(
            eq(knowledgeEmbeddings.tenantId, job.tenantId),
            eq(knowledgeEmbeddings.ownerType, "document_chunk"),
            eq(knowledgeEmbeddings.model, model),
            inArray(knowledgeEmbeddings.ownerId, existingChunks.map((chunk) => chunk.id)),
            isNull(knowledgeEmbeddings.deletedAt),
          ),
        )
    : [];
  const reusableByHash = new Map<string, typeof existingChunks>();
  for (const chunk of existingChunks) {
    reusableByHash.set(chunk.contentHash, [
      ...(reusableByHash.get(chunk.contentHash) ?? []),
      chunk,
    ]);
  }
  const reusedByIndex = new Map<number, (typeof existingChunks)[number]>();
  for (const [index, chunk] of prepared.entries()) {
    const reused = reusableByHash.get(chunk.contentHash)?.shift();
    if (reused) reusedByIndex.set(index, reused);
  }
  const reusedIds = new Set([...reusedByIndex.values()].map((chunk) => chunk.id));
  const obsoleteIds = oldAllChunks
    .filter((chunk) => !reusedIds.has(chunk.id))
    .map((chunk) => chunk.id);

  // 先提交 FTS 读模型。Embedding 提供方失败时任务仍会退避，但关键词检索立即可用。
  const insertedChunks = await db.transaction(async (tx) => {
    if (reusedIds.size > 0) {
      await tx.update(documentChunks).set({
        chunkIndex: sql`-${documentChunks.chunkIndex} - 1`,
        isCurrent: false,
        updatedBy: job.updatedBy,
        updatedAt: now,
      }).where(and(
        eq(documentChunks.tenantId, job.tenantId),
        inArray(documentChunks.id, [...reusedIds]),
      ));
    }
    if (obsoleteIds.length > 0) {
      await tx.delete(knowledgeEmbeddings).where(
        and(
          eq(knowledgeEmbeddings.tenantId, job.tenantId),
          eq(knowledgeEmbeddings.ownerType, "document_chunk"),
          inArray(knowledgeEmbeddings.ownerId, obsoleteIds),
        ),
      );
      await tx.delete(documentChunks).where(and(
        eq(documentChunks.tenantId, job.tenantId),
        inArray(documentChunks.id, obsoleteIds),
      ));
    }
    await tx.delete(knowledgeEmbeddings).where(and(
      eq(knowledgeEmbeddings.tenantId, job.tenantId),
      eq(knowledgeEmbeddings.ownerType, "document"),
      eq(knowledgeEmbeddings.ownerId, job.targetId),
      eq(knowledgeEmbeddings.model, model),
    ));
    const rows: Array<typeof documentChunks.$inferSelect> = [];
    for (const [index, chunk] of prepared.entries()) {
      const values = {
        tenantId: job.tenantId,
        projectId: source.projectId,
        documentId: job.targetId,
        revisionId: source.revisionId,
        chunkIndex: chunk.chunkIndex,
        blockIds: chunk.blockIds,
        headingPath: chunk.headingPath,
        content: chunk.content,
        embedText: chunk.embedText,
        contentHash: chunk.contentHash,
        searchText: tokenizeForSearch(chunk.content),
        tokenCount: chunk.tokenCount,
        isCurrent: true,
        metadata: chunk.metadata,
        createdBy: job.updatedBy,
        updatedBy: job.updatedBy,
        createdAt: now,
        updatedAt: now,
      };
      const reused = reusedByIndex.get(index);
      const [row] = reused
        ? await tx.update(documentChunks).set({
            ...values,
            createdAt: reused.createdAt,
            createdBy: reused.createdBy,
          }).where(and(
            eq(documentChunks.id, reused.id),
            eq(documentChunks.tenantId, job.tenantId),
          )).returning()
        : await tx.insert(documentChunks).values(values).returning();
      if (row) rows.push(row);
    }
    await replaceWorkerSearchItem(tx, {
      tenantId: job.tenantId,
      projectId: source.projectId,
      entityType: "document",
      entityId: job.targetId,
      documentId: job.targetId,
      title: source.documentTitle,
      content: source.plainText || source.documentTitle,
      actorId: job.updatedBy,
      now,
    });
    await replaceDocumentLinks(tx, {
      tenantId: job.tenantId,
      projectId: source.projectId,
      documentId: job.targetId,
      plateJson: source.plateJson,
      actorId: job.updatedBy,
      now,
    });
    return rows;
  });

  const existingVectorByOwner = new Map(existingVectors.map((vector) => [vector.ownerId, vector.embedding]));
  const vectors: Array<number[] | null> = insertedChunks.map((chunk) =>
    existingVectorByOwner.get(chunk.id) ?? null);
  const missingIndexes = configured
    ? vectors.map((vector, index) => (vector ? -1 : index)).filter((index) => index >= 0)
    : [];
  if (configured && missingIndexes.length > 0) {
    const generated = await embedKnowledgeTexts(
      env,
      missingIndexes.map((index) => prepared[index]?.embedText ?? ""),
    );
    missingIndexes.forEach((preparedIndex, generatedIndex) => {
      vectors[preparedIndex] = generated[generatedIndex] ?? null;
    });
  }

  const documentVector = vectors.some(Boolean)
    ? meanVector(vectors.filter((vector): vector is number[] => !!vector))
    : null;
  if (configured && documentVector) {
    await db.transaction(async (tx) => {
      for (const index of missingIndexes) {
        const row = insertedChunks[index];
        const vector = vectors[index];
        if (!row || !vector) continue;
        await tx.insert(knowledgeEmbeddings).values({
          tenantId: job.tenantId,
          ownerType: "document_chunk",
          ownerId: row.id,
          projectId: source.projectId,
          model,
          embedding: vector,
          contentHash: row.contentHash,
          createdBy: job.updatedBy,
          updatedBy: job.updatedBy,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [
            knowledgeEmbeddings.tenantId,
            knowledgeEmbeddings.ownerType,
            knowledgeEmbeddings.ownerId,
            knowledgeEmbeddings.model,
          ],
          set: {
            projectId: source.projectId,
            embedding: vector,
            contentHash: row.contentHash,
            deletedAt: null,
            updatedBy: job.updatedBy,
            updatedAt: now,
          },
        });
      }
      await tx.insert(knowledgeEmbeddings).values({
        tenantId: job.tenantId,
        ownerType: "document",
        ownerId: job.targetId,
        projectId: source.projectId,
        model,
        embedding: documentVector,
        contentHash: source.contentHash,
        createdBy: job.updatedBy,
        updatedBy: job.updatedBy,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          knowledgeEmbeddings.tenantId,
          knowledgeEmbeddings.ownerType,
          knowledgeEmbeddings.ownerId,
          knowledgeEmbeddings.model,
        ],
        set: {
          projectId: source.projectId,
          embedding: documentVector,
          contentHash: source.contentHash,
          deletedAt: null,
          updatedBy: job.updatedBy,
          updatedAt: now,
        },
      });
    });
  }

  let similarityEdges = 0;
  let concepts = { extracted: 0, created: 0, mentions: 0, relations: 0 };
  if (configured && documentVector) {
    similarityEdges = await refreshDocumentSimilarityEdges(db, {
      tenantId: job.tenantId,
      documentId: job.targetId,
      projectId: source.projectId,
      model,
      threshold: env.KNOWLEDGE_SIMILARITY_THRESHOLD,
      actorId: job.updatedBy,
      now,
    });
    concepts = await extractAndStoreDocumentConcepts(db, env, {
      jobId: job.id,
      tenantId: job.tenantId,
      documentId: job.targetId,
      projectId: source.projectId,
      actorId: job.updatedBy,
      text: source.plainText,
      documentEmbedding: documentVector,
      now,
    });
    await db.insert(auditLogs).values({
      tenantId: job.tenantId,
      actorId: job.updatedBy,
      action: "ai.embedding",
      resourceType: "knowledge_index_job",
      resourceId: job.id,
      projectId: source.projectId,
      documentId: job.targetId,
      metadata: {
        jobId: job.id,
        targetType: "document",
        targetId: job.targetId,
        chunkCount: prepared.length,
        embeddedChunkCount: missingIndexes.length,
        totalTokens: prepared.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
        model,
        requestId: crypto.randomUUID(),
      },
      createdBy: job.updatedBy,
      updatedBy: job.updatedBy,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    chunks: insertedChunks.length,
    embedded: configured ? missingIndexes.length : 0,
    embeddingConfigured: configured,
    similarityEdges,
    concepts,
  };
}

async function indexModuleRecord(
  db: DatabaseClient,
  env: ServerEnv,
  job: KnowledgeIndexJob,
  now: Date,
) {
  const [record] = await db
    .select()
    .from(moduleRecords)
    .where(
      and(
        eq(moduleRecords.id, job.targetId),
        eq(moduleRecords.tenantId, job.tenantId),
        isNull(moduleRecords.deletedAt),
      ),
    )
    .limit(1);
  if (!record) return cleanupKnowledgeTargetForJob(db, { ...job, reason: "deleted" }, now);
  const content = [record.title, ...Object.values(record.values).map(String)].join("\n");
  return indexSimpleEntity(db, env, job, {
    projectId: record.projectId,
    content,
    now,
  });
}

async function indexProject(
  db: DatabaseClient,
  env: ServerEnv,
  job: KnowledgeIndexJob,
  now: Date,
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, job.targetId),
        eq(projects.tenantId, job.tenantId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) return cleanupKnowledgeTargetForJob(db, { ...job, reason: "deleted" }, now);
  const content = [project.name, project.description, ...project.tags].filter(Boolean).join("\n");
  return indexSimpleEntity(db, env, job, { projectId: project.id, content, now });
}

async function indexSimpleEntity(
  db: DatabaseClient,
  env: ServerEnv,
  job: KnowledgeIndexJob,
  input: { projectId: string; content: string; now: Date },
) {
  const configured = isEmbeddingConfigured(env);
  if (!configured) return { embeddingConfigured: false, embedded: 0 };
  const model = embeddingModelTag(env);
  const contentHash = await sha256(input.content);
  const [existing] = await db
    .select()
    .from(knowledgeEmbeddings)
    .where(
      and(
        eq(knowledgeEmbeddings.tenantId, job.tenantId),
        eq(knowledgeEmbeddings.ownerType, job.targetType),
        eq(knowledgeEmbeddings.ownerId, job.targetId),
        eq(knowledgeEmbeddings.model, model),
        eq(knowledgeEmbeddings.contentHash, contentHash),
        isNull(knowledgeEmbeddings.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return { embeddingConfigured: true, embedded: 0 };

  const [vector] = await embedKnowledgeTexts(env, [input.content]);
  if (!vector) throw new Error("Embedding provider returned no vector");
  await db.insert(knowledgeEmbeddings).values({
    tenantId: job.tenantId,
    ownerType: job.targetType,
    ownerId: job.targetId,
    projectId: input.projectId,
    model,
    embedding: vector,
    contentHash,
    createdBy: job.updatedBy,
    updatedBy: job.updatedBy,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: [
      knowledgeEmbeddings.tenantId,
      knowledgeEmbeddings.ownerType,
      knowledgeEmbeddings.ownerId,
      knowledgeEmbeddings.model,
    ],
    set: {
      projectId: input.projectId,
      embedding: vector,
      contentHash,
      deletedAt: null,
      updatedBy: job.updatedBy,
      updatedAt: input.now,
    },
  });
  await db.insert(auditLogs).values({
    tenantId: job.tenantId,
    actorId: job.updatedBy,
    action: "ai.embedding",
    resourceType: "knowledge_index_job",
    resourceId: job.id,
    projectId: input.projectId,
    metadata: {
      jobId: job.id,
      targetType: job.targetType,
      targetId: job.targetId,
      chunkCount: 1,
      totalTokens: estimateTokens(input.content),
      model,
      requestId: crypto.randomUUID(),
    },
    createdBy: job.updatedBy,
    updatedBy: job.updatedBy,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return { embeddingConfigured: true, embedded: 1 };
}

async function cleanupKnowledgeTargetForJob(
  db: DatabaseClient,
  job: KnowledgeIndexJob,
  now: Date,
) {
  return cleanupKnowledgeTarget(db, {
    tenantId: job.tenantId,
    targetType: job.targetType as "document" | "module_record" | "project",
    targetId: job.targetId,
    actorId: job.updatedBy,
    now,
  });
}

async function getDocumentSource(db: DatabaseClient, job: KnowledgeIndexJob) {
  const baseCondition = and(
    eq(documents.id, job.targetId),
    eq(documents.tenantId, job.tenantId),
    isNull(documents.deletedAt),
    isNull(projects.deletedAt),
  );
  if (job.revisionId) {
    const [row] = await db
      .select({
        projectId: documents.projectId,
        projectName: projects.name,
        documentTitle: documents.title,
        revisionId: documentRevisions.id,
        contentHash: documentRevisions.contentHash,
        plateJson: documentRevisions.plateJson,
        plainText: documentRevisions.plainText,
      })
      .from(documents)
      .innerJoin(projects, eq(documents.projectId, projects.id))
      .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
      .where(and(baseCondition, eq(documentRevisions.id, job.revisionId)))
      .limit(1);
    return row;
  }
  const [row] = await db
    .select({
      projectId: documents.projectId,
      projectName: projects.name,
      documentTitle: documents.title,
      revisionId: documentRevisions.id,
      contentHash: documentRevisions.contentHash,
      plateJson: documentRevisions.plateJson,
      plainText: documentRevisions.plainText,
    })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .innerJoin(documentRevisions, eq(documentVersions.revisionId, documentRevisions.id))
    .where(
      and(
        baseCondition,
        isNotNull(documentVersions.sealedAt),
        isNull(documentVersions.deletedAt),
      ),
    )
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  return row;
}

async function replaceWorkerSearchItem(
  db: Pick<DatabaseClient, "delete" | "insert">,
  input: {
    tenantId: string;
    projectId: string;
    entityType: string;
    entityId: string;
    documentId: string | null;
    title: string;
    content: string;
    actorId: string;
    now: Date;
  },
) {
  await db.delete(searchItems).where(
    and(
      eq(searchItems.tenantId, input.tenantId),
      eq(searchItems.entityType, input.entityType),
      eq(searchItems.entityId, input.entityId),
    ),
  );
  await db.insert(searchItems).values({
    tenantId: input.tenantId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    documentId: input.documentId,
    title: input.title,
    content: input.content,
    searchText: tokenizeForSearch([input.title, input.content].join("\n")),
    pathText: input.title,
    tags: [],
    metadata: {},
    createdBy: input.actorId,
    updatedBy: input.actorId,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function replaceDocumentLinks(
  db: Pick<DatabaseClient, "delete" | "insert" | "select">,
  input: {
    tenantId: string;
    projectId: string;
    documentId: string;
    plateJson: unknown;
    actorId: string;
    now: Date;
  },
) {
  await db.delete(knowledgeEdges).where(
    and(
      eq(knowledgeEdges.tenantId, input.tenantId),
      eq(knowledgeEdges.sourceType, "document"),
      eq(knowledgeEdges.sourceId, input.documentId),
      eq(knowledgeEdges.relation, "links"),
      eq(knowledgeEdges.origin, "parser"),
    ),
  );
  const links = collectDocumentLinks(input.plateJson);
  if (links.size === 0) return;
  const targets = await db
    .select({ id: documents.id, projectId: documents.projectId })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, input.tenantId),
        inArray(documents.id, [...links.keys()]),
        isNull(documents.deletedAt),
      ),
    );
  for (const target of targets) {
    if (target.id === input.documentId) continue;
    await db.insert(knowledgeEdges).values({
      tenantId: input.tenantId,
      sourceType: "document",
      sourceId: input.documentId,
      sourceProjectId: input.projectId,
      targetType: "document",
      targetId: target.id,
      targetProjectId: target.projectId,
      relation: "links",
      weight: 1,
      origin: "parser",
      status: "active",
      evidence: { kind: "link", blockIds: links.get(target.id) ?? [] },
      computedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
}

const DOCUMENT_LINK = /\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:$|[/?#])/iu;

function collectDocumentLinks(value: unknown) {
  const result = new Map<string, string[]>();
  const visit = (node: unknown, inheritedBlockId?: string) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, inheritedBlockId));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const blockId = typeof record.id === "string" ? record.id : inheritedBlockId;
    const href = typeof record.url === "string"
      ? record.url
      : typeof record.href === "string"
        ? record.href
        : "";
    const match = href.match(DOCUMENT_LINK);
    const targetId = match?.[1];
    if (targetId) {
      result.set(targetId, [...new Set([...(result.get(targetId) ?? []), ...(blockId ? [blockId] : [])])]);
    }
    visit(record.children, blockId);
  };
  visit(value);
  return result;
}

function meanVector(vectors: number[][]) {
  const length = vectors[0]?.length ?? 0;
  const mean = Array.from({ length }, () => 0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      mean[index] = (mean[index] ?? 0) + value;
    });
  }
  return mean.map((value) => value / vectors.length);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
