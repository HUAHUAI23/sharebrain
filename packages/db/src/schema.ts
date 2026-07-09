import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

const jsonbObjectDefault = sql`'{}'::jsonb`;
const textArrayDefault = sql`'{}'::text[]`;

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("personal"),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_tenants_tenant_id_unique").on(table.tenantId),
    index("idx_tenants_kind").on(table.kind),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    avatarMediaId: uuid("avatar_media_id"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_users_email_unique").on(table.email),
    index("idx_users_tenant").on(table.tenantId),
    index("idx_users_status").on(table.status),
  ],
);

const ownedColumns = {
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
};

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("admin"),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_tenant_memberships_unique").on(table.tenantId, table.userId),
    index("idx_tenant_memberships_user").on(table.userId),
    index("idx_tenant_memberships_role").on(table.role),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_auth_accounts_provider_unique").on(table.provider, table.providerAccountId),
    index("idx_auth_accounts_tenant").on(table.tenantId),
    index("idx_auth_accounts_user").on(table.userId),
    index("idx_auth_accounts_provider").on(table.provider),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id").references(() => authAccounts.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_auth_sessions_token_hash_unique").on(table.tokenHash),
    index("idx_auth_sessions_tenant").on(table.tenantId),
    index("idx_auth_sessions_user").on(table.userId),
    index("idx_auth_sessions_expires").on(table.expiresAt),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    description: text("description"),
    tags: text("tags").array().notNull().default(textArrayDefault),
    ...ownedColumns,
  },
  (table) => [
    index("idx_projects_tenant").on(table.tenantId),
    index("idx_projects_owner").on(table.ownerId),
    index("idx_projects_status").on(table.status),
  ],
);

export const projectRecents = pgTable(
  "project_recents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }).notNull().defaultNow(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_project_recents_unique").on(table.userId, table.projectId),
    index("idx_project_recents_tenant_user").on(table.tenantId, table.userId),
    index("idx_project_recents_project").on(table.projectId),
  ],
);

export const systemModuleTemplates = pgTable(
  "system_module_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortKey: text("sort_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_system_module_templates_key_unique").on(table.key),
    index("idx_system_module_templates_kind").on(table.kind),
  ],
);

export const systemModuleTemplateFields = pgTable(
  "system_module_template_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => systemModuleTemplates.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    required: boolean("required").notNull().default(false),
    defaultPolicy: text("default_policy").notNull().default("empty"),
    defaultValue: jsonb("default_value").$type<unknown>(),
    options: jsonb("options").$type<Array<{ id: string; label: string; color?: string | undefined }>>().notNull().default(sql`'[]'::jsonb`),
    sortKey: text("sort_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_system_module_template_fields_key_unique").on(table.templateId, table.key),
    index("idx_system_module_template_fields_template").on(table.templateId),
  ],
);

export const moduleTemplates = pgTable(
  "module_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    sourceSystemTemplateId: uuid("source_system_template_id").references(() => systemModuleTemplates.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_module_templates_key_unique").on(table.tenantId, table.key),
    index("idx_module_templates_kind").on(table.kind),
  ],
);

export const moduleTemplateFields = pgTable(
  "module_template_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => moduleTemplates.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    required: boolean("required").notNull().default(false),
    defaultPolicy: text("default_policy").notNull().default("empty"),
    defaultValue: jsonb("default_value").$type<unknown>(),
    options: jsonb("options").$type<Array<{ id: string; label: string; color?: string | undefined }>>().notNull().default(sql`'[]'::jsonb`),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_module_template_fields_key_unique").on(table.templateId, table.key),
    index("idx_module_template_fields_template").on(table.templateId),
  ],
);

export const projectModules = pgTable(
  "project_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceTemplateId: uuid("source_template_id").references(() => moduleTemplates.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_project_modules_key_unique").on(table.projectId, table.key),
    index("idx_project_modules_tenant").on(table.tenantId),
    index("idx_project_modules_project").on(table.projectId),
    index("idx_project_modules_kind").on(table.kind),
  ],
);

export const projectModuleFields = pgTable(
  "project_module_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => projectModules.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    required: boolean("required").notNull().default(false),
    defaultPolicy: text("default_policy").notNull().default("empty"),
    defaultValue: jsonb("default_value").$type<unknown>(),
    options: jsonb("options").$type<Array<{ id: string; label: string; color?: string | undefined }>>().notNull().default(sql`'[]'::jsonb`),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_project_module_fields_key_unique").on(table.moduleId, table.key),
    index("idx_project_module_fields_tenant").on(table.tenantId),
    index("idx_project_module_fields_module").on(table.moduleId),
  ],
);

export const moduleRecords = pgTable(
  "module_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => projectModules.id),
    title: text("title").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    index("idx_module_records_tenant").on(table.tenantId),
    index("idx_module_records_project").on(table.projectId),
    index("idx_module_records_module").on(table.moduleId),
    index("idx_module_records_occurred_at").on(table.occurredAt),
    index("idx_module_records_values").using("gin", table.values),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => projectModules.id),
    moduleRecordId: uuid("module_record_id").references(() => moduleRecords.id),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("tenant"),
    currentVersion: integer("current_version").notNull().default(1),
    sortKey: text("sort_key").notNull(),
    ...ownedColumns,
  },
  (table) => [
    index("idx_documents_tenant").on(table.tenantId),
    index("idx_documents_project").on(table.projectId),
    index("idx_documents_module").on(table.moduleId),
    index("idx_documents_record").on(table.moduleRecordId),
    index("idx_documents_parent").on(table.parentId),
  ],
);

export const documentCrdtSnapshots = pgTable("document_crdt_snapshots", {
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id),
  ydocSnapshot: bytea("ydoc_snapshot").notNull(),
  stateVector: bytea("state_vector"),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    plateJson: jsonb("plate_json").notNull(),
    markdown: text("markdown").notNull().default(""),
    plainText: text("plain_text").notNull().default(""),
    changeSummary: text("change_summary"),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_versions_unique").on(table.documentId, table.versionNo),
    index("idx_document_versions_tenant").on(table.tenantId),
  ],
);

export const documentReviewStates = pgTable(
  "document_review_states",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id),
    discussions: jsonb("discussions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_document_review_states_tenant").on(table.tenantId)],
);

export const documentDiscussionReadStates = pgTable(
  "document_discussion_read_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    discussionId: text("discussion_id").notNull(),
    activityKey: text("activity_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_discussion_read_states_unique").on(
      table.documentId,
      table.userId,
      table.discussionId,
    ),
    index("idx_document_discussion_read_states_tenant").on(table.tenantId),
    index("idx_document_discussion_read_states_user").on(table.userId),
  ],
);

export const documentBlocks = pgTable(
  "document_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    blockId: text("block_id").notNull(),
    blockType: text("block_type").notNull(),
    path: integer("path").array().notNull(),
    headingPath: text("heading_path").array().notNull().default(textArrayDefault),
    textContent: text("text_content").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_blocks_unique").on(table.documentId, table.blockId),
    index("idx_document_blocks_tenant").on(table.tenantId),
    index("idx_document_blocks_project").on(table.projectId),
  ],
);

export const searchItems = pgTable(
  "search_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id").references(() => projects.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    documentId: uuid("document_id"),
    moduleRecordId: uuid("module_record_id"),
    blockId: text("block_id"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    content: text("content").notNull(),
    pathText: text("path_text"),
    tags: text("tags").array().notNull().default(textArrayDefault),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_search_items_entity_unique").on(table.tenantId, table.entityType, table.entityId, table.blockId),
    index("idx_search_items_tenant").on(table.tenantId),
    index("idx_search_items_project").on(table.projectId),
    index("idx_search_items_entity_type").on(table.entityType),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").array().notNull().default(textArrayDefault),
    content: text("content").notNull(),
    summary: text("summary"),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_chunks_unique").on(table.documentId, table.versionNo, table.chunkIndex),
    index("idx_document_chunks_tenant").on(table.tenantId),
    index("idx_document_chunks_project").on(table.projectId),
    index("idx_document_chunks_document").on(table.documentId),
  ],
);

export const mediaObjects = pgTable(
  "media_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    parentMediaId: uuid("parent_media_id"),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum"),
    status: text("status").notNull().default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_media_objects_key_unique").on(table.bucket, table.objectKey),
    index("idx_media_objects_tenant").on(table.tenantId),
    index("idx_media_objects_status").on(table.status),
    index("idx_media_objects_parent").on(table.parentMediaId),
  ],
);

export const mediaUploads = pgTable(
  "media_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    status: text("status").notNull().default("pending"),
    uploadUrl: text("upload_url").notNull(),
    policyFields: jsonb("policy_fields").$type<Record<string, string>>().notNull().default(jsonbObjectDefault),
    minBytes: integer("min_bytes").notNull().default(1),
    maxBytes: integer("max_bytes").notNull(),
    expectedMimeType: text("expected_mime_type").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...ownedColumns,
  },
  (table) => [
    index("idx_media_uploads_tenant").on(table.tenantId),
    index("idx_media_uploads_media").on(table.mediaId),
    index("idx_media_uploads_status").on(table.status),
    index("idx_media_uploads_expires").on(table.expiresAt),
  ],
);

export const mediaUsages = pgTable(
  "media_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    usageKind: text("usage_kind").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_media_usages_unique").on(table.mediaId, table.resourceType, table.resourceId, table.usageKind),
    index("idx_media_usages_tenant").on(table.tenantId),
    index("idx_media_usages_media").on(table.mediaId),
    index("idx_media_usages_resource").on(table.resourceType, table.resourceId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    projectId: uuid("project_id"),
    documentId: uuid("document_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_audit_logs_tenant").on(table.tenantId),
    index("idx_audit_logs_project").on(table.projectId),
    index("idx_audit_logs_action").on(table.action),
  ],
);
