import type {
  AiMessagePart,
  CitationRetrievalTrace,
  DocumentActivityDetails,
  DocumentVersionValue,
} from "@sharebrain/contracts";
import { type SQL, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const KNOWLEDGE_EMBEDDING_DIM = 1024;

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
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
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull().default(1024 * 1024 * 1024),
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
    defaultKind: text("default_kind").notNull().default("none"),
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
    includedInNewProjects: boolean("included_in_new_projects").notNull().default(true),
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
    defaultKind: text("default_kind").notNull().default("none"),
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
    defaultKind: text("default_kind").notNull().default("none"),
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

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    formatVersion: integer("format_version").notNull(),
    contentHash: text("content_hash").notNull(),
    plateJson: jsonb("plate_json").$type<DocumentVersionValue>().notNull(),
    plainText: text("plain_text").notNull().default(""),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_revisions_content_unique").on(
      table.documentId,
      table.formatVersion,
      table.contentHash,
    ),
    index("idx_document_revisions_tenant").on(table.tenantId),
    index("idx_document_revisions_document").on(table.documentId, table.createdAt),
  ],
);

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
    kind: text("kind").notNull().default("auto"),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    sourceVersionId: uuid("source_version_id"),
    sourceVersionNo: integer("source_version_no"),
    operationId: uuid("operation_id"),
    revisionId: uuid("revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    formatVersion: integer("format_version").notNull(),
    contentHash: text("content_hash").notNull(),
    plateJson: jsonb("plate_json").notNull(),
    markdown: text("markdown").notNull().default(""),
    plainText: text("plain_text").notNull().default(""),
    changeSummary: text("change_summary"),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_versions_unique").on(table.documentId, table.versionNo),
    index("idx_document_versions_tenant").on(table.tenantId),
    index("idx_document_versions_document_sealed").on(table.documentId, table.sealedAt, table.versionNo),
    index("idx_document_versions_open_idle")
      .on(table.updatedAt, table.id)
      .where(
        sql`${table.kind} = 'auto' and ${table.sealedAt} is null and ${table.deletedAt} is null`,
      ),
    index("idx_document_versions_source").on(table.sourceVersionId),
    index("idx_document_versions_revision").on(table.revisionId),
    uniqueIndex("idx_document_versions_operation_unique")
      .on(table.operationId)
      .where(sql`${table.operationId} is not null`),
    check("chk_document_versions_kind", sql`${table.kind} in ('auto', 'restore')`),
  ],
);

export const documentVersionOperations = pgTable(
  "document_version_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    requestId: uuid("request_id").notNull(),
    sourceKind: text("source_kind").notNull().default("version"),
    sourceRevisionId: uuid("source_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    sourceActivityEventId: uuid("source_activity_event_id"),
    sourceVersionId: uuid("source_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    sourceVersionNo: integer("source_version_no"),
    beforeVersionId: uuid("before_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    beforeVersionNo: integer("before_version_no"),
    resultVersionId: uuid("result_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    resultVersionNo: integer("result_version_no"),
    status: text("status").notNull().default("pending"),
    baseStateVectorHash: text("base_state_vector_hash").notNull(),
    force: boolean("force").notNull().default(false),
    errorCode: text("error_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    applyingAt: timestamp("applying_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_version_operations_request_unique").on(
      table.tenantId,
      table.documentId,
      table.createdBy,
      table.requestId,
    ),
    uniqueIndex("idx_document_version_operations_active_unique")
      .on(table.documentId)
      .where(sql`${table.status} in ('pending', 'applying') and ${table.deletedAt} is null`),
    index("idx_document_version_operations_tenant").on(table.tenantId),
    index("idx_document_version_operations_document").on(table.documentId, table.updatedAt),
    index("idx_document_version_operations_expires").on(table.status, table.expiresAt),
    index("idx_document_version_operations_source_revision").on(table.sourceRevisionId),
    check(
      "chk_document_version_operations_source_kind",
      sql`${table.sourceKind} in ('version', 'activity')`,
    ),
    check(
      "chk_document_version_operations_status",
      sql`${table.status} in ('pending', 'applying', 'applied', 'conflict', 'failed', 'expired')`,
    ),
  ],
);

export const documentActivityEvents = pgTable(
  "document_activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    sessionId: uuid("session_id"),
    beforeRevisionId: uuid("before_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    afterRevisionId: uuid("after_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    status: text("status").notNull().default("sealed"),
    sourceKey: text("source_key").notNull(),
    details: jsonb("details").$type<DocumentActivityDetails>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_activity_events_sequence_unique").on(table.sequence),
    uniqueIndex("idx_document_activity_events_source_unique").on(
      table.documentId,
      table.sourceKey,
    ),
    index("idx_document_activity_events_document_sequence").on(
      table.documentId,
      table.sequence,
    ),
    index("idx_document_activity_events_tenant").on(table.tenantId),
    index("idx_document_activity_events_actor").on(table.actorId, table.occurredAt),
    index("idx_document_activity_events_session").on(table.sessionId),
    index("idx_document_activity_events_before_revision").on(table.beforeRevisionId),
    index("idx_document_activity_events_after_revision").on(table.afterRevisionId),
    check(
      "chk_document_activity_events_type",
      sql`${table.type} in ('document_created', 'content_edited', 'title_edited', 'comment_added', 'comment_replied', 'comment_edited', 'comment_deleted', 'comment_resolved', 'version_restored')`,
    ),
    check("chk_document_activity_events_status", sql`${table.status} in ('open', 'sealed')`),
  ],
);

export const documentEditSessions = pgTable(
  "document_edit_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    activityEventId: uuid("activity_event_id")
      .notNull()
      .references(() => documentActivityEvents.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    changeCount: integer("change_count").notNull().default(1),
    processedSourceKeys: jsonb("processed_source_keys")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    beforeValue: jsonb("before_value").$type<DocumentVersionValue>(),
    afterValue: jsonb("after_value").$type<DocumentVersionValue>(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_edit_sessions_event_unique").on(table.activityEventId),
    uniqueIndex("idx_document_edit_sessions_open_unique")
      .on(table.documentId, table.actorId)
      .where(sql`${table.sealedAt} is null and ${table.deletedAt} is null`),
    index("idx_document_edit_sessions_open_idle")
      .on(table.lastChangedAt, table.id)
      .where(sql`${table.sealedAt} is null and ${table.deletedAt} is null`),
    index("idx_document_edit_sessions_tenant").on(table.tenantId),
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
    searchText: text("search_text").notNull().default(""),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs((): SQL => sql`to_tsvector('simple', ${searchItems.searchText})`),
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
    index("idx_search_items_search_vector").using("gin", table.searchVector),
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
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    blockIds: text("block_ids").array().notNull().default(textArrayDefault),
    headingPath: text("heading_path").array().notNull().default(textArrayDefault),
    content: text("content").notNull(),
    embedText: text("embed_text").notNull(),
    contentHash: text("content_hash").notNull(),
    searchText: text("search_text").notNull(),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs((): SQL => sql`to_tsvector('simple', ${documentChunks.searchText})`),
    summary: text("summary"),
    tokenCount: integer("token_count").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_document_chunks_unique").on(table.revisionId, table.chunkIndex),
    index("idx_document_chunks_tenant").on(table.tenantId),
    index("idx_document_chunks_project").on(table.projectId),
    index("idx_document_chunks_document").on(table.documentId),
    index("idx_document_chunks_current").on(table.tenantId, table.isCurrent, table.projectId),
    index("idx_document_chunks_search_vector").using("gin", table.searchVector),
  ],
);

export const knowledgeEmbeddings = pgTable(
  "knowledge_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: KNOWLEDGE_EMBEDDING_DIM }).notNull(),
    contentHash: text("content_hash").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_embeddings_owner_model_unique").on(
      table.tenantId,
      table.ownerType,
      table.ownerId,
      table.model,
    ),
    index("idx_knowledge_embeddings_tenant_owner").on(table.tenantId, table.ownerType),
    index("idx_knowledge_embeddings_project").on(table.projectId),
    index("idx_knowledge_embeddings_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    check(
      "chk_knowledge_embeddings_owner_type",
      sql`${table.ownerType} in ('document_chunk', 'document', 'module_record', 'concept', 'project')`,
    ),
  ],
);

export const knowledgeEdges = pgTable(
  "knowledge_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceProjectId: uuid("source_project_id").references(() => projects.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetProjectId: uuid("target_project_id").references(() => projects.id),
    relation: text("relation").notNull(),
    weight: real("weight").notNull().default(1),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("proposed"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_edges_identity_unique").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
      table.relation,
    ),
    index("idx_knowledge_edges_source").on(table.tenantId, table.sourceType, table.sourceId),
    index("idx_knowledge_edges_target").on(table.tenantId, table.targetType, table.targetId),
    index("idx_knowledge_edges_status").on(table.tenantId, table.status, table.relation),
    check("chk_knowledge_edges_weight", sql`${table.weight} >= 0 and ${table.weight} <= 1`),
    check("chk_knowledge_edges_origin", sql`${table.origin} in ('embedding', 'parser', 'ai', 'user')`),
    check("chk_knowledge_edges_status", sql`${table.status} in ('active', 'proposed', 'rejected')`),
  ],
);

export const knowledgeConcepts = pgTable(
  "knowledge_concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    status: text("status").notNull().default("proposed"),
    canonicalId: uuid("canonical_id"),
    origin: text("origin").notNull().default("ai"),
    mentionCount: integer("mention_count").notNull().default(0),
    projectSpread: integer("project_spread").notNull().default(0),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_concepts_normalized_active_unique")
      .on(table.tenantId, table.normalizedName)
      .where(sql`${table.status} in ('proposed', 'active') and ${table.deletedAt} is null`),
    index("idx_knowledge_concepts_status_spread").on(table.tenantId, table.status, table.projectSpread),
    index("idx_knowledge_concepts_canonical").on(table.canonicalId),
    check(
      "chk_knowledge_concepts_type",
      sql`${table.type} in ('technology', 'component', 'problem', 'solution', 'domain_term', 'practice')`,
    ),
    check("chk_knowledge_concepts_status", sql`${table.status} in ('proposed', 'active', 'rejected', 'merged')`),
    check("chk_knowledge_concepts_origin", sql`${table.origin} in ('ai', 'user')`),
  ],
);

export const knowledgeConceptAliases = pgTable(
  "knowledge_concept_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    conceptId: uuid("concept_id").notNull().references(() => knowledgeConcepts.id),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    origin: text("origin").notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_concept_aliases_normalized_unique").on(
      table.tenantId,
      table.normalizedAlias,
    ),
    index("idx_knowledge_concept_aliases_concept").on(table.conceptId),
    check("chk_knowledge_concept_aliases_origin", sql`${table.origin} in ('ai', 'user', 'merge')`),
  ],
);

export const knowledgeSourceScores = pgTable(
  "knowledge_source_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    upCount: integer("up_count").notNull().default(0),
    downCount: integer("down_count").notNull().default(0),
    manualWeight: real("manual_weight").notNull().default(1),
    recomputedAt: timestamp("recomputed_at", { withTimezone: true }).notNull().defaultNow(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_source_scores_source_unique").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
    ),
    check("chk_knowledge_source_scores_manual_weight", sql`${table.manualWeight} >= 0 and ${table.manualWeight} <= 2`),
  ],
);

export const knowledgeIndexJobs = pgTable(
  "knowledge_index_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    revisionId: uuid("revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    leaseId: uuid("lease_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_index_jobs_inflight_unique")
      .on(table.tenantId, table.targetType, table.targetId)
      .where(sql`${table.status} in ('pending', 'processing') and ${table.deletedAt} is null`),
    index("idx_knowledge_index_jobs_status_next").on(table.status, table.nextAttemptAt),
    index("idx_knowledge_index_jobs_tenant").on(table.tenantId),
    check("chk_knowledge_index_jobs_target_type", sql`${table.targetType} in ('document', 'module_record', 'project')`),
    check(
      "chk_knowledge_index_jobs_reason",
      sql`${table.reason} in ('revision_sealed', 'record_changed', 'project_changed', 'deleted', 'model_migration', 'manual')`,
    ),
    check("chk_knowledge_index_jobs_status", sql`${table.status} in ('pending', 'processing', 'failed', 'completed')`),
  ],
);

export const knowledgeMergeProposals = pgTable(
  "knowledge_merge_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceConceptId: uuid("source_concept_id").notNull().references(() => knowledgeConcepts.id),
    targetConceptId: uuid("target_concept_id").notNull().references(() => knowledgeConcepts.id),
    similarity: real("similarity").notNull(),
    status: text("status").notNull().default("proposed"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_knowledge_merge_proposals_unique").on(
      table.tenantId,
      table.sourceConceptId,
      table.targetConceptId,
    ),
    index("idx_knowledge_merge_proposals_status").on(table.tenantId, table.status),
    check("chk_knowledge_merge_proposals_status", sql`${table.status} in ('proposed', 'accepted', 'rejected')`),
  ],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull().default("新对话"),
    lastSequence: integer("last_sequence").notNull().default(0),
    ...ownedColumns,
  },
  (table) => [
    index("idx_ai_conversations_user_updated").on(table.tenantId, table.userId, table.updatedAt),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role").notNull(),
    activeProjectId: uuid("active_project_id").references(() => projects.id),
    scopeResolution: text("scope_resolution").notNull().default("none"),
    status: text("status").notNull().default("complete"),
    usage: jsonb("usage").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_messages_conversation_sequence_unique").on(table.conversationId, table.sequence),
    index("idx_ai_messages_tenant_conversation").on(table.tenantId, table.conversationId, table.sequence),
    check("chk_ai_messages_role", sql`${table.role} in ('user', 'assistant')`),
    check("chk_ai_messages_scope", sql`${table.scopeResolution} in ('route', 'explicit', 'recent', 'inferred', 'none')`),
    check("chk_ai_messages_status", sql`${table.status} in ('streaming', 'complete', 'failed')`),
  ],
);

export const aiMessageParts = pgTable(
  "ai_message_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<AiMessagePart>().notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_message_parts_message_index_unique").on(table.messageId, table.partIndex),
    index("idx_ai_message_parts_tenant").on(table.tenantId, table.messageId),
  ],
);

export const aiMessageCitations = pgTable(
  "ai_message_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    projectId: uuid("project_id").notNull(),
    documentId: uuid("document_id"),
    chunkIndex: integer("chunk_index"),
    blockIds: text("block_ids").array().notNull().default(textArrayDefault),
    headingPath: text("heading_path").array().notNull().default(textArrayDefault),
    titleSnapshot: text("title_snapshot").notNull(),
    snippet: text("snippet").notNull(),
    tier: text("tier").notNull(),
    retrieval: jsonb("retrieval").$type<CitationRetrievalTrace>().notNull(),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_message_citations_message_rank_unique").on(table.messageId, table.rank),
    index("idx_ai_message_citations_source").on(table.tenantId, table.sourceType, table.sourceId),
    index("idx_ai_message_citations_project").on(table.projectId),
    check("chk_ai_message_citations_tier", sql`${table.tier} in ('active_project', 'tenant_global', 'graph_expanded')`),
  ],
);

export const aiFeedbackEvents = pgTable(
  "ai_feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    citationId: uuid("citation_id").references(() => aiMessageCitations.id, { onDelete: "cascade" }),
    vote: text("vote").notNull(),
    reason: text("reason"),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_feedback_events_target_user_unique").on(
      table.messageId,
      table.userId,
      sql`coalesce(${table.citationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("idx_ai_feedback_events_tenant").on(table.tenantId, table.createdAt),
    check("chk_ai_feedback_events_vote", sql`${table.vote} in ('up', 'down')`),
    check(
      "chk_ai_feedback_events_reason",
      sql`${table.reason} is null or ${table.reason} in ('irrelevant', 'outdated', 'wrong_project', 'incomplete')`,
    ),
  ],
);

export const aiRetrievalTraces = pgTable(
  "ai_retrieval_traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    messageId: uuid("message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    stages: jsonb("stages").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_retrieval_traces_message_unique").on(table.messageId),
    index("idx_ai_retrieval_traces_tenant").on(table.tenantId, table.createdAt),
  ],
);

export const aiAssistantRuns = pgTable(
  "ai_assistant_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    userMessageId: uuid("user_message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id").notNull().references(() => aiMessages.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    leaseId: uuid("lease_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    request: jsonb("request")
      .$type<{ includeCrossProject?: boolean; requestId?: string }>()
      .notNull()
      .default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_assistant_runs_assistant_message_unique").on(table.assistantMessageId),
    index("idx_ai_assistant_runs_status_next").on(table.status, table.nextAttemptAt),
    index("idx_ai_assistant_runs_tenant_conversation").on(table.tenantId, table.conversationId),
    check("chk_ai_assistant_runs_status", sql`${table.status} in ('queued', 'running', 'complete', 'failed')`),
  ],
);

export const aiRunSteps = pgTable(
  "ai_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => aiAssistantRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_ai_run_steps_run_index_unique").on(table.runId, table.stepIndex),
    index("idx_ai_run_steps_tenant").on(table.tenantId, table.runId),
    check("chk_ai_run_steps_status", sql`${table.status} in ('pending', 'running', 'complete', 'failed')`),
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
    purpose: text("purpose").notNull(),
    checksum: text("checksum"),
    status: text("status").notNull().default("uploading"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonbObjectDefault),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_media_objects_key_unique").on(table.bucket, table.objectKey),
    index("idx_media_objects_tenant").on(table.tenantId),
    index("idx_media_objects_tenant_status").on(table.tenantId, table.status),
    index("idx_media_objects_tenant_purpose").on(table.tenantId, table.purpose),
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

export const mediaDeletionJobs = pgTable(
  "media_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...ownedColumns,
  },
  (table) => [
    uniqueIndex("idx_media_deletion_jobs_media_unique").on(table.mediaId),
    index("idx_media_deletion_jobs_status_next").on(table.status, table.nextAttemptAt),
    index("idx_media_deletion_jobs_tenant").on(table.tenantId),
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
