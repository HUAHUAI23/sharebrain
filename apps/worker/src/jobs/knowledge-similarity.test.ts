// 验证文档相似边的 top-k 限流、双端选择权和可解释标题证据。
import "@sharebrain/config/dotenv";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadServerEnv } from "@sharebrain/config";
import { createDatabaseClient } from "@sharebrain/db";
import {
  documentChunks,
  documentRevisions,
  documents,
  KNOWLEDGE_EMBEDDING_DIM,
  knowledgeEdges,
  knowledgeEmbeddings,
  projectModules,
  projects,
  tenants,
  users,
} from "@sharebrain/db/schema";
import { and, eq, or } from "drizzle-orm";

import { refreshDocumentSimilarityEdges } from "./knowledge-similarity";

const env = loadServerEnv();
const db = createDatabaseClient(env.DATABASE_URL);
const tenantId = crypto.randomUUID();
const actorId = crypto.randomUUID();
const projectIds = [crypto.randomUUID(), crypto.randomUUID()];
const moduleIds = [crypto.randomUUID(), crypto.randomUUID()];
const sourceDocumentId = crypto.randomUUID();
const model = "similarity-test@1024";
const sharedHeadingValues = Array.from({ length: 10 }, (_, index) =>
  `Heading ${String(index + 1).padStart(2, "0")}`);
const candidates = [
  ...[0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92].map((score, index) => ({
    id: crypto.randomUUID(),
    projectId: projectIds[1]!,
    score,
    label: `cross-${index}`,
  })),
  ...[0.91, 0.90, 0.89, 0.88, 0.87].map((score, index) => ({
    id: crypto.randomUUID(),
    projectId: projectIds[0]!,
    score,
    label: `same-${index}`,
  })),
  {
    id: crypto.randomUUID(),
    projectId: projectIds[0]!,
    score: 0.5,
    label: "below-threshold",
  },
];
const allDocuments = [
  { id: sourceDocumentId, projectId: projectIds[0]!, label: "source", score: 1 },
  ...candidates,
];
const revisionByDocument = new Map(
  allDocuments.map((document) => [document.id, crypto.randomUUID()]),
);

function vectorWithSourceCosine(score: number) {
  const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIM).fill(0);
  vector[0] = score;
  vector[1] = Math.sqrt(Math.max(0, 1 - score ** 2));
  return vector;
}

function edgeFor(leftId: string, rightId: string) {
  return and(
    eq(knowledgeEdges.tenantId, tenantId),
    eq(knowledgeEdges.relation, "similar_to"),
    or(
      and(eq(knowledgeEdges.sourceId, leftId), eq(knowledgeEdges.targetId, rightId)),
      and(eq(knowledgeEdges.sourceId, rightId), eq(knowledgeEdges.targetId, leftId)),
    ),
  );
}

beforeAll(async () => {
  await db.insert(tenants).values({
    id: tenantId,
    tenantId,
    name: "Knowledge similarity tenant",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(users).values({
    id: actorId,
    tenantId,
    email: `${actorId}@similarity.test`,
    displayName: "Similarity Actor",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await db.insert(projects).values(projectIds.map((id, index) => ({
    id,
    tenantId,
    name: `Similarity project ${index + 1}`,
    ownerId: actorId,
    createdBy: actorId,
    updatedBy: actorId,
  })));
  await db.insert(projectModules).values(moduleIds.map((id, index) => ({
    id,
    tenantId,
    projectId: projectIds[index]!,
    key: "documents",
    name: "Documents",
    kind: "documents",
    sortKey: "a0",
    createdBy: actorId,
    updatedBy: actorId,
  })));
  await db.insert(documents).values(allDocuments.map((document, index) => ({
    id: document.id,
    tenantId,
    projectId: document.projectId,
    moduleId: document.projectId === projectIds[0] ? moduleIds[0]! : moduleIds[1]!,
    title: document.label,
    sortKey: `similarity-${String(index).padStart(2, "0")}`,
    createdBy: actorId,
    updatedBy: actorId,
  })));
  await db.insert(documentRevisions).values(allDocuments.map((document) => ({
    id: revisionByDocument.get(document.id)!,
    tenantId,
    documentId: document.id,
    formatVersion: 1,
    contentHash: `revision-${document.id}`,
    plateJson: [{ type: "p", children: [{ text: document.label }] }],
    plainText: document.label,
    createdBy: actorId,
    updatedBy: actorId,
  })));
  await db.insert(documentChunks).values(allDocuments.map((document, index) => ({
    tenantId,
    projectId: document.projectId,
    documentId: document.id,
    revisionId: revisionByDocument.get(document.id)!,
    chunkIndex: 0,
    blockIds: [`block-${index}`],
    headingPath: document.id === sourceDocumentId || document.id === candidates[0]!.id
      ? [...sharedHeadingValues].reverse()
      : ["Other heading"],
    content: document.label,
    embedText: document.label,
    contentHash: `chunk-${document.id}`,
    searchText: document.label,
    tokenCount: 1,
    createdBy: actorId,
    updatedBy: actorId,
  })));
  await db.insert(knowledgeEmbeddings).values(allDocuments.map((document) => ({
    tenantId,
    ownerType: "document",
    ownerId: document.id,
    projectId: document.projectId,
    model,
    embedding: vectorWithSourceCosine(document.score),
    contentHash: `embedding-${document.id}`,
    createdBy: actorId,
    updatedBy: actorId,
  })));
});

beforeEach(async () => {
  await db.delete(knowledgeEdges).where(eq(knowledgeEdges.tenantId, tenantId));
});

afterAll(async () => {
  await db.delete(knowledgeEdges).where(eq(knowledgeEdges.tenantId, tenantId));
  await db.delete(knowledgeEmbeddings).where(eq(knowledgeEmbeddings.tenantId, tenantId));
  await db.delete(documentChunks).where(eq(documentChunks.tenantId, tenantId));
  await db.delete(documentRevisions).where(eq(documentRevisions.tenantId, tenantId));
  await db.delete(documents).where(eq(documents.tenantId, tenantId));
  await db.delete(projectModules).where(eq(projectModules.tenantId, tenantId));
  await db.delete(projects).where(eq(projects.tenantId, tenantId));
  await db.delete(users).where(eq(users.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await db.$client.end({ timeout: 1 });
});

describe("knowledge similarity", () => {
  test("applies threshold, top-10, and the six cross-project edge cap", async () => {
    expect(await refreshDocumentSimilarityEdges(db, {
      tenantId,
      documentId: sourceDocumentId,
      projectId: projectIds[0]!,
      model,
      threshold: 0.72,
      actorId,
    })).toBe(10);

    const edges = await db.select().from(knowledgeEdges).where(and(
      eq(knowledgeEdges.tenantId, tenantId),
      or(
        eq(knowledgeEdges.sourceId, sourceDocumentId),
        eq(knowledgeEdges.targetId, sourceDocumentId),
      ),
    ));
    const crossProjectEdges = edges.filter((edge) =>
      edge.sourceProjectId !== edge.targetProjectId);
    const selectedTargetIds = new Set(edges.map((edge) =>
      edge.sourceId === sourceDocumentId ? edge.targetId : edge.sourceId));

    expect(edges).toHaveLength(10);
    expect(crossProjectEdges).toHaveLength(6);
    expect(selectedTargetIds.has(candidates.find((item) => item.label === "cross-6")!.id)).toBe(false);
    expect(selectedTargetIds.has(candidates.find((item) => item.label === "same-4")!.id)).toBe(false);
    expect(selectedTargetIds.has(candidates.find((item) => item.label === "below-threshold")!.id)).toBe(false);
  });

  test("does not remove an incoming edge selected by the other document", async () => {
    const candidate = candidates[0]!;
    await refreshDocumentSimilarityEdges(db, {
      tenantId,
      documentId: sourceDocumentId,
      projectId: projectIds[0]!,
      model,
      threshold: 0.72,
      actorId,
    });

    expect(await refreshDocumentSimilarityEdges(db, {
      tenantId,
      documentId: candidate.id,
      projectId: candidate.projectId,
      model,
      threshold: 1,
      actorId,
    })).toBe(0);
    const [preserved] = await db.select().from(knowledgeEdges)
      .where(edgeFor(sourceDocumentId, candidate.id));
    expect(preserved?.evidence).toMatchObject({ selectedBy: [sourceDocumentId] });

    await refreshDocumentSimilarityEdges(db, {
      tenantId,
      documentId: sourceDocumentId,
      projectId: projectIds[0]!,
      model,
      threshold: 1,
      actorId,
    });
    expect(await db.select().from(knowledgeEdges)
      .where(edgeFor(sourceDocumentId, candidate.id))).toHaveLength(0);
  });

  test("stores sorted and bounded shared heading evidence", async () => {
    const candidate = candidates[0]!;
    await refreshDocumentSimilarityEdges(db, {
      tenantId,
      documentId: sourceDocumentId,
      projectId: projectIds[0]!,
      model,
      threshold: 0.72,
      actorId,
    });

    const [edge] = await db.select().from(knowledgeEdges)
      .where(edgeFor(sourceDocumentId, candidate.id));
    expect(edge?.evidence).toMatchObject({
      kind: "similarity",
      model,
      selectedBy: [sourceDocumentId],
      sharedHeadings: [...sharedHeadingValues].sort().slice(0, 8),
    });
  });
});
