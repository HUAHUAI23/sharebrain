import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    customerName: text("customer_name"),
    status: text("status").notNull().default("active"),
    ownerId: uuid("owner_id"),
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_projects_tenant").on(table.tenantId),
    index("idx_projects_status").on(table.status),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    docType: text("doc_type").notNull(),
    status: text("status").notNull().default("active"),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_documents_tenant").on(table.tenantId),
    index("idx_documents_project").on(table.projectId),
  ],
);

export const documentCrdtSnapshots = pgTable("document_crdt_snapshots", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id),
  ydocSnapshot: text("ydoc_snapshot").notNull(),
  stateVector: text("state_vector"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    plateJson: jsonb("plate_json").notNull(),
    plainText: text("plain_text").notNull(),
    html: text("html"),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_document_versions_unique").on(table.documentId, table.versionNo),
  ],
);

export const documentBlocks = pgTable(
  "document_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    blockId: text("block_id").notNull(),
    blockType: text("block_type").notNull(),
    path: integer("path").array().notNull(),
    headingPath: text("heading_path").array().notNull().default(sql`'{}'::text[]`),
    textContent: text("text_content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_document_blocks_unique").on(table.documentId, table.blockId),
    index("idx_document_blocks_project").on(table.projectId),
  ],
);

export const searchItems = pgTable(
  "search_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    documentId: uuid("document_id"),
    blockId: text("block_id"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    content: text("content").notNull(),
    pathText: text("path_text"),
    docType: text("doc_type"),
    eventType: text("event_type"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_search_items_tenant").on(table.tenantId),
    index("idx_search_items_project").on(table.projectId),
    index("idx_search_items_entity_type").on(table.entityType),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    relatedDocumentId: uuid("related_document_id"),
    relatedBlockId: text("related_block_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_timeline_events_project").on(table.projectId),
    index("idx_timeline_events_type").on(table.eventType),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").array().notNull().default(sql`'{}'::text[]`),
    content: text("content").notNull(),
    summary: text("summary"),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_document_chunks_project").on(table.projectId),
    index("idx_document_chunks_document").on(table.documentId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    projectId: uuid("project_id"),
    documentId: uuid("document_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_logs_tenant").on(table.tenantId),
    index("idx_audit_logs_project").on(table.projectId),
    index("idx_audit_logs_action").on(table.action),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  documents: many(documents),
  timelineEvents: many(timelineEvents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  versions: many(documentVersions),
  blocks: many(documentBlocks),
  chunks: many(documentChunks),
}));
