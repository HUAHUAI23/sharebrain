import { z } from "zod";

export const CONCEPT_TYPES = [
  "technology",
  "component",
  "problem",
  "solution",
  "domain_term",
  "practice",
] as const;
export const conceptTypeSchema = z.enum(CONCEPT_TYPES);

export const CONCEPT_RELATIONS = [
  "solves",
  "depends_on",
  "part_of",
  "alternative_to",
] as const;
export const conceptRelationSchema = z.enum(CONCEPT_RELATIONS);

export const conceptExtractionSchema = z.object({
  concepts: z.array(z.object({
    existingId: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(64),
    type: conceptTypeSchema,
    description: z.string().max(200),
    aliases: z.array(z.string().trim().min(1).max(64)).max(5),
    salience: z.enum(["primary", "secondary", "passing"]),
    evidenceQuotes: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
  })).max(8),
  conceptRelations: z.array(z.object({
    sourceName: z.string().trim().min(1).max(64),
    targetName: z.string().trim().min(1).max(64),
    relation: conceptRelationSchema,
    confidence: z.number().min(0).max(1),
  })).max(6),
});

export const graphPathSchema = z.object({
  seedDocumentId: z.string().uuid(),
  seedTitle: z.string(),
  relation: z.enum(["similar_to", "links", "mentions", "relates_to"]),
  weight: z.number().min(0).max(1),
  viaConceptIds: z.array(z.string().uuid()).optional(),
});

export const citationRetrievalTraceSchema = z.object({
  ftsRank: z.number().optional(),
  vectorScore: z.number().optional(),
  conceptScore: z.number().optional(),
  rrfScore: z.number(),
  feedbackMultiplier: z.number(),
  manualMultiplier: z.number(),
  finalScore: z.number(),
  graphPath: graphPathSchema.optional(),
});

export const aiCitationSchema = z.object({
  id: z.string().uuid(),
  rank: z.number().int().min(1),
  sourceType: z.enum(["document_chunk", "module_record", "project"]),
  sourceId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string().nullable(),
  documentId: z.string().uuid().nullable(),
  chunkIndex: z.number().int().min(0).nullable(),
  blockIds: z.array(z.string()),
  headingPath: z.array(z.string()),
  title: z.string(),
  snippet: z.string().nullable(),
  tier: z.enum(["active_project", "tenant_global", "graph_expanded"]),
  retrieval: citationRetrievalTraceSchema,
  available: z.boolean(),
});

export const knowledgeScopeSchema = z.object({
  activeProjectId: z.string().uuid().nullable(),
  resolution: z.enum(["route", "explicit", "recent", "inferred", "none"]),
  projectName: z.string().nullable(),
  ambiguousProjects: z.array(z.object({ id: z.string().uuid(), name: z.string() })).default([]),
});

export const knowledgeConceptSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  normalizedName: z.string(),
  type: conceptTypeSchema,
  description: z.string().nullable(),
  status: z.enum(["proposed", "active", "rejected", "merged"]),
  canonicalId: z.string().uuid().nullable(),
  origin: z.enum(["ai", "user"]),
  mentionCount: z.number().int().min(0),
  projectSpread: z.number().int().min(0),
  aliases: z.array(z.string()).default([]),
});

export const knowledgeConceptMentionSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  salience: z.enum(["primary", "secondary", "passing"]),
  weight: z.number().min(0).max(1),
  status: z.enum(["active", "proposed", "rejected"]),
});

export const knowledgeConceptDetailSchema = knowledgeConceptSchema.extend({
  mentions: z.array(knowledgeConceptMentionSchema),
  projectDistribution: z.array(z.object({
    projectId: z.string().uuid(),
    projectName: z.string(),
    mentionCount: z.number().int().min(0),
  })),
});

export const knowledgeSourceTypeSchema = z.enum([
  "document_chunk",
  "document",
  "module_record",
  "project",
  "concept",
]);

export const knowledgeSourceListItemSchema = z.object({
  sourceType: knowledgeSourceTypeSchema,
  sourceId: z.string().uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  upCount: z.number().int().min(0),
  downCount: z.number().int().min(0),
  manualWeight: z.number().min(0).max(2),
  recomputedAt: z.string().datetime().nullable(),
});

export const knowledgeProposalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["concept", "relation", "merge"]),
  title: z.string(),
  description: z.string().nullable(),
  evidence: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const knowledgeGraphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(["document", "concept", "project"]),
    label: z.string(),
    projectId: z.string().uuid().nullable(),
    weight: z.number(),
  })),
  edges: z.array(z.object({
    id: z.string().uuid(),
    sourceId: z.string().uuid(),
    targetId: z.string().uuid(),
    relation: z.string(),
    weight: z.number(),
    status: z.enum(["active", "proposed", "rejected"]),
  })),
  truncated: z.boolean(),
});

export const knowledgeConceptUpdateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  type: conceptTypeSchema.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  status: z.enum(["active", "rejected"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "至少提供一个变更字段");

export const knowledgeConceptMergeSchema = z.object({
  targetConceptId: z.string().uuid(),
});

export const knowledgeEdgeUpdateSchema = z.object({
  status: z.enum(["active", "rejected"]),
});

export const knowledgeProposalBatchSchema = z.object({
  kind: z.enum(["concept", "relation", "merge"]),
  ids: z.array(z.string().uuid()).min(1).max(100),
  decision: z.enum(["accept", "reject"]),
});

export const knowledgeSourceScoreUpdateSchema = z.object({
  manualWeight: z.number().min(0).max(2),
});

export const knowledgeReindexSchema = z.object({
  targetType: z.enum(["document", "module_record", "project", "all"]).default("all"),
  projectId: z.string().uuid().nullable().optional(),
});

export type ConceptExtraction = z.infer<typeof conceptExtractionSchema>;
export type AiCitation = z.infer<typeof aiCitationSchema>;
export type CitationRetrievalTrace = z.infer<typeof citationRetrievalTraceSchema>;
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>;
export type KnowledgeConcept = z.infer<typeof knowledgeConceptSchema>;
export type KnowledgeConceptMention = z.infer<typeof knowledgeConceptMentionSchema>;
export type KnowledgeConceptDetail = z.infer<typeof knowledgeConceptDetailSchema>;
export type KnowledgeProposal = z.infer<typeof knowledgeProposalSchema>;
export type KnowledgeGraph = z.infer<typeof knowledgeGraphSchema>;
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;
export type KnowledgeSourceListItem = z.infer<typeof knowledgeSourceListItemSchema>;
export type KnowledgeConceptUpdate = z.infer<typeof knowledgeConceptUpdateSchema>;
export type KnowledgeProposalBatch = z.infer<typeof knowledgeProposalBatchSchema>;
