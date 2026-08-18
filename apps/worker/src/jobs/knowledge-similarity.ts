// 基于 document embedding 增量维护规范序的 similar_to 边。
import {
  documentChunks,
  knowledgeEdges,
  knowledgeEmbeddings,
} from "@sharebrain/db/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "@sharebrain/db";

const MAX_SHARED_HEADINGS = 8;

type SimilarityEvidence = {
  kind: "similarity";
  cosine: number;
  model: string;
  sharedHeadings: string[];
  selectedBy: string[];
};

export function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
}

function canonicalEdge(leftId: string, rightId: string) {
  return leftId < rightId
    ? { sourceId: leftId, targetId: rightId }
    : { sourceId: rightId, targetId: leftId };
}

function edgeKey(leftId: string, rightId: string) {
  const edge = canonicalEdge(leftId, rightId);
  return `${edge.sourceId}:${edge.targetId}`;
}

function selectedByFromEvidence(
  evidence: Record<string, unknown>,
  sourceId: string,
  targetId: string,
  refreshingDocumentId: string,
) {
  if (Array.isArray(evidence.selectedBy)) {
    const endpoints = new Set([sourceId, targetId]);
    return new Set(
      evidence.selectedBy.filter(
        (selector): selector is string => typeof selector === "string" && endpoints.has(selector),
      ),
    );
  }

  // 旧边没有选择权信息。保守视为由另一端选中，待另一端刷新时自然收敛。
  return new Set([sourceId === refreshingDocumentId ? targetId : sourceId]);
}

function collectHeadings(
  rows: Array<{ documentId: string; headingPath: string[] }>,
) {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const headings = result.get(row.documentId) ?? new Set<string>();
    for (const heading of row.headingPath) {
      const value = heading.trim();
      if (value) headings.add(value);
    }
    result.set(row.documentId, headings);
  }
  return result;
}

function sharedHeadings(
  headingsByDocument: Map<string, Set<string>>,
  leftId: string,
  rightId: string,
) {
  const left = headingsByDocument.get(leftId) ?? new Set<string>();
  const right = headingsByDocument.get(rightId) ?? new Set<string>();
  return [...left]
    .filter((heading) => right.has(heading))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SHARED_HEADINGS);
}

export async function refreshDocumentSimilarityEdges(
  db: DatabaseClient,
  input: {
    tenantId: string;
    documentId: string;
    projectId: string;
    model: string;
    threshold: number;
    actorId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [source] = await db
    .select()
    .from(knowledgeEmbeddings)
    .where(
      and(
        eq(knowledgeEmbeddings.tenantId, input.tenantId),
        eq(knowledgeEmbeddings.ownerType, "document"),
        eq(knowledgeEmbeddings.ownerId, input.documentId),
        eq(knowledgeEmbeddings.model, input.model),
        isNull(knowledgeEmbeddings.deletedAt),
      ),
    )
    .limit(1);
  if (!source) return 0;

  const candidates = await db
    .select()
    .from(knowledgeEmbeddings)
    .where(
      and(
        eq(knowledgeEmbeddings.tenantId, input.tenantId),
        eq(knowledgeEmbeddings.ownerType, "document"),
        eq(knowledgeEmbeddings.model, input.model),
        isNull(knowledgeEmbeddings.deletedAt),
      ),
    );
  const ranked = candidates
    .filter((candidate) => candidate.ownerId !== input.documentId)
    .map((candidate) => ({ candidate, score: cosineSimilarity(source.embedding, candidate.embedding) }))
    .filter((item) => item.score >= input.threshold)
    .sort((left, right) =>
      right.score - left.score || left.candidate.ownerId.localeCompare(right.candidate.ownerId));

  const selected: typeof ranked = [];
  let crossProject = 0;
  for (const item of ranked) {
    if (selected.length >= 10) break;
    if (item.candidate.projectId !== input.projectId) {
      if (crossProject >= 6) continue;
      crossProject += 1;
    }
    selected.push(item);
  }

  const documentIds = [input.documentId, ...selected.map((item) => item.candidate.ownerId)];
  const headingRows = documentIds.length > 0
    ? await db
        .select({
          documentId: documentChunks.documentId,
          headingPath: documentChunks.headingPath,
        })
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.tenantId, input.tenantId),
            inArray(documentChunks.documentId, documentIds),
            eq(documentChunks.isCurrent, true),
            isNull(documentChunks.deletedAt),
          ),
        )
    : [];
  const headingsByDocument = collectHeadings(headingRows);

  await db.transaction(async (tx) => {
    const initialEdges = await tx
      .select({ sourceId: knowledgeEdges.sourceId, targetId: knowledgeEdges.targetId })
      .from(knowledgeEdges)
      .where(
        and(
          eq(knowledgeEdges.tenantId, input.tenantId),
          eq(knowledgeEdges.sourceType, "document"),
          eq(knowledgeEdges.targetType, "document"),
          eq(knowledgeEdges.relation, "similar_to"),
          eq(knowledgeEdges.origin, "embedding"),
          or(
            eq(knowledgeEdges.sourceId, input.documentId),
            eq(knowledgeEdges.targetId, input.documentId),
          ),
        ),
      );

    const lockKeys = new Set(
      initialEdges.map((edge) => edgeKey(edge.sourceId, edge.targetId)),
    );
    for (const item of selected) {
      lockKeys.add(edgeKey(input.documentId, item.candidate.ownerId));
    }
    for (const key of [...lockKeys].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-similarity:${input.tenantId}:${key}`}, 0))`);
    }

    const existingEdges = await tx
      .select()
      .from(knowledgeEdges)
      .where(
        and(
          eq(knowledgeEdges.tenantId, input.tenantId),
          eq(knowledgeEdges.sourceType, "document"),
          eq(knowledgeEdges.targetType, "document"),
          eq(knowledgeEdges.relation, "similar_to"),
          eq(knowledgeEdges.origin, "embedding"),
          or(
            eq(knowledgeEdges.sourceId, input.documentId),
            eq(knowledgeEdges.targetId, input.documentId),
          ),
        ),
      );
    const selectorsByEdge = new Map<string, Set<string>>();
    for (const edge of existingEdges) {
      const selectors = selectedByFromEvidence(
        edge.evidence,
        edge.sourceId,
        edge.targetId,
        input.documentId,
      );
      selectors.delete(input.documentId);
      const key = edgeKey(edge.sourceId, edge.targetId);
      selectorsByEdge.set(key, selectors);
      if (selectors.size === 0) {
        await tx.delete(knowledgeEdges).where(eq(knowledgeEdges.id, edge.id));
        continue;
      }
      await tx.update(knowledgeEdges).set({
        evidence: { ...edge.evidence, selectedBy: [...selectors].sort() },
        updatedBy: input.actorId,
        updatedAt: now,
      }).where(eq(knowledgeEdges.id, edge.id));
    }

    for (const item of selected) {
      const canonical = canonicalEdge(input.documentId, item.candidate.ownerId);
      const key = edgeKey(input.documentId, item.candidate.ownerId);
      const selectors = selectorsByEdge.get(key) ?? new Set<string>();
      selectors.add(input.documentId);
      const evidence: SimilarityEvidence = {
        kind: "similarity",
        cosine: item.score,
        model: input.model,
        sharedHeadings: sharedHeadings(
          headingsByDocument,
          input.documentId,
          item.candidate.ownerId,
        ),
        selectedBy: [...selectors].sort(),
      };
      await tx.insert(knowledgeEdges).values({
        tenantId: input.tenantId,
        sourceType: "document",
        sourceId: canonical.sourceId,
        sourceProjectId: canonical.sourceId === input.documentId
          ? input.projectId
          : item.candidate.projectId,
        targetType: "document",
        targetId: canonical.targetId,
        targetProjectId: canonical.targetId === input.documentId
          ? input.projectId
          : item.candidate.projectId,
        relation: "similar_to",
        weight: item.score,
        origin: "embedding",
        status: "active",
        evidence,
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
          sourceProjectId: canonical.sourceId === input.documentId
            ? input.projectId
            : item.candidate.projectId,
          targetProjectId: canonical.targetId === input.documentId
            ? input.projectId
            : item.candidate.projectId,
          weight: item.score,
          origin: "embedding",
          status: "active",
          evidence,
          computedAt: now,
          updatedBy: input.actorId,
          updatedAt: now,
        },
      });
    }
  });
  return selected.length;
}
