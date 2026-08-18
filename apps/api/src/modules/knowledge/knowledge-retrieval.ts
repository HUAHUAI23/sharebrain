// 实现 tenant 可见范围内的分层混合召回、RRF、图扩展、权重校准与证据预算装配。
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { resolveEmbeddingConfig, type ServerEnv } from "@sharebrain/config";
import type {
  AiCitation,
  AuthContext,
  CitationRetrievalTrace,
  KnowledgeScope,
} from "@sharebrain/contracts";
import { KNOWLEDGE_EMBEDDING_DIM, type DatabaseClient } from "@sharebrain/db";
import {
  documentChunks,
  documents,
  knowledgeConcepts,
  knowledgeEdges,
  knowledgeEmbeddings,
  knowledgeSourceScores,
  projects,
  searchItems,
} from "@sharebrain/db/schema";
import {
  estimateTokens,
  feedbackMultiplier,
  reciprocalRankFuse,
  shouldUseAnn,
  toSimpleTsQuery,
  truncateToTokenBudget,
} from "@sharebrain/knowledge";
import { embed } from "ai";
import {
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import {
  mostRecentVisibleProject,
  requireVisibleProject,
  visibleProjects,
} from "./knowledge-access";

type SourceType = "document_chunk" | "module_record" | "project";
type Tier = "active_project" | "tenant_global" | "graph_expanded";

type RetrievalCandidate = {
  key: string;
  sourceType: SourceType;
  sourceId: string;
  projectId: string;
  projectName: string;
  documentId: string | null;
  chunkIndex: number | null;
  blockIds: string[];
  headingPath: string[];
  title: string;
  content: string;
  tokenCount: number;
  tier: Tier;
  ftsRank?: number;
  vectorScore?: number;
  conceptScore?: number;
  rrfScore: number;
  feedbackMultiplier: number;
  manualMultiplier: number;
  finalScore: number;
  graphPath?: CitationRetrievalTrace["graphPath"];
  conceptIds?: string[];
};

type GraphExpansionLink = {
  seedId: string;
  targetId: string;
  relation: "similar_to" | "links" | "mentions" | "relates_to";
  weight: number;
  coefficient: number;
  viaConceptIds?: string[];
};

export type KnowledgeRetrievalResult = {
  scope: KnowledgeScope;
  citations: AiCitation[];
  context: string;
  trace: Record<string, unknown>;
};

export async function resolveKnowledgeScope(
  db: DatabaseClient,
  env: ServerEnv,
  auth: AuthContext,
  input: {
    message: string;
    activeProjectId?: string | null;
    explicitProjectId?: string | null;
  },
): Promise<KnowledgeScope> {
  const visible = await visibleProjects(db, auth);
  const visibleIds = visible.map((project) => project.id);
  const byId = new Map(visible.map((project) => [project.id, project]));

  if (input.activeProjectId) {
    const project = await requireVisibleProject(db, auth, input.activeProjectId);
    return {
      activeProjectId: project.id,
      resolution: "route",
      projectName: project.name,
      ambiguousProjects: [],
    };
  }
  if (input.explicitProjectId) {
    const project = await requireVisibleProject(db, auth, input.explicitProjectId);
    return {
      activeProjectId: project.id,
      resolution: "explicit",
      projectName: project.name,
      ambiguousProjects: [],
    };
  }

  const recent = await mostRecentVisibleProject(db, auth, visibleIds);
  if (recent) {
    return {
      activeProjectId: recent.id,
      resolution: "recent",
      projectName: recent.name,
      ambiguousProjects: [],
    };
  }

  const normalizedMessage = input.message.trim().toLocaleLowerCase();
  const inferred = visible.filter((project) =>
    normalizedMessage.includes(project.name.trim().toLocaleLowerCase()),
  );
  if (inferred.length === 1) {
    const project = byId.get(inferred[0]?.id ?? "");
    if (project) {
      return {
        activeProjectId: project.id,
        resolution: "inferred",
        projectName: project.name,
        ambiguousProjects: [],
      };
    }
  }

  if (inferred.length > 1) {
    return {
      activeProjectId: null,
      resolution: "none",
      projectName: null,
      ambiguousProjects: inferred.slice(0, 5),
    };
  }

  const queryEmbedding = await embedQuery(env, input.message);
  if (queryEmbedding) {
    const config = resolveEmbeddingConfig(env);
    const distance = cosineDistance(knowledgeEmbeddings.embedding, queryEmbedding);
    const semantic = await db
      .select({
        id: projects.id,
        name: projects.name,
        distance,
      })
      .from(knowledgeEmbeddings)
      .innerJoin(projects, eq(knowledgeEmbeddings.ownerId, projects.id))
      .where(and(
        eq(knowledgeEmbeddings.tenantId, auth.tenantId),
        eq(knowledgeEmbeddings.ownerType, "project"),
        eq(knowledgeEmbeddings.model, `${config.model}@${KNOWLEDGE_EMBEDDING_DIM}`),
        inArray(knowledgeEmbeddings.ownerId, visibleIds),
        isNull(knowledgeEmbeddings.deletedAt),
        isNull(projects.deletedAt),
      ))
      .orderBy(asc(distance))
      .limit(5);
    const bestScore = semantic[0] ? 1 - Number(semantic[0].distance) : 0;
    const candidates = bestScore >= 0.55
      ? semantic.filter((row) => bestScore - (1 - Number(row.distance)) <= 0.04)
      : [];
    if (candidates.length === 1 && candidates[0]) {
      return {
        activeProjectId: candidates[0].id,
        resolution: "inferred",
        projectName: candidates[0].name,
        ambiguousProjects: [],
      };
    }
    if (candidates.length > 1) {
      return {
        activeProjectId: null,
        resolution: "none",
        projectName: null,
        ambiguousProjects: candidates.map(({ id, name }) => ({ id, name })),
      };
    }
  }

  return {
    activeProjectId: null,
    resolution: "none",
    projectName: null,
    ambiguousProjects: inferred.slice(0, 5),
  };
}

export async function retrieveKnowledge(
  db: DatabaseClient,
  env: ServerEnv,
  auth: AuthContext,
  input: {
    query: string;
    scope: KnowledgeScope;
    includeCrossProject: boolean;
  },
): Promise<KnowledgeRetrievalResult> {
  const visible = await visibleProjects(db, auth);
  const visibleIds = visible.map((project) => project.id);
  if (visibleIds.length === 0) {
    return { scope: input.scope, citations: [], context: "", trace: { channels: {} } };
  }

  const tiers: Array<{ tier: "active_project" | "tenant_global"; projectId: string | null }> = [];
  if (input.scope.activeProjectId) {
    tiers.push({ tier: "active_project", projectId: input.scope.activeProjectId });
  }
  if (!input.scope.activeProjectId || input.includeCrossProject) {
    tiers.push({ tier: "tenant_global", projectId: input.scope.activeProjectId });
  }

  const queryEmbedding = await embedQuery(env, input.query);
  const fused: RetrievalCandidate[] = [];
  const channelTrace: Record<string, unknown> = {};
  for (const tier of tiers) {
    const fts = await recallFts(db, auth.tenantId, visibleIds, input.query, tier);
    const vector = queryEmbedding
      ? await recallVector(db, env, auth.tenantId, visibleIds, queryEmbedding, tier)
      : [];
    const concept = await recallConcepts(
      db,
      auth.tenantId,
      visibleIds,
      input.query,
      queryEmbedding,
      tier,
    );
    const byKey = new Map<string, RetrievalCandidate>();
    for (const candidate of [...fts, ...vector, ...concept]) {
      const existing = byKey.get(candidate.key);
      if (!existing) {
        byKey.set(candidate.key, candidate);
        continue;
      }
      if (candidate.ftsRank !== undefined) {
        existing.ftsRank = Math.max(existing.ftsRank ?? 0, candidate.ftsRank);
      }
      if (candidate.vectorScore !== undefined) {
        existing.vectorScore = Math.max(existing.vectorScore ?? 0, candidate.vectorScore);
      }
      if (candidate.conceptScore !== undefined) {
        existing.conceptScore = Math.max(existing.conceptScore ?? 0, candidate.conceptScore);
      }
      if (candidate.conceptIds) {
        existing.conceptIds = [...new Set([...(existing.conceptIds ?? []), ...candidate.conceptIds])];
      }
    }
    const scores = reciprocalRankFuse([
      fts.map((candidate, index) => ({ id: candidate.key, rank: index + 1 })),
      vector.map((candidate, index) => ({ id: candidate.key, rank: index + 1 })),
      concept.map((candidate, index) => ({ id: candidate.key, rank: index + 1 })),
    ]);
    const ranked = [...byKey.values()]
      .map((candidate) => ({
        ...candidate,
        rrfScore: scores.get(candidate.key) ?? 0,
        finalScore: scores.get(candidate.key) ?? 0,
      }))
      .sort((left, right) => right.rrfScore - left.rrfScore);
    fused.push(...ranked);
    channelTrace[tier.tier] = {
      fts: traceCandidates(fts),
      vector: traceCandidates(vector),
      concept: traceCandidates(concept),
      fused: traceCandidates(ranked),
    };
  }

  fused.sort((left, right) => right.rrfScore - left.rrfScore);
  const graph = await expandGraph(db, auth.tenantId, visibleIds, fused.slice(0, 3));
  const deduplicated = deduplicateCandidates([...fused, ...graph]);
  await calibrateCandidates(db, auth.tenantId, deduplicated);
  const selected = assembleBudget(env, deduplicated);
  const citations = selected.map((candidate, index): AiCitation => ({
    id: crypto.randomUUID(),
    rank: index + 1,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    documentId: candidate.documentId,
    chunkIndex: candidate.chunkIndex,
    blockIds: candidate.blockIds,
    headingPath: candidate.headingPath,
    title: candidate.title,
    snippet: candidate.content.slice(0, 800),
    tier: candidate.tier,
    retrieval: toRetrievalTrace(candidate),
    available: true,
  }));
  const context = selected
    .map((candidate, index) => {
      const heading = candidate.headingPath.length > 0
        ? ` / ${candidate.headingPath.join(" / ")}`
        : "";
      return `[${index + 1}] ${candidate.projectName} / ${candidate.title}${heading}\n${candidate.content}`;
    })
    .join("\n\n");

  return {
    scope: input.scope,
    citations,
    context,
    trace: {
      queryChars: input.query.length,
      scope: input.scope,
      channels: channelTrace,
      graph: traceCandidates(graph),
      selected: traceCandidates(selected),
    },
  };
}

async function embedQuery(env: ServerEnv, value: string) {
  const config = resolveEmbeddingConfig(env);
  if (!config.apiKey || !config.baseURL || !config.model) return null;
  try {
    const provider = createOpenAICompatible({
      name: env.AI_MODEL_PROVIDER,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const result = await embed({
      model: provider.embeddingModel(config.model),
      value,
      providerOptions: {
        [env.AI_MODEL_PROVIDER]: { dimensions: KNOWLEDGE_EMBEDDING_DIM },
      },
    });
    return result.embedding.length === KNOWLEDGE_EMBEDDING_DIM ? result.embedding : null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "knowledge.query_embedding_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    return null;
  }
}

async function recallFts(
  db: DatabaseClient,
  tenantId: string,
  visibleIds: string[],
  query: string,
  tier: { tier: "active_project" | "tenant_global"; projectId: string | null },
) {
  // 问答的 query 是整句自然语言。用 all 模式会因为一个无关词直接召回为零，
  // 这里取 any 让覆盖度交给 ts_rank_cd 排序，再由 RRF 决定最终名次。
  const tsQuery = toSimpleTsQuery(query, "any");
  if (!tsQuery) return [];
  const chunkRank = sql<number>`ts_rank_cd(${documentChunks.searchVector}, to_tsquery('simple', ${tsQuery}))`;
  const chunkRows = await db
    .select({
      id: documentChunks.id,
      projectId: documentChunks.projectId,
      projectName: projects.name,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      blockIds: documentChunks.blockIds,
      headingPath: documentChunks.headingPath,
      title: documents.title,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
      rank: chunkRank,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .innerJoin(projects, eq(documentChunks.projectId, projects.id))
    .where(
      and(
        eq(documentChunks.tenantId, tenantId),
        eq(documentChunks.isCurrent, true),
        isNull(documentChunks.deletedAt),
        isNull(documents.deletedAt),
        isNull(projects.deletedAt),
        inArray(documentChunks.projectId, visibleIds),
        tierProjectCondition(documentChunks.projectId, tier),
        sql`${documentChunks.searchVector} @@ to_tsquery('simple', ${tsQuery})`,
      ),
    )
    .orderBy(desc(chunkRank))
    .limit(30);

  const itemRank = sql<number>`ts_rank_cd(${searchItems.searchVector}, to_tsquery('simple', ${tsQuery}))`;
  const itemRows = await db
    .select({
      id: searchItems.id,
      entityType: searchItems.entityType,
      entityId: searchItems.entityId,
      projectId: searchItems.projectId,
      projectName: projects.name,
      title: searchItems.title,
      content: searchItems.content,
      rank: itemRank,
    })
    .from(searchItems)
    .innerJoin(projects, eq(searchItems.projectId, projects.id))
    .where(
      and(
        eq(searchItems.tenantId, tenantId),
        inArray(searchItems.entityType, ["module_record", "project"]),
        isNull(searchItems.deletedAt),
        isNull(projects.deletedAt),
        inArray(searchItems.projectId, visibleIds),
        tierProjectCondition(searchItems.projectId, tier),
        sql`${searchItems.searchVector} @@ to_tsquery('simple', ${tsQuery})`,
      ),
    )
    .orderBy(desc(itemRank))
    .limit(30);

  return [
    ...chunkRows.map((row): RetrievalCandidate => ({
      key: `document_chunk:${row.id}`,
      sourceType: "document_chunk",
      sourceId: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      documentId: row.documentId,
      chunkIndex: row.chunkIndex,
      blockIds: row.blockIds,
      headingPath: row.headingPath,
      title: row.title,
      content: row.content,
      tokenCount: row.tokenCount,
      tier: tier.tier,
      ftsRank: Number(row.rank),
      rrfScore: 0,
      feedbackMultiplier: 1,
      manualMultiplier: 1,
      finalScore: 0,
    })),
    ...itemRows.flatMap((row): RetrievalCandidate[] => {
      if (!row.projectId || !row.projectName) return [];
      const sourceType = row.entityType === "project" ? "project" : "module_record";
      return [{
        key: `${sourceType}:${row.entityId}`,
        sourceType,
        sourceId: row.entityId,
        projectId: row.projectId,
        projectName: row.projectName,
        documentId: null,
        chunkIndex: null,
        blockIds: [],
        headingPath: [],
        title: row.title,
        content: row.content,
        tokenCount: estimateTokens(row.content),
        tier: tier.tier,
        ftsRank: Number(row.rank),
        rrfScore: 0,
        feedbackMultiplier: 1,
        manualMultiplier: 1,
        finalScore: 0,
      }];
    }),
  ].sort((left, right) => (right.ftsRank ?? 0) - (left.ftsRank ?? 0)).slice(0, 30);
}

async function recallVector(
  db: DatabaseClient,
  env: ServerEnv,
  tenantId: string,
  visibleIds: string[],
  queryEmbedding: number[],
  tier: { tier: "active_project" | "tenant_global"; projectId: string | null },
) {
  const config = resolveEmbeddingConfig(env);
  const model = `${config.model}@${KNOWLEDGE_EMBEDDING_DIM}`;
  const distance = cosineDistance(knowledgeEmbeddings.embedding, queryEmbedding);
  const conditions = and(
    eq(knowledgeEmbeddings.tenantId, tenantId),
    eq(knowledgeEmbeddings.model, model),
    inArray(knowledgeEmbeddings.ownerType, ["document_chunk", "module_record", "project"]),
    inArray(knowledgeEmbeddings.projectId, visibleIds),
    isNull(knowledgeEmbeddings.deletedAt),
    tierProjectCondition(knowledgeEmbeddings.projectId, tier),
  );
  const [candidateTotal] = await db
    .select({ value: count() })
    .from(knowledgeEmbeddings)
    .where(conditions);
  const useAnn = shouldUseAnn(
    Number(candidateTotal?.value ?? 0),
    env.KNOWLEDGE_ANN_ROW_THRESHOLD,
  );
  const rows = await db.transaction(async (tx) => {
    if (useAnn) {
      await tx.execute(sql`set local hnsw.ef_search = 100`);
    } else {
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
    }
    return tx
      .select({
        ownerType: knowledgeEmbeddings.ownerType,
        ownerId: knowledgeEmbeddings.ownerId,
        projectId: knowledgeEmbeddings.projectId,
        distance,
      })
      .from(knowledgeEmbeddings)
      .where(conditions)
      .orderBy(asc(distance))
      .limit(30);
  });
  return hydrateEmbeddingRows(db, tenantId, rows.map((row) => ({
    ...row,
    score: Math.max(0, 1 - Number(row.distance)),
  })), tier.tier);
}

async function hydrateEmbeddingRows(
  db: DatabaseClient,
  tenantId: string,
  rows: Array<{ ownerType: string; ownerId: string; projectId: string | null; score: number }>,
  tier: "active_project" | "tenant_global",
) {
  const chunkIds = rows.filter((row) => row.ownerType === "document_chunk").map((row) => row.ownerId);
  const entityIds = rows.filter((row) => row.ownerType !== "document_chunk").map((row) => row.ownerId);
  const chunkRows = chunkIds.length === 0 ? [] : await db
    .select({
      id: documentChunks.id,
      projectId: documentChunks.projectId,
      projectName: projects.name,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      blockIds: documentChunks.blockIds,
      headingPath: documentChunks.headingPath,
      title: documents.title,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .innerJoin(projects, eq(documentChunks.projectId, projects.id))
    .where(and(
      eq(documentChunks.tenantId, tenantId),
      inArray(documentChunks.id, chunkIds),
      eq(documentChunks.isCurrent, true),
      isNull(documentChunks.deletedAt),
      isNull(documents.deletedAt),
      isNull(projects.deletedAt),
    ));
  const itemRows = entityIds.length === 0 ? [] : await db
    .select({
      entityId: searchItems.entityId,
      entityType: searchItems.entityType,
      projectId: searchItems.projectId,
      projectName: projects.name,
      title: searchItems.title,
      content: searchItems.content,
    })
    .from(searchItems)
    .innerJoin(projects, eq(searchItems.projectId, projects.id))
    .where(and(
      eq(searchItems.tenantId, tenantId),
      inArray(searchItems.entityId, entityIds),
      isNull(searchItems.deletedAt),
      isNull(projects.deletedAt),
    ));
  const chunks = new Map(chunkRows.map((row) => [row.id, row]));
  const items = new Map(itemRows.map((row) => [`${row.entityType}:${row.entityId}`, row]));
  return rows.flatMap((row): RetrievalCandidate[] => {
    if (row.ownerType === "document_chunk") {
      const chunk = chunks.get(row.ownerId);
      if (!chunk) return [];
      return [{
        key: `document_chunk:${chunk.id}`,
        sourceType: "document_chunk",
        sourceId: chunk.id,
        projectId: chunk.projectId,
        projectName: chunk.projectName,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        blockIds: chunk.blockIds,
        headingPath: chunk.headingPath,
        title: chunk.title,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        tier,
        vectorScore: row.score,
        rrfScore: 0,
        feedbackMultiplier: 1,
        manualMultiplier: 1,
        finalScore: 0,
      }];
    }
    const sourceType = row.ownerType === "project" ? "project" : "module_record";
    const item = items.get(`${sourceType}:${row.ownerId}`);
    if (!item?.projectId || !item.projectName) return [];
    return [{
      key: `${sourceType}:${row.ownerId}`,
      sourceType,
      sourceId: row.ownerId,
      projectId: item.projectId,
      projectName: item.projectName,
      documentId: null,
      chunkIndex: null,
      blockIds: [],
      headingPath: [],
      title: item.title,
      content: item.content,
      tokenCount: estimateTokens(item.content),
      tier,
      vectorScore: row.score,
      rrfScore: 0,
      feedbackMultiplier: 1,
      manualMultiplier: 1,
      finalScore: 0,
    }];
  });
}

async function recallConcepts(
  db: DatabaseClient,
  tenantId: string,
  visibleIds: string[],
  query: string,
  queryEmbedding: number[] | null,
  tier: { tier: "active_project" | "tenant_global"; projectId: string | null },
) {
  let concepts: Array<{ id: string; score: number }> = [];
  if (queryEmbedding) {
    const distance = cosineDistance(knowledgeEmbeddings.embedding, queryEmbedding);
    const rows = await db
      .select({ id: knowledgeConcepts.id, distance })
      .from(knowledgeEmbeddings)
      .innerJoin(knowledgeConcepts, eq(knowledgeEmbeddings.ownerId, knowledgeConcepts.id))
      .where(and(
        eq(knowledgeEmbeddings.tenantId, tenantId),
        eq(knowledgeEmbeddings.ownerType, "concept"),
        eq(knowledgeConcepts.status, "active"),
        isNull(knowledgeEmbeddings.deletedAt),
        isNull(knowledgeConcepts.deletedAt),
      ))
      .orderBy(asc(distance))
      .limit(5);
    concepts = rows.map((row) => ({ id: row.id, score: Math.max(0, 1 - Number(row.distance)) }));
  } else {
    const pattern = `%${query.trim().slice(0, 64)}%`;
    const rows = await db
      .select({ id: knowledgeConcepts.id })
      .from(knowledgeConcepts)
      .where(and(
        eq(knowledgeConcepts.tenantId, tenantId),
        eq(knowledgeConcepts.status, "active"),
        ilike(knowledgeConcepts.name, pattern),
        isNull(knowledgeConcepts.deletedAt),
      ))
      .limit(5);
    concepts = rows.map((row) => ({ id: row.id, score: 0.5 }));
  }
  if (concepts.length === 0) return [];
  const scoreByConcept = new Map(concepts.map((concept) => [concept.id, concept.score]));
  const mentionRows = await db
    .select({
      documentId: knowledgeEdges.sourceId,
      projectId: knowledgeEdges.sourceProjectId,
      conceptId: knowledgeEdges.targetId,
      weight: knowledgeEdges.weight,
    })
    .from(knowledgeEdges)
    .where(and(
      eq(knowledgeEdges.tenantId, tenantId),
      eq(knowledgeEdges.sourceType, "document"),
      eq(knowledgeEdges.targetType, "concept"),
      eq(knowledgeEdges.relation, "mentions"),
      eq(knowledgeEdges.status, "active"),
      inArray(knowledgeEdges.targetId, concepts.map((concept) => concept.id)),
      inArray(knowledgeEdges.sourceProjectId, visibleIds),
      tierProjectCondition(knowledgeEdges.sourceProjectId, tier),
      sql`${knowledgeEdges.evidence}->>'salience' = 'primary'`,
      isNull(knowledgeEdges.deletedAt),
    ))
    .orderBy(desc(knowledgeEdges.weight))
    .limit(30);
  const documentIds = [...new Set(mentionRows.map((row) => row.documentId))];
  if (documentIds.length === 0) return [];
  const chunks = await db
    .select({
      id: documentChunks.id,
      projectId: documentChunks.projectId,
      projectName: projects.name,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      blockIds: documentChunks.blockIds,
      headingPath: documentChunks.headingPath,
      title: documents.title,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .innerJoin(projects, eq(documentChunks.projectId, projects.id))
    .where(and(
      eq(documentChunks.tenantId, tenantId),
      inArray(documentChunks.documentId, documentIds),
      eq(documentChunks.isCurrent, true),
      isNull(documentChunks.deletedAt),
      isNull(documents.deletedAt),
      isNull(projects.deletedAt),
    ))
    .orderBy(asc(documentChunks.chunkIndex));
  const firstChunk = new Map<string, (typeof chunks)[number]>();
  for (const chunk of chunks) {
    if (!firstChunk.has(chunk.documentId)) firstChunk.set(chunk.documentId, chunk);
  }
  return mentionRows.flatMap((mention): RetrievalCandidate[] => {
    const chunk = firstChunk.get(mention.documentId);
    if (!chunk) return [];
    const score = mention.weight * (scoreByConcept.get(mention.conceptId) ?? 0.5);
    return [{
      key: `document_chunk:${chunk.id}`,
      sourceType: "document_chunk",
      sourceId: chunk.id,
      projectId: chunk.projectId,
      projectName: chunk.projectName,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      blockIds: chunk.blockIds,
      headingPath: chunk.headingPath,
      title: chunk.title,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      tier: tier.tier,
      conceptScore: score,
      conceptIds: [mention.conceptId],
      rrfScore: 0,
      feedbackMultiplier: 1,
      manualMultiplier: 1,
      finalScore: 0,
    }];
  }).sort((left, right) => (right.conceptScore ?? 0) - (left.conceptScore ?? 0)).slice(0, 30);
}

async function expandGraph(
  db: DatabaseClient,
  tenantId: string,
  visibleIds: string[],
  seeds: RetrievalCandidate[],
) {
  const documentSeeds = seeds.filter((seed) => seed.documentId).slice(0, 3);
  const seedIds = documentSeeds.flatMap((seed) => seed.documentId ? [seed.documentId] : []);
  if (seedIds.length === 0) return [];
  const seedById = new Map(documentSeeds.flatMap((seed) => seed.documentId
    ? [[seed.documentId, seed] as const]
    : []));
  const directRows = await db
    .select()
    .from(knowledgeEdges)
    .where(and(
      eq(knowledgeEdges.tenantId, tenantId),
      eq(knowledgeEdges.status, "active"),
      inArray(knowledgeEdges.relation, ["similar_to", "links", "relates_to"]),
      or(
        and(
          eq(knowledgeEdges.sourceType, "document"),
          inArray(knowledgeEdges.sourceId, seedIds),
          eq(knowledgeEdges.targetType, "document"),
        ),
        and(
          eq(knowledgeEdges.targetType, "document"),
          inArray(knowledgeEdges.targetId, seedIds),
          eq(knowledgeEdges.sourceType, "document"),
        ),
      ),
      isNull(knowledgeEdges.deletedAt),
    ))
    .orderBy(desc(knowledgeEdges.weight))
    .limit(30);
  const directLinks = directRows.flatMap((row): GraphExpansionLink[] => {
    const seedId = seedIds.includes(row.sourceId) ? row.sourceId : row.targetId;
    const target = seedIds.includes(row.sourceId) ? row.targetId : row.sourceId;
    if (seedIds.includes(target)) return [];
    return [{
      seedId,
      targetId: target,
      relation: row.relation as GraphExpansionLink["relation"],
      weight: row.weight,
      coefficient: row.relation === "similar_to" ? 0.5 : 0.6,
    }];
  });

  const seedMentions = await db
    .select({
      documentId: knowledgeEdges.sourceId,
      conceptId: knowledgeEdges.targetId,
      weight: knowledgeEdges.weight,
    })
    .from(knowledgeEdges)
    .where(and(
      eq(knowledgeEdges.tenantId, tenantId),
      eq(knowledgeEdges.sourceType, "document"),
      inArray(knowledgeEdges.sourceId, seedIds),
      eq(knowledgeEdges.targetType, "concept"),
      eq(knowledgeEdges.relation, "mentions"),
      eq(knowledgeEdges.status, "active"),
      sql`${knowledgeEdges.evidence}->>'salience' = 'primary'`,
      isNull(knowledgeEdges.deletedAt),
    ));
  const conceptIds = [...new Set(seedMentions.map((mention) => mention.conceptId))];
  const targetMentions = conceptIds.length === 0 ? [] : await db
    .select({
      documentId: knowledgeEdges.sourceId,
      projectId: knowledgeEdges.sourceProjectId,
      conceptId: knowledgeEdges.targetId,
      weight: knowledgeEdges.weight,
    })
    .from(knowledgeEdges)
    .where(and(
      eq(knowledgeEdges.tenantId, tenantId),
      eq(knowledgeEdges.sourceType, "document"),
      notInArray(knowledgeEdges.sourceId, seedIds),
      eq(knowledgeEdges.targetType, "concept"),
      inArray(knowledgeEdges.targetId, conceptIds),
      eq(knowledgeEdges.relation, "mentions"),
      eq(knowledgeEdges.status, "active"),
      inArray(knowledgeEdges.sourceProjectId, visibleIds),
      sql`${knowledgeEdges.evidence}->>'salience' = 'primary'`,
      isNull(knowledgeEdges.deletedAt),
    ))
    .orderBy(desc(knowledgeEdges.weight))
    .limit(30);
  const seedMentionsByConcept = new Map<string, typeof seedMentions>();
  for (const mention of seedMentions) {
    const values = seedMentionsByConcept.get(mention.conceptId) ?? [];
    values.push(mention);
    seedMentionsByConcept.set(mention.conceptId, values);
  }
  const conceptLinks = targetMentions.flatMap((target): GraphExpansionLink[] =>
    (seedMentionsByConcept.get(target.conceptId) ?? []).flatMap((seedMention) => {
      const seed = seedById.get(seedMention.documentId);
      if (!seed || seed.projectId === target.projectId) return [];
      return [{
        seedId: seedMention.documentId,
        targetId: target.documentId,
        relation: "mentions",
        weight: Math.min(seedMention.weight, target.weight),
        coefficient: 0.7,
        viaConceptIds: [target.conceptId],
      }];
    }),
  );
  const links = [...directLinks, ...conceptLinks]
    .sort((left, right) =>
      right.weight * right.coefficient - left.weight * left.coefficient)
    .slice(0, 30);
  const targetIds = [...new Set(links.map((link) => link.targetId))];
  if (targetIds.length === 0) return [];
  const chunks = await db
    .select({
      id: documentChunks.id,
      projectId: documentChunks.projectId,
      projectName: projects.name,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      blockIds: documentChunks.blockIds,
      headingPath: documentChunks.headingPath,
      title: documents.title,
      content: documentChunks.content,
      tokenCount: documentChunks.tokenCount,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .innerJoin(projects, eq(documentChunks.projectId, projects.id))
    .where(and(
      eq(documentChunks.tenantId, tenantId),
      inArray(documentChunks.documentId, targetIds),
      inArray(documentChunks.projectId, visibleIds),
      eq(documentChunks.isCurrent, true),
      isNull(documentChunks.deletedAt),
      isNull(documents.deletedAt),
      isNull(projects.deletedAt),
    ))
    .orderBy(asc(documentChunks.chunkIndex));
  const firstChunk = new Map<string, (typeof chunks)[number]>();
  for (const chunk of chunks) {
    if (!firstChunk.has(chunk.documentId)) firstChunk.set(chunk.documentId, chunk);
  }
  return links.flatMap((link): RetrievalCandidate[] => {
    const seed = seedById.get(link.seedId);
    const chunk = firstChunk.get(link.targetId);
    if (!seed || !chunk) return [];
    const score = seed.finalScore * link.weight * link.coefficient;
    return [{
      key: `document_chunk:${chunk.id}`,
      sourceType: "document_chunk",
      sourceId: chunk.id,
      projectId: chunk.projectId,
      projectName: chunk.projectName,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      blockIds: chunk.blockIds,
      headingPath: chunk.headingPath,
      title: chunk.title,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      tier: "graph_expanded",
      ...(link.viaConceptIds ? { conceptIds: link.viaConceptIds } : {}),
      rrfScore: score,
      feedbackMultiplier: 1,
      manualMultiplier: 1,
      finalScore: score,
      graphPath: {
        seedDocumentId: link.seedId,
        seedTitle: seed.title,
        relation: link.relation,
        weight: link.weight,
        ...(link.viaConceptIds ? { viaConceptIds: link.viaConceptIds } : {}),
      },
    }];
  }).sort((left, right) => right.finalScore - left.finalScore).slice(0, 6);
}

function deduplicateCandidates(candidates: RetrievalCandidate[]) {
  const byKey = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key);
    if (!existing || candidate.finalScore > existing.finalScore) {
      byKey.set(candidate.key, candidate);
    }
  }
  return [...byKey.values()];
}

async function calibrateCandidates(
  db: DatabaseClient,
  tenantId: string,
  candidates: RetrievalCandidate[],
) {
  const sourceIds = [...new Set(candidates.flatMap((candidate) => [
    candidate.sourceId,
    ...(candidate.documentId ? [candidate.documentId] : []),
    candidate.projectId,
    ...(candidate.conceptIds ?? []),
  ]))];
  if (sourceIds.length === 0) return;
  const scores = await db
    .select()
    .from(knowledgeSourceScores)
    .where(and(
      eq(knowledgeSourceScores.tenantId, tenantId),
      inArray(knowledgeSourceScores.sourceId, sourceIds),
      isNull(knowledgeSourceScores.deletedAt),
    ));
  const byKey = new Map(scores.map((score) => [`${score.sourceType}:${score.sourceId}`, score]));
  for (const candidate of candidates) {
    const source = byKey.get(`${candidate.sourceType}:${candidate.sourceId}`)
      ?? (candidate.documentId ? byKey.get(`document:${candidate.documentId}`) : undefined);
    candidate.feedbackMultiplier = source
      ? feedbackMultiplier(source.upCount, source.downCount)
      : 1;
    const manualKeys = new Set([
      `${candidate.sourceType}:${candidate.sourceId}`,
      ...(candidate.documentId ? [`document:${candidate.documentId}`] : []),
      `project:${candidate.projectId}`,
      ...(candidate.conceptIds ?? []).map((conceptId) => `concept:${conceptId}`),
    ]);
    const manualProduct = [...manualKeys]
      .map((key) => byKey.get(key)?.manualWeight ?? 1)
      .reduce((product, weight) => product * weight, 1);
    candidate.manualMultiplier = Math.max(0, Math.min(2, manualProduct));
    candidate.finalScore = candidate.rrfScore
      * candidate.feedbackMultiplier
      * candidate.manualMultiplier;
  }
  candidates.sort((left, right) => right.finalScore - left.finalScore);
}

function assembleBudget(env: ServerEnv, candidates: RetrievalCandidate[]) {
  const budget = env.KNOWLEDGE_CONTEXT_TOKEN_BUDGET;
  const activeTarget = Math.floor(budget * env.KNOWLEDGE_ACTIVE_PROJECT_MIN_RATIO);
  const graphLimit = Math.floor(budget * env.KNOWLEDGE_GRAPH_EXPANSION_MAX_RATIO);
  const active = candidates.filter((candidate) => candidate.tier === "active_project");
  const selected: RetrievalCandidate[] = [];
  const selectedKeys = new Set<string>();
  const perDocument = new Map<string, number>();
  let used = 0;
  let activeUsed = 0;
  let graphUsed = 0;

  const add = (candidate: RetrievalCandidate) => {
    if (selectedKeys.has(candidate.key)) return false;
    const documentKey = candidate.documentId ?? candidate.sourceId;
    if ((perDocument.get(documentKey) ?? 0) >= 3) return false;
    const remaining = budget - used;
    if (remaining <= 0) return false;
    const content = truncateToTokenBudget(candidate.content, Math.min(1200, remaining));
    const tokens = Math.max(1, Math.min(1200, remaining, estimateTokens(content)));
    if (candidate.tier === "graph_expanded" && graphUsed + tokens > graphLimit) return false;
    selected.push({ ...candidate, content, tokenCount: tokens });
    selectedKeys.add(candidate.key);
    perDocument.set(documentKey, (perDocument.get(documentKey) ?? 0) + 1);
    used += tokens;
    if (candidate.tier === "active_project") activeUsed += tokens;
    if (candidate.tier === "graph_expanded") graphUsed += tokens;
    return true;
  };

  for (const candidate of active) {
    if (activeUsed >= activeTarget || used >= budget) break;
    add(candidate);
  }
  for (const candidate of candidates) {
    if (used >= budget) break;
    add(candidate);
  }
  return selected;
}

function tierProjectCondition(
  column: typeof documentChunks.projectId | typeof searchItems.projectId | typeof knowledgeEmbeddings.projectId | typeof knowledgeEdges.sourceProjectId,
  tier: { tier: "active_project" | "tenant_global"; projectId: string | null },
) {
  if (!tier.projectId) return undefined;
  return tier.tier === "active_project" ? eq(column, tier.projectId) : ne(column, tier.projectId);
}

function toRetrievalTrace(candidate: RetrievalCandidate): CitationRetrievalTrace {
  return {
    ...(candidate.ftsRank !== undefined ? { ftsRank: candidate.ftsRank } : {}),
    ...(candidate.vectorScore !== undefined ? { vectorScore: candidate.vectorScore } : {}),
    ...(candidate.conceptScore !== undefined ? { conceptScore: candidate.conceptScore } : {}),
    rrfScore: candidate.rrfScore,
    feedbackMultiplier: candidate.feedbackMultiplier,
    manualMultiplier: candidate.manualMultiplier,
    finalScore: candidate.finalScore,
    ...(candidate.graphPath ? { graphPath: candidate.graphPath } : {}),
  };
}

function traceCandidates(candidates: RetrievalCandidate[]) {
  return candidates.slice(0, 20).map((candidate) => ({
    key: candidate.key,
    projectId: candidate.projectId,
    tier: candidate.tier,
    ftsRank: candidate.ftsRank,
    vectorScore: candidate.vectorScore,
    conceptScore: candidate.conceptScore,
    rrfScore: candidate.rrfScore,
    finalScore: candidate.finalScore,
  }));
}
