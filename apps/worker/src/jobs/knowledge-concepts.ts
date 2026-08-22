// 抽取、归并并治理 L2 概念；相似概念只进入人工合并建议。
import type { ServerEnv } from "@sharebrain/config";
import { refreshKnowledgeConceptCounts } from "@sharebrain/db";
import {
  auditLogs,
  knowledgeConceptAliases,
  knowledgeConcepts,
  knowledgeEdges,
  knowledgeEmbeddings,
  knowledgeMergeProposals,
} from "@sharebrain/db/schema";
import {
  isConceptStopword,
  normalizeConceptName,
} from "@sharebrain/knowledge";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  embedKnowledgeTexts,
  embeddingModelTag,
  extractKnowledgeConcepts,
  isEmbeddingConfigured,
} from "../knowledge-ai";
import { cosineSimilarity } from "./knowledge-similarity";

import type { DatabaseClient } from "@sharebrain/db";

type ConceptRow = typeof knowledgeConcepts.$inferSelect;

export async function extractAndStoreDocumentConcepts(
  db: DatabaseClient,
  env: ServerEnv,
  input: {
    jobId: string;
    tenantId: string;
    documentId: string;
    projectId: string;
    actorId: string;
    text: string;
    documentEmbedding: number[];
    now?: Date;
  },
) {
  if (!env.KNOWLEDGE_CONCEPT_EXTRACTION_ENABLED || input.text.length < 200) {
    return { extracted: 0, created: 0, mentions: 0, relations: 0 };
  }
  const now = input.now ?? new Date();
  const concepts = await db
    .select()
    .from(knowledgeConcepts)
    .where(
      and(
        eq(knowledgeConcepts.tenantId, input.tenantId),
        isNull(knowledgeConcepts.deletedAt),
      ),
    );
  const aliases = await db
    .select()
    .from(knowledgeConceptAliases)
    .where(
      and(
        eq(knowledgeConceptAliases.tenantId, input.tenantId),
        isNull(knowledgeConceptAliases.deletedAt),
      ),
    );
  const model = embeddingModelTag(env);
  const conceptEmbeddings = isEmbeddingConfigured(env)
    ? await db
        .select()
        .from(knowledgeEmbeddings)
        .where(
          and(
            eq(knowledgeEmbeddings.tenantId, input.tenantId),
            eq(knowledgeEmbeddings.ownerType, "concept"),
            eq(knowledgeEmbeddings.model, model),
            isNull(knowledgeEmbeddings.deletedAt),
          ),
        )
    : [];
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const aliasesByConcept = new Map<string, string[]>();
  for (const alias of aliases) {
    aliasesByConcept.set(alias.conceptId, [
      ...(aliasesByConcept.get(alias.conceptId) ?? []),
      alias.alias,
    ]);
  }
  const candidates = conceptEmbeddings
    .map((embedding) => ({
      concept: conceptById.get(embedding.ownerId),
      score: cosineSimilarity(input.documentEmbedding, embedding.embedding),
    }))
    .filter((item): item is { concept: ConceptRow; score: number } => !!item.concept)
    .sort((left, right) => right.score - left.score)
    .slice(0, 30)
    .map((item) => ({
      id: item.concept.id,
      name: item.concept.name,
      aliases: aliasesByConcept.get(item.concept.id) ?? [],
      description: item.concept.description,
    }));
  const extraction = await extractKnowledgeConcepts(env, {
    text: input.text,
    candidates: JSON.stringify(candidates),
  });
  const valid = extraction.concepts.filter(
    (concept) =>
      !isConceptStopword(concept.name) &&
      concept.evidenceQuotes.every((quote) => input.text.includes(quote)),
  );

  const normalizedConcepts = new Map(
    concepts.map((concept) => [concept.normalizedName, concept]),
  );
  const aliasTargets = new Map(
    aliases.map((alias) => [alias.normalizedAlias, conceptById.get(alias.conceptId)]),
  );
  const resolvedByName = new Map<string, ConceptRow>();
  const createdConcepts: ConceptRow[] = [];
  let mentions = 0;

  for (const extracted of valid) {
    const normalized = normalizeConceptName(extracted.name);
    const direct = extracted.existingId ? conceptById.get(extracted.existingId) : undefined;
    const matched = direct ?? normalizedConcepts.get(normalized) ?? aliasTargets.get(normalized);
    const canonical = matched?.status === "merged" && matched.canonicalId
      ? conceptById.get(matched.canonicalId)
      : matched;
    if (canonical?.status === "rejected") continue;

    let concept = canonical;
    if (!concept) {
      const [inserted] = await db
        .insert(knowledgeConcepts)
        .values({
          tenantId: input.tenantId,
          name: extracted.name,
          normalizedName: normalized,
          type: extracted.type,
          description: extracted.description,
          status: "proposed",
          origin: "ai",
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      concept = inserted ?? (await findConceptByNormalizedName(db, input.tenantId, normalized));
      if (!concept || concept.status === "rejected") continue;
      if (inserted) {
        createdConcepts.push(inserted);
        concepts.push(inserted);
        conceptById.set(inserted.id, inserted);
        normalizedConcepts.set(normalized, inserted);
      }
    }

    for (const aliasValue of extracted.aliases) {
      const normalizedAlias = normalizeConceptName(aliasValue);
      if (!normalizedAlias || isConceptStopword(normalizedAlias)) continue;
      await db.insert(knowledgeConceptAliases).values({
        tenantId: input.tenantId,
        conceptId: concept.id,
        alias: aliasValue,
        normalizedAlias,
        origin: "ai",
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
    }

    const weight = extracted.salience === "primary" ? 1 : extracted.salience === "secondary" ? 0.65 : 0.35;
    await db.insert(knowledgeEdges).values({
      tenantId: input.tenantId,
      sourceType: "document",
      sourceId: input.documentId,
      sourceProjectId: input.projectId,
      targetType: "concept",
      targetId: concept.id,
      targetProjectId: null,
      relation: "mentions",
      weight,
      origin: "ai",
      status: concept.status === "active" ? "active" : "proposed",
      evidence: {
        kind: "mention",
        salience: extracted.salience,
        chunkIds: [],
        quotes: extracted.evidenceQuotes,
      },
      computedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        knowledgeEdges.tenantId,
        knowledgeEdges.sourceType,
        knowledgeEdges.sourceId,
        knowledgeEdges.targetType,
        knowledgeEdges.targetId,
        knowledgeEdges.relation,
      ],
      set: {
        weight,
        status: concept.status === "active" ? "active" : "proposed",
        evidence: {
          kind: "mention",
          salience: extracted.salience,
          chunkIds: [],
          quotes: extracted.evidenceQuotes,
        },
        computedAt: now,
        updatedBy: input.actorId,
        updatedAt: now,
      },
    });
    resolvedByName.set(normalized, concept);
    for (const alias of extracted.aliases) {
      resolvedByName.set(normalizeConceptName(alias), concept);
    }
    mentions += 1;
  }

  let relations = 0;
  for (const relation of extraction.conceptRelations) {
    const source = resolveExtractionConcept(relation.sourceName, resolvedByName, normalizedConcepts, aliasTargets);
    const target = resolveExtractionConcept(relation.targetName, resolvedByName, normalizedConcepts, aliasTargets);
    if (!source || !target || source.id === target.id) continue;
    await db.insert(knowledgeEdges).values({
      tenantId: input.tenantId,
      sourceType: "concept",
      sourceId: source.id,
      sourceProjectId: null,
      targetType: "concept",
      targetId: target.id,
      targetProjectId: null,
      relation: relation.relation,
      weight: relation.confidence,
      origin: "ai",
      status: "proposed",
      evidence: { kind: "manual", note: "AI extraction proposal" },
      computedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        knowledgeEdges.tenantId,
        knowledgeEdges.sourceType,
        knowledgeEdges.sourceId,
        knowledgeEdges.targetType,
        knowledgeEdges.targetId,
        knowledgeEdges.relation,
      ],
      set: { weight: relation.confidence, computedAt: now, updatedAt: now },
    });
    relations += 1;
  }

  if (createdConcepts.length > 0 && isEmbeddingConfigured(env)) {
    await embedNewConcepts(db, env, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.actorId,
      createdConcepts,
      existingEmbeddings: conceptEmbeddings,
      now,
    });
  }
  await refreshKnowledgeConceptCounts(db, input.tenantId, concepts.map((concept) => concept.id), input.actorId, now);
  await db.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "ai.concept_extraction",
    resourceType: "knowledge_index_job",
    resourceId: input.jobId,
    projectId: input.projectId,
    documentId: input.documentId,
    metadata: {
      jobId: input.jobId,
      targetType: "document",
      targetId: input.documentId,
      extracted: extraction.concepts.length,
      accepted: valid.length,
      model: env.AI_EXTRACTION_MODEL || env.AI_MODEL,
      requestId: crypto.randomUUID(),
    },
    createdBy: input.actorId,
    updatedBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  });
  return { extracted: extraction.concepts.length, created: createdConcepts.length, mentions, relations };
}

async function findConceptByNormalizedName(db: DatabaseClient, tenantId: string, normalizedName: string) {
  const [concept] = await db
    .select()
    .from(knowledgeConcepts)
    .where(
      and(
        eq(knowledgeConcepts.tenantId, tenantId),
        eq(knowledgeConcepts.normalizedName, normalizedName),
        inArray(knowledgeConcepts.status, ["proposed", "active"]),
        isNull(knowledgeConcepts.deletedAt),
      ),
    )
    .limit(1);
  return concept;
}

function resolveExtractionConcept(
  name: string,
  resolved: Map<string, ConceptRow>,
  normalized: Map<string, ConceptRow>,
  aliases: Map<string, ConceptRow | undefined>,
) {
  const key = normalizeConceptName(name);
  return resolved.get(key) ?? normalized.get(key) ?? aliases.get(key);
}

async function embedNewConcepts(
  db: DatabaseClient,
  env: ServerEnv,
  input: {
    tenantId: string;
    projectId: string;
    actorId: string;
    createdConcepts: ConceptRow[];
    existingEmbeddings: Array<typeof knowledgeEmbeddings.$inferSelect>;
    now: Date;
  },
) {
  const model = embeddingModelTag(env);
  const vectors = await embedKnowledgeTexts(
    env,
    input.createdConcepts.map((concept) => `${concept.name}\n${concept.description ?? ""}`),
  );
  for (const [index, concept] of input.createdConcepts.entries()) {
    const vector = vectors[index];
    if (!vector) continue;
    await db.insert(knowledgeEmbeddings).values({
      tenantId: input.tenantId,
      ownerType: "concept",
      ownerId: concept.id,
      projectId: null,
      model,
      embedding: vector,
      contentHash: await sha256(`${concept.name}\n${concept.description ?? ""}`),
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: input.now,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [
        knowledgeEmbeddings.tenantId,
        knowledgeEmbeddings.ownerType,
        knowledgeEmbeddings.ownerId,
        knowledgeEmbeddings.model,
      ],
      set: { embedding: vector, updatedBy: input.actorId, updatedAt: input.now },
    });

    for (const existing of input.existingEmbeddings) {
      if (existing.ownerId === concept.id) continue;
      const similarity = cosineSimilarity(vector, existing.embedding);
      if (similarity < 0.9) continue;
      const sourceFirst = concept.id < existing.ownerId;
      await db.insert(knowledgeMergeProposals).values({
        tenantId: input.tenantId,
        sourceConceptId: sourceFirst ? concept.id : existing.ownerId,
        targetConceptId: sourceFirst ? existing.ownerId : concept.id,
        similarity,
        status: "proposed",
        evidence: { kind: "concept_similarity", model },
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: [
          knowledgeMergeProposals.tenantId,
          knowledgeMergeProposals.sourceConceptId,
          knowledgeMergeProposals.targetConceptId,
        ],
        set: { similarity, status: "proposed", updatedAt: input.now },
      });
    }
  }
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
