// 提供知识概念、提议、关系图、来源权重、反馈分析与重索引的治理操作。
import type {
  AuthContext,
  KnowledgeConceptUpdate,
  KnowledgeProposalBatch,
  KnowledgeSourceListItem,
  KnowledgeSourceType,
} from "@sharebrain/contracts";
import {
  enqueueKnowledgeIndexJob,
  refreshKnowledgeConceptCounts,
  type DatabaseClient,
} from "@sharebrain/db";
import {
  aiFeedbackEvents,
  aiMessageCitations,
  auditLogs,
  documents,
  knowledgeConceptAliases,
  knowledgeConcepts,
  knowledgeEdges,
  knowledgeMergeProposals,
  knowledgeSourceScores,
  moduleRecords,
  projects,
} from "@sharebrain/db/schema";
import { normalizeConceptName } from "@sharebrain/knowledge";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { ApiError } from "../../app/api-error";
import { toIso } from "../shared/serializers";
import { requireVisibleProject } from "./knowledge-access";

type ProposalKind = "concept" | "relation" | "merge";
type GraphNodeType = "document" | "concept" | "project";
const ANALYTICS_TIERS = ["active_project", "tenant_global", "graph_expanded"] as const;

export class KnowledgeService {
  constructor(private readonly db: DatabaseClient) {}

  async listConcepts(
    auth: AuthContext,
    input: {
      status?: "proposed" | "active" | "rejected" | "merged";
      sort: "project_spread" | "mention_count";
      query?: string;
    },
  ) {
    const conditions = [
      eq(knowledgeConcepts.tenantId, auth.tenantId),
      isNull(knowledgeConcepts.deletedAt),
      ...(input.status ? [eq(knowledgeConcepts.status, input.status)] : []),
      ...(input.query ? [ilike(knowledgeConcepts.name, `%${input.query}%`)] : []),
    ];
    const rows = await this.db
      .select()
      .from(knowledgeConcepts)
      .where(and(...conditions))
      .orderBy(
        input.sort === "mention_count"
          ? desc(knowledgeConcepts.mentionCount)
          : desc(knowledgeConcepts.projectSpread),
        asc(knowledgeConcepts.name),
      )
      .limit(200);
    const aliases = rows.length === 0 ? [] : await this.db
      .select()
      .from(knowledgeConceptAliases)
      .where(and(
        eq(knowledgeConceptAliases.tenantId, auth.tenantId),
        inArray(knowledgeConceptAliases.conceptId, rows.map((row) => row.id)),
        isNull(knowledgeConceptAliases.deletedAt),
      ));
    const aliasesByConcept = new Map<string, string[]>();
    for (const alias of aliases) {
      const values = aliasesByConcept.get(alias.conceptId) ?? [];
      values.push(alias.alias);
      aliasesByConcept.set(alias.conceptId, values);
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalizedName,
      type: row.type,
      description: row.description,
      status: row.status,
      canonicalId: row.canonicalId,
      origin: row.origin,
      mentionCount: row.mentionCount,
      projectSpread: row.projectSpread,
      aliases: aliasesByConcept.get(row.id) ?? [],
    }));
  }

  async updateConcept(
    auth: AuthContext,
    conceptId: string,
    input: KnowledgeConceptUpdate,
  ) {
    this.requireAdmin(auth);
    const concept = await this.requireConcept(auth, conceptId);
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(knowledgeConcepts)
        .set({
          ...(input.name ? {
            name: input.name,
            normalizedName: normalizeConceptName(input.name),
          } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(and(
          eq(knowledgeConcepts.id, concept.id),
          eq(knowledgeConcepts.tenantId, auth.tenantId),
        ))
        .returning();
      if (input.status === "active" || input.status === "rejected") {
        await tx.update(knowledgeEdges).set({
          status: input.status,
          updatedBy: auth.userId,
          updatedAt: now,
        }).where(and(
          eq(knowledgeEdges.tenantId, auth.tenantId),
          eq(knowledgeEdges.sourceType, "document"),
          eq(knowledgeEdges.targetType, "concept"),
          eq(knowledgeEdges.targetId, concept.id),
          eq(knowledgeEdges.relation, "mentions"),
          inArray(knowledgeEdges.status, ["proposed", "active", "rejected"]),
          isNull(knowledgeEdges.deletedAt),
        ));
      }
      return row;
    });
    if (input.status) {
      await refreshKnowledgeConceptCounts(
        this.db,
        auth.tenantId,
        [concept.id],
        auth.userId,
        now,
      );
    }
    await this.audit(auth, "knowledge.concept_update", "knowledge_concept", concept.id, {
      before: concept,
      after: updated,
    });
    return updated;
  }

  async conceptDetail(auth: AuthContext, conceptId: string) {
    const concept = await this.requireConcept(auth, conceptId);
    const [aliases, mentions] = await Promise.all([
      this.db
        .select({ alias: knowledgeConceptAliases.alias })
        .from(knowledgeConceptAliases)
        .where(and(
          eq(knowledgeConceptAliases.tenantId, auth.tenantId),
          eq(knowledgeConceptAliases.conceptId, concept.id),
          isNull(knowledgeConceptAliases.deletedAt),
        ))
        .orderBy(asc(knowledgeConceptAliases.alias)),
      this.db
        .select({
          documentId: documents.id,
          documentTitle: documents.title,
          projectId: projects.id,
          projectName: projects.name,
          evidence: knowledgeEdges.evidence,
          weight: knowledgeEdges.weight,
          status: knowledgeEdges.status,
        })
        .from(knowledgeEdges)
        .innerJoin(documents, eq(knowledgeEdges.sourceId, documents.id))
        .innerJoin(projects, eq(documents.projectId, projects.id))
        .where(and(
          eq(knowledgeEdges.tenantId, auth.tenantId),
          eq(knowledgeEdges.sourceType, "document"),
          eq(knowledgeEdges.targetType, "concept"),
          eq(knowledgeEdges.targetId, concept.id),
          eq(knowledgeEdges.relation, "mentions"),
          eq(documents.tenantId, auth.tenantId),
          eq(projects.tenantId, auth.tenantId),
          isNull(knowledgeEdges.deletedAt),
          isNull(documents.deletedAt),
          isNull(projects.deletedAt),
        ))
        .orderBy(desc(knowledgeEdges.weight), asc(documents.title))
        .limit(100),
    ]);
    const projectCounts = new Map<string, { projectName: string; mentionCount: number }>();
    for (const mention of mentions) {
      const current = projectCounts.get(mention.projectId);
      projectCounts.set(mention.projectId, {
        projectName: mention.projectName,
        mentionCount: (current?.mentionCount ?? 0) + 1,
      });
    }
    return {
      id: concept.id,
      name: concept.name,
      normalizedName: concept.normalizedName,
      type: concept.type,
      description: concept.description,
      status: concept.status,
      canonicalId: concept.canonicalId,
      origin: concept.origin,
      mentionCount: concept.mentionCount,
      projectSpread: concept.projectSpread,
      aliases: aliases.map((item) => item.alias),
      mentions: mentions.map((mention) => ({
        documentId: mention.documentId,
        documentTitle: mention.documentTitle,
        projectId: mention.projectId,
        projectName: mention.projectName,
        salience: parseSalience(mention.evidence.salience),
        weight: mention.weight,
        status: parseEdgeStatus(mention.status),
      })),
      projectDistribution: [...projectCounts]
        .map(([projectId, item]) => ({ projectId, ...item }))
        .sort((left, right) => right.mentionCount - left.mentionCount),
    };
  }

  async mergeConcept(auth: AuthContext, sourceConceptId: string, targetConceptId: string) {
    this.requireAdmin(auth);
    if (sourceConceptId === targetConceptId) {
      throw new ApiError("CONCEPT_MERGE_INVALID", "概念不能合并到自身。", 422);
    }
    const [source, target] = await Promise.all([
      this.requireConcept(auth, sourceConceptId),
      this.requireConcept(auth, targetConceptId),
    ]);
    if (source.status === "merged" || target.status === "merged" || target.status === "rejected") {
      throw new ApiError("CONCEPT_MERGE_INVALID", "概念当前状态不允许合并。", 409);
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const aliases = await tx
        .select()
        .from(knowledgeConceptAliases)
        .where(and(
          eq(knowledgeConceptAliases.tenantId, auth.tenantId),
          eq(knowledgeConceptAliases.conceptId, source.id),
          isNull(knowledgeConceptAliases.deletedAt),
        ));
      for (const alias of [
        { alias: source.name, normalizedAlias: source.normalizedName },
        ...aliases.map((item) => ({ alias: item.alias, normalizedAlias: item.normalizedAlias })),
      ]) {
        await tx.insert(knowledgeConceptAliases).values({
          tenantId: auth.tenantId,
          conceptId: target.id,
          alias: alias.alias,
          normalizedAlias: alias.normalizedAlias,
          origin: "merge",
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }).onConflictDoUpdate({
          target: [knowledgeConceptAliases.tenantId, knowledgeConceptAliases.normalizedAlias],
          set: {
            conceptId: target.id,
            alias: alias.alias,
            origin: "merge",
            updatedAt: now,
            updatedBy: auth.userId,
          },
        });
      }
      const edges = await tx
        .select()
        .from(knowledgeEdges)
        .where(and(
          eq(knowledgeEdges.tenantId, auth.tenantId),
          or(
            and(eq(knowledgeEdges.sourceType, "concept"), eq(knowledgeEdges.sourceId, source.id)),
            and(eq(knowledgeEdges.targetType, "concept"), eq(knowledgeEdges.targetId, source.id)),
          ),
        ));
      for (const edge of edges) {
        const newSourceId = edge.sourceType === "concept" && edge.sourceId === source.id
          ? target.id
          : edge.sourceId;
        const newTargetId = edge.targetType === "concept" && edge.targetId === source.id
          ? target.id
          : edge.targetId;
        if (!(edge.sourceType === edge.targetType && newSourceId === newTargetId)) {
          await tx.insert(knowledgeEdges).values({
            tenantId: auth.tenantId,
            sourceType: edge.sourceType,
            sourceId: newSourceId,
            sourceProjectId: edge.sourceProjectId,
            targetType: edge.targetType,
            targetId: newTargetId,
            targetProjectId: edge.targetProjectId,
            relation: edge.relation,
            weight: edge.weight,
            origin: edge.origin,
            status: edge.status,
            evidence: edge.evidence,
            computedAt: edge.computedAt,
            createdBy: auth.userId,
            updatedBy: auth.userId,
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
              weight: sql`greatest(${knowledgeEdges.weight}, ${edge.weight})`,
              updatedAt: now,
              updatedBy: auth.userId,
            },
          });
        }
        await tx.delete(knowledgeEdges).where(and(
          eq(knowledgeEdges.id, edge.id),
          eq(knowledgeEdges.tenantId, auth.tenantId),
        ));
      }
      await tx.delete(knowledgeConceptAliases).where(and(
        eq(knowledgeConceptAliases.conceptId, source.id),
        eq(knowledgeConceptAliases.tenantId, auth.tenantId),
      ));
      await tx.update(knowledgeConcepts).set({
        status: "merged",
        canonicalId: target.id,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(knowledgeConcepts.id, source.id),
        eq(knowledgeConcepts.tenantId, auth.tenantId),
      ));
      await tx.update(knowledgeConcepts).set({
        status: "active",
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(knowledgeConcepts.id, target.id),
        eq(knowledgeConcepts.tenantId, auth.tenantId),
      ));
      await tx.update(knowledgeMergeProposals).set({
        status: "accepted",
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(knowledgeMergeProposals.tenantId, auth.tenantId),
        eq(knowledgeMergeProposals.sourceConceptId, source.id),
        eq(knowledgeMergeProposals.targetConceptId, target.id),
      ));
    });
    await refreshKnowledgeConceptCounts(
      this.db,
      auth.tenantId,
      [source.id, target.id],
      auth.userId,
      now,
    );
    const [afterSource, afterTarget] = await Promise.all([
      this.requireConcept(auth, source.id),
      this.requireConcept(auth, target.id),
    ]);
    await this.audit(auth, "knowledge.concept_merge", "knowledge_concept", source.id, {
      before: { source, target },
      after: { source: afterSource, target: afterTarget },
    });
    return { ok: true, sourceConceptId: source.id, targetConceptId: target.id };
  }

  async listProposals(auth: AuthContext, kind: ProposalKind) {
    if (kind === "concept") {
      const rows = await this.db.select().from(knowledgeConcepts).where(and(
        eq(knowledgeConcepts.tenantId, auth.tenantId),
        eq(knowledgeConcepts.status, "proposed"),
        isNull(knowledgeConcepts.deletedAt),
      )).orderBy(desc(knowledgeConcepts.createdAt)).limit(200);
      return rows.map((row) => ({
        id: row.id,
        kind,
        title: row.name,
        description: row.description,
        evidence: { type: row.type, mentionCount: row.mentionCount, projectSpread: row.projectSpread },
        createdAt: toIso(row.createdAt),
      }));
    }
    if (kind === "relation") {
      const rows = await this.db.select().from(knowledgeEdges).where(and(
        eq(knowledgeEdges.tenantId, auth.tenantId),
        eq(knowledgeEdges.status, "proposed"),
        isNull(knowledgeEdges.deletedAt),
      )).orderBy(desc(knowledgeEdges.createdAt)).limit(200);
      return rows.map((row) => ({
        id: row.id,
        kind,
        title: row.relation,
        description: `${row.sourceType} -> ${row.targetType}`,
        evidence: row.evidence,
        createdAt: toIso(row.createdAt),
      }));
    }
    const rows = await this.db.select({
      proposal: knowledgeMergeProposals,
      sourceName: sql<string>`source.name`,
      targetName: sql<string>`target.name`,
    }).from(knowledgeMergeProposals)
      .innerJoin(
        sql`${knowledgeConcepts} as source`,
        sql`source.id = ${knowledgeMergeProposals.sourceConceptId}`,
      )
      .innerJoin(
        sql`${knowledgeConcepts} as target`,
        sql`target.id = ${knowledgeMergeProposals.targetConceptId}`,
      )
      .where(and(
        eq(knowledgeMergeProposals.tenantId, auth.tenantId),
        eq(knowledgeMergeProposals.status, "proposed"),
        isNull(knowledgeMergeProposals.deletedAt),
      )).orderBy(desc(knowledgeMergeProposals.createdAt)).limit(200);
    return rows.map((row) => ({
      id: row.proposal.id,
      kind,
      title: `${row.sourceName} -> ${row.targetName}`,
      description: `相似度 ${row.proposal.similarity.toFixed(2)}`,
      evidence: row.proposal.evidence,
      createdAt: toIso(row.proposal.createdAt),
    }));
  }

  async decideProposalBatch(auth: AuthContext, input: KnowledgeProposalBatch) {
    this.requireAdmin(auth);
    const now = new Date();
    let decidedIds: string[] = [];
    if (input.kind === "concept") {
      const proposals = await this.db.select().from(knowledgeConcepts).where(and(
        eq(knowledgeConcepts.tenantId, auth.tenantId),
        inArray(knowledgeConcepts.id, input.ids),
        eq(knowledgeConcepts.status, "proposed"),
        isNull(knowledgeConcepts.deletedAt),
      ));
      decidedIds = proposals.map((proposal) => proposal.id);
      if (decidedIds.length > 0) {
        const nextStatus = input.decision === "accept" ? "active" : "rejected";
        await this.db.transaction(async (tx) => {
          await tx.update(knowledgeConcepts).set({
            status: nextStatus,
            updatedAt: now,
            updatedBy: auth.userId,
          }).where(and(
            eq(knowledgeConcepts.tenantId, auth.tenantId),
            inArray(knowledgeConcepts.id, decidedIds),
            eq(knowledgeConcepts.status, "proposed"),
          ));
          await tx.update(knowledgeEdges).set({
            status: nextStatus,
            updatedAt: now,
            updatedBy: auth.userId,
          }).where(and(
            eq(knowledgeEdges.tenantId, auth.tenantId),
            eq(knowledgeEdges.sourceType, "document"),
            eq(knowledgeEdges.targetType, "concept"),
            inArray(knowledgeEdges.targetId, decidedIds),
            eq(knowledgeEdges.relation, "mentions"),
            eq(knowledgeEdges.status, "proposed"),
            isNull(knowledgeEdges.deletedAt),
          ));
        });
        await refreshKnowledgeConceptCounts(
          this.db,
          auth.tenantId,
          decidedIds,
          auth.userId,
          now,
        );
        for (const proposal of proposals) {
          await this.audit(auth, "knowledge.concept_decision", "knowledge_concept", proposal.id, {
            before: { status: proposal.status },
            after: { status: nextStatus },
          });
        }
      }
    } else if (input.kind === "relation") {
      const proposals = await this.db.select().from(knowledgeEdges).where(and(
        eq(knowledgeEdges.tenantId, auth.tenantId),
        inArray(knowledgeEdges.id, input.ids),
        eq(knowledgeEdges.status, "proposed"),
        isNull(knowledgeEdges.deletedAt),
      ));
      decidedIds = proposals.map((proposal) => proposal.id);
      const nextStatus = input.decision === "accept" ? "active" : "rejected";
      await this.db.update(knowledgeEdges).set({
        status: nextStatus,
        updatedAt: now,
        updatedBy: auth.userId,
      }).where(and(
        eq(knowledgeEdges.tenantId, auth.tenantId),
        inArray(knowledgeEdges.id, decidedIds),
        eq(knowledgeEdges.status, "proposed"),
      ));
      for (const proposal of proposals) {
        await this.audit(auth, "knowledge.relation_decision", "knowledge_edge", proposal.id, {
          before: { status: proposal.status },
          after: { status: nextStatus },
        });
      }
    } else {
      const proposals = await this.db.select().from(knowledgeMergeProposals).where(and(
        eq(knowledgeMergeProposals.tenantId, auth.tenantId),
        inArray(knowledgeMergeProposals.id, input.ids),
        eq(knowledgeMergeProposals.status, "proposed"),
      ));
      decidedIds = proposals.map((proposal) => proposal.id);
      if (input.decision === "reject") {
        await this.db.update(knowledgeMergeProposals).set({
          status: "rejected",
          updatedAt: now,
          updatedBy: auth.userId,
        }).where(and(
          eq(knowledgeMergeProposals.tenantId, auth.tenantId),
          inArray(knowledgeMergeProposals.id, input.ids),
        ));
        for (const proposal of proposals) {
          await this.audit(auth, "knowledge.merge_decision", "knowledge_merge_proposal", proposal.id, {
            before: { status: proposal.status },
            after: { status: "rejected" },
          });
        }
      } else {
        for (const proposal of proposals) {
          await this.mergeConcept(auth, proposal.sourceConceptId, proposal.targetConceptId);
        }
      }
    }
    await this.audit(auth, "knowledge.proposal_batch", "knowledge_proposal", null, {
      kind: input.kind,
      decision: input.decision,
      count: decidedIds.length,
    });
    return { ok: true, count: decidedIds.length };
  }

  async updateEdge(auth: AuthContext, edgeId: string, status: "active" | "rejected") {
    this.requireAdmin(auth);
    const [before] = await this.db.select().from(knowledgeEdges).where(and(
      eq(knowledgeEdges.id, edgeId),
      eq(knowledgeEdges.tenantId, auth.tenantId),
      isNull(knowledgeEdges.deletedAt),
    )).limit(1);
    if (!before) throw new ApiError("EDGE_NOT_FOUND", "知识关系不存在。", 404);
    const [after] = await this.db.update(knowledgeEdges).set({
      status,
      updatedAt: new Date(),
      updatedBy: auth.userId,
    }).where(and(
      eq(knowledgeEdges.id, edgeId),
      eq(knowledgeEdges.tenantId, auth.tenantId),
      isNull(knowledgeEdges.deletedAt),
    )).returning();
    if (!after) throw new ApiError("EDGE_NOT_FOUND", "知识关系不存在。", 404);
    await this.audit(auth, "knowledge.edge_update", "knowledge_edge", after.id, {
      before,
      after,
    });
    return after;
  }

  async graph(
    auth: AuthContext,
    input: { projectId?: string; conceptId?: string; depth: 1 | 2; limit: number },
  ) {
    if (input.projectId) await requireVisibleProject(this.db, auth, input.projectId);
    if (input.conceptId) await this.requireConcept(auth, input.conceptId);
    const seedConditions = [
      eq(knowledgeEdges.tenantId, auth.tenantId),
      inArray(knowledgeEdges.status, ["active", "proposed"]),
      isNull(knowledgeEdges.deletedAt),
      ...(input.projectId ? [or(
        eq(knowledgeEdges.sourceProjectId, input.projectId),
        eq(knowledgeEdges.targetProjectId, input.projectId),
      )] : []),
      ...(input.conceptId ? [or(
        and(eq(knowledgeEdges.sourceType, "concept"), eq(knowledgeEdges.sourceId, input.conceptId)),
        and(eq(knowledgeEdges.targetType, "concept"), eq(knowledgeEdges.targetId, input.conceptId)),
      )] : []),
    ];
    const first = await this.db.select().from(knowledgeEdges)
      .where(and(...seedConditions))
      .orderBy(desc(knowledgeEdges.weight))
      .limit(input.limit + 1);
    let all = first.slice(0, input.limit);
    if (input.depth === 2 && all.length < input.limit) {
      const nodeIds = [...new Set(all.flatMap((edge) => [edge.sourceId, edge.targetId]))];
      if (nodeIds.length > 0) {
        const second = await this.db.select().from(knowledgeEdges).where(and(
          eq(knowledgeEdges.tenantId, auth.tenantId),
          inArray(knowledgeEdges.status, ["active", "proposed"]),
          or(inArray(knowledgeEdges.sourceId, nodeIds), inArray(knowledgeEdges.targetId, nodeIds)),
          isNull(knowledgeEdges.deletedAt),
        )).orderBy(desc(knowledgeEdges.weight)).limit(input.limit + 1);
        const byId = new Map([...all, ...second].map((edge) => [edge.id, edge]));
        all = [...byId.values()].slice(0, input.limit);
      }
    }
    return this.hydrateGraph(auth, all, first.length > input.limit || all.length >= input.limit);
  }

  async sourceScore(auth: AuthContext, sourceType: KnowledgeSourceType, sourceId: string) {
    await this.requireSource(auth, sourceType, sourceId);
    const [score] = await this.db.select().from(knowledgeSourceScores).where(and(
      eq(knowledgeSourceScores.tenantId, auth.tenantId),
      eq(knowledgeSourceScores.sourceType, sourceType),
      eq(knowledgeSourceScores.sourceId, sourceId),
      isNull(knowledgeSourceScores.deletedAt),
    )).limit(1);
    return score ?? {
      sourceType,
      sourceId,
      upCount: 0,
      downCount: 0,
      manualWeight: 1,
      recomputedAt: null,
    };
  }

  async listSources(
    auth: AuthContext,
    sourceType: "document" | "project" | "concept",
    query?: string,
  ): Promise<KnowledgeSourceListItem[]> {
    if (sourceType === "document") {
      const rows = await this.db
        .select({
          sourceId: documents.id,
          title: documents.title,
          subtitle: projects.name,
          upCount: knowledgeSourceScores.upCount,
          downCount: knowledgeSourceScores.downCount,
          manualWeight: knowledgeSourceScores.manualWeight,
          recomputedAt: knowledgeSourceScores.recomputedAt,
        })
        .from(documents)
        .innerJoin(projects, eq(documents.projectId, projects.id))
        .leftJoin(knowledgeSourceScores, and(
          eq(knowledgeSourceScores.tenantId, auth.tenantId),
          eq(knowledgeSourceScores.sourceType, "document"),
          eq(knowledgeSourceScores.sourceId, documents.id),
          isNull(knowledgeSourceScores.deletedAt),
        ))
        .where(and(
          eq(documents.tenantId, auth.tenantId),
          eq(projects.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
          isNull(projects.deletedAt),
          ...(query ? [ilike(documents.title, `%${query}%`)] : []),
        ))
        .orderBy(asc(documents.title))
        .limit(100);
      return rows.map((row) => serializeSourceRow(sourceType, row));
    }
    if (sourceType === "project") {
      const rows = await this.db
        .select({
          sourceId: projects.id,
          title: projects.name,
          subtitle: sql<string | null>`null`,
          upCount: knowledgeSourceScores.upCount,
          downCount: knowledgeSourceScores.downCount,
          manualWeight: knowledgeSourceScores.manualWeight,
          recomputedAt: knowledgeSourceScores.recomputedAt,
        })
        .from(projects)
        .leftJoin(knowledgeSourceScores, and(
          eq(knowledgeSourceScores.tenantId, auth.tenantId),
          eq(knowledgeSourceScores.sourceType, "project"),
          eq(knowledgeSourceScores.sourceId, projects.id),
          isNull(knowledgeSourceScores.deletedAt),
        ))
        .where(and(
          eq(projects.tenantId, auth.tenantId),
          isNull(projects.deletedAt),
          ...(query ? [ilike(projects.name, `%${query}%`)] : []),
        ))
        .orderBy(asc(projects.name))
        .limit(100);
      return rows.map((row) => serializeSourceRow(sourceType, row));
    }
    const rows = await this.db
      .select({
        sourceId: knowledgeConcepts.id,
        title: knowledgeConcepts.name,
        subtitle: knowledgeConcepts.description,
        upCount: knowledgeSourceScores.upCount,
        downCount: knowledgeSourceScores.downCount,
        manualWeight: knowledgeSourceScores.manualWeight,
        recomputedAt: knowledgeSourceScores.recomputedAt,
      })
      .from(knowledgeConcepts)
      .leftJoin(knowledgeSourceScores, and(
        eq(knowledgeSourceScores.tenantId, auth.tenantId),
        eq(knowledgeSourceScores.sourceType, "concept"),
        eq(knowledgeSourceScores.sourceId, knowledgeConcepts.id),
        isNull(knowledgeSourceScores.deletedAt),
      ))
      .where(and(
        eq(knowledgeConcepts.tenantId, auth.tenantId),
        eq(knowledgeConcepts.status, "active"),
        isNull(knowledgeConcepts.deletedAt),
        ...(query ? [ilike(knowledgeConcepts.name, `%${query}%`)] : []),
      ))
      .orderBy(desc(knowledgeConcepts.projectSpread), asc(knowledgeConcepts.name))
      .limit(100);
    return rows.map((row) => serializeSourceRow(sourceType, row));
  }

  async updateSourceScore(
    auth: AuthContext,
    sourceType: KnowledgeSourceType,
    sourceId: string,
    manualWeight: number,
  ) {
    this.requireAdmin(auth);
    await this.requireSource(auth, sourceType, sourceId);
    const before = await this.sourceScore(auth, sourceType, sourceId);
    const now = new Date();
    const [score] = await this.db.insert(knowledgeSourceScores).values({
      tenantId: auth.tenantId,
      sourceType,
      sourceId,
      manualWeight,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    }).onConflictDoUpdate({
      target: [
        knowledgeSourceScores.tenantId,
        knowledgeSourceScores.sourceType,
        knowledgeSourceScores.sourceId,
      ],
      set: { manualWeight, updatedAt: now, updatedBy: auth.userId },
    }).returning();
    await this.audit(auth, "knowledge.source_score_update", "knowledge_source", sourceId, {
      sourceType,
      before,
      after: score,
    });
    return score;
  }

  async analytics(auth: AuthContext) {
    const trendStart = new Date();
    trendStart.setUTCHours(0, 0, 0, 0);
    trendStart.setUTCDate(trendStart.getUTCDate() - 13);
    const [feedback] = await this.db.select({
      up: count(sql`case when ${aiFeedbackEvents.vote} = 'up' then 1 end`),
      down: count(sql`case when ${aiFeedbackEvents.vote} = 'down' then 1 end`),
      wrongProject: count(sql`case when ${aiFeedbackEvents.reason} = 'wrong_project' then 1 end`),
    }).from(aiFeedbackEvents).where(and(
      eq(aiFeedbackEvents.tenantId, auth.tenantId),
      isNull(aiFeedbackEvents.deletedAt),
    ));
    const feedbackByTierRows = await this.db.select({
      tier: aiMessageCitations.tier,
      up: count(sql`case when ${aiFeedbackEvents.vote} = 'up' then 1 end`),
      down: count(sql`case when ${aiFeedbackEvents.vote} = 'down' then 1 end`),
    }).from(aiFeedbackEvents).innerJoin(aiMessageCitations, and(
      eq(aiFeedbackEvents.citationId, aiMessageCitations.id),
      eq(aiMessageCitations.tenantId, auth.tenantId),
      isNull(aiMessageCitations.deletedAt),
    )).where(and(
      eq(aiFeedbackEvents.tenantId, auth.tenantId),
      isNull(aiFeedbackEvents.deletedAt),
    )).groupBy(aiMessageCitations.tier);
    const feedbackByTier = new Map(feedbackByTierRows.map((item) => [item.tier, item]));
    const topSources = await this.db.select({
      sourceType: aiMessageCitations.sourceType,
      sourceId: aiMessageCitations.sourceId,
      title: sql<string>`max(${aiMessageCitations.titleSnapshot})`,
      citations: count(),
    }).from(aiMessageCitations).where(and(
      eq(aiMessageCitations.tenantId, auth.tenantId),
      isNull(aiMessageCitations.deletedAt),
    )).groupBy(aiMessageCitations.sourceType, aiMessageCitations.sourceId)
      .orderBy(desc(count())).limit(20);
    const wrongProjectTrend = await this.db.select({
      date: sql<string>`to_char(date_trunc('day', ${aiFeedbackEvents.createdAt}), 'YYYY-MM-DD')`,
      count: count(),
    }).from(aiFeedbackEvents).where(and(
      eq(aiFeedbackEvents.tenantId, auth.tenantId),
      eq(aiFeedbackEvents.reason, "wrong_project"),
      gte(aiFeedbackEvents.createdAt, trendStart),
      isNull(aiFeedbackEvents.deletedAt),
    )).groupBy(sql`date_trunc('day', ${aiFeedbackEvents.createdAt})`)
      .orderBy(sql`date_trunc('day', ${aiFeedbackEvents.createdAt})`);
    return {
      feedback: {
        up: Number(feedback?.up ?? 0),
        down: Number(feedback?.down ?? 0),
        wrongProject: Number(feedback?.wrongProject ?? 0),
      },
      feedbackByTier: ANALYTICS_TIERS.map((tier) => ({
        tier,
        up: Number(feedbackByTier.get(tier)?.up ?? 0),
        down: Number(feedbackByTier.get(tier)?.down ?? 0),
      })),
      topSources: topSources.map((source) => ({ ...source, citations: Number(source.citations) })),
      wrongProjectTrend: wrongProjectTrend.map((item) => ({
        date: item.date,
        count: Number(item.count),
      })),
    };
  }

  async reindex(
    auth: AuthContext,
    input: { targetType: "document" | "module_record" | "project" | "all"; projectId?: string | null },
  ) {
    this.requireAdmin(auth);
    const projectCondition = input.projectId ? eq(projects.id, input.projectId) : undefined;
    const targets: Array<{ targetType: "document" | "module_record" | "project"; targetId: string }> = [];
    if (input.targetType === "all" || input.targetType === "document") {
      const rows = await this.db.select({ id: documents.id }).from(documents).where(and(
        eq(documents.tenantId, auth.tenantId),
        ...(input.projectId ? [eq(documents.projectId, input.projectId)] : []),
        isNull(documents.deletedAt),
      )).limit(10_000);
      targets.push(...rows.map((row) => ({ targetType: "document" as const, targetId: row.id })));
    }
    if (input.targetType === "all" || input.targetType === "module_record") {
      const rows = await this.db.select({ id: moduleRecords.id }).from(moduleRecords).where(and(
        eq(moduleRecords.tenantId, auth.tenantId),
        ...(input.projectId ? [eq(moduleRecords.projectId, input.projectId)] : []),
        isNull(moduleRecords.deletedAt),
      )).limit(10_000);
      targets.push(...rows.map((row) => ({ targetType: "module_record" as const, targetId: row.id })));
    }
    if (input.targetType === "all" || input.targetType === "project") {
      const rows = await this.db.select({ id: projects.id }).from(projects).where(and(
        eq(projects.tenantId, auth.tenantId),
        projectCondition,
        isNull(projects.deletedAt),
      )).limit(10_000);
      targets.push(...rows.map((row) => ({ targetType: "project" as const, targetId: row.id })));
    }
    for (const target of targets) {
      await enqueueKnowledgeIndexJob(this.db, {
        tenantId: auth.tenantId,
        targetType: target.targetType,
        targetId: target.targetId,
        reason: "manual",
        actorId: auth.userId,
      });
    }
    await this.audit(auth, "knowledge.reindex", "knowledge_index_job", null, {
      targetType: input.targetType,
      projectId: input.projectId ?? null,
      count: targets.length,
    });
    return { enqueued: targets.length };
  }

  private async requireConcept(auth: AuthContext, conceptId: string) {
    const [concept] = await this.db.select().from(knowledgeConcepts).where(and(
      eq(knowledgeConcepts.id, conceptId),
      eq(knowledgeConcepts.tenantId, auth.tenantId),
      isNull(knowledgeConcepts.deletedAt),
    )).limit(1);
    if (!concept) throw new ApiError("CONCEPT_NOT_FOUND", "知识概念不存在。", 404);
    return concept;
  }

  private async requireSource(
    auth: AuthContext,
    sourceType: KnowledgeSourceType,
    sourceId: string,
  ) {
    const row = sourceType === "document"
      ? await this.db.select({ id: documents.id }).from(documents).where(and(
          eq(documents.id, sourceId),
          eq(documents.tenantId, auth.tenantId),
          isNull(documents.deletedAt),
        )).limit(1)
      : sourceType === "project"
        ? await this.db.select({ id: projects.id }).from(projects).where(and(
            eq(projects.id, sourceId),
            eq(projects.tenantId, auth.tenantId),
            isNull(projects.deletedAt),
          )).limit(1)
        : await this.db.select({ id: knowledgeConcepts.id }).from(knowledgeConcepts).where(and(
            eq(knowledgeConcepts.id, sourceId),
            eq(knowledgeConcepts.tenantId, auth.tenantId),
            isNull(knowledgeConcepts.deletedAt),
          )).limit(1);
    if (!row[0]) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "知识来源不存在。", 404);
  }

  private async hydrateGraph(
    auth: AuthContext,
    edges: Array<typeof knowledgeEdges.$inferSelect>,
    truncated: boolean,
  ) {
    const nodeRefs = new Map<string, GraphNodeType>();
    for (const edge of edges) {
      const sourceType = graphNodeType(edge.sourceType);
      const targetType = graphNodeType(edge.targetType);
      if (sourceType) nodeRefs.set(edge.sourceId, sourceType);
      if (targetType) nodeRefs.set(edge.targetId, targetType);
    }
    const conceptIds = [...nodeRefs].filter(([, type]) => type === "concept").map(([id]) => id);
    const documentIds = [...nodeRefs].filter(([, type]) => type === "document").map(([id]) => id);
    const projectIds = [...nodeRefs].filter(([, type]) => type === "project").map(([id]) => id);
    const [conceptRows, documentRows, projectRows] = await Promise.all([
      conceptIds.length === 0 ? [] : this.db.select({ id: knowledgeConcepts.id, label: knowledgeConcepts.name })
        .from(knowledgeConcepts).where(and(
          eq(knowledgeConcepts.tenantId, auth.tenantId),
          inArray(knowledgeConcepts.id, conceptIds),
          isNull(knowledgeConcepts.deletedAt),
        )),
      documentIds.length === 0 ? [] : this.db.select({ id: documents.id, label: documents.title, projectId: documents.projectId })
        .from(documents).where(and(
          eq(documents.tenantId, auth.tenantId),
          inArray(documents.id, documentIds),
          isNull(documents.deletedAt),
        )),
      projectIds.length === 0 ? [] : this.db.select({ id: projects.id, label: projects.name })
        .from(projects).where(and(
          eq(projects.tenantId, auth.tenantId),
          inArray(projects.id, projectIds),
          isNull(projects.deletedAt),
        )),
    ]);
    const labels = new Map<string, { label: string; projectId: string | null }>([
      ...conceptRows.map((row) => [row.id, { label: row.label, projectId: null }] as const),
      ...documentRows.map((row) => [row.id, { label: row.label, projectId: row.projectId }] as const),
      ...projectRows.map((row) => [row.id, { label: row.label, projectId: row.id }] as const),
    ]);
    const nodes = [...nodeRefs].flatMap(([id, type]) => {
      const item = labels.get(id);
      return item ? [{ id, type, label: item.label, projectId: item.projectId, weight: 1 }] : [];
    });
    const availableIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: edges.flatMap((edge) => availableIds.has(edge.sourceId) && availableIds.has(edge.targetId)
        ? [{
            id: edge.id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            relation: edge.relation,
            weight: edge.weight,
            status: edge.status as "active" | "proposed" | "rejected",
          }]
        : []),
      truncated,
    };
  }

  private requireAdmin(auth: AuthContext) {
    if (auth.role !== "admin") {
      throw new ApiError("FORBIDDEN", "仅管理员可以执行知识治理操作。", 403);
    }
  }

  private async audit(
    auth: AuthContext,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ) {
    await this.db.insert(auditLogs).values({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType,
      resourceId,
      metadata: { requestId: auth.requestId, ...metadata },
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
  }
}

function graphNodeType(value: string): GraphNodeType | null {
  if (value === "document" || value === "concept" || value === "project") return value;
  return null;
}

function parseSalience(value: unknown): "primary" | "secondary" | "passing" {
  return value === "primary" || value === "passing" ? value : "secondary";
}

function parseEdgeStatus(value: string): "active" | "proposed" | "rejected" {
  return value === "active" || value === "rejected" ? value : "proposed";
}

function serializeSourceRow(
  sourceType: KnowledgeSourceType,
  row: {
    sourceId: string;
    title: string;
    subtitle: string | null;
    upCount: number | null;
    downCount: number | null;
    manualWeight: number | null;
    recomputedAt: Date | null;
  },
): KnowledgeSourceListItem {
  return {
    sourceType,
    sourceId: row.sourceId,
    title: row.title,
    subtitle: row.subtitle,
    upCount: row.upCount ?? 0,
    downCount: row.downCount ?? 0,
    manualWeight: row.manualWeight ?? 1,
    recomputedAt: row.recomputedAt ? toIso(row.recomputedAt) : null,
  };
}
