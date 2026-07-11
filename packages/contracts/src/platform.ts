import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const projectRoleSchema = z.enum(["viewer", "editor", "admin", "auditor"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const authProviderSchema = z.enum(["password", "feishu", "admin_managed"]);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const tenantKindSchema = z.enum(["personal", "team"]);
export type TenantKind = z.infer<typeof tenantKindSchema>;

export const moduleKindSchema = z.enum(["timeline", "collection"]);
export type ModuleKind = z.infer<typeof moduleKindSchema>;

export const moduleFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "datetime",
  "boolean",
  "select",
  "url",
  "user",
]);
export type ModuleFieldType = z.infer<typeof moduleFieldTypeSchema>;

export const fieldDefaultKindSchema = z.enum(["none", "literal", "now", "today", "current_user"]);
export type FieldDefaultKind = z.infer<typeof fieldDefaultKindSchema>;

export const documentStatusSchema = z.enum(["active", "archived", "deleted"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentVisibilitySchema = z.enum(["private", "tenant"]);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

export const mediaStatusSchema = z.enum(["uploading", "active", "pending_delete", "deleting", "purged"]);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

export const mediaPurposeSchema = z.enum(["avatar", "inline", "attachment", "cover"]);
export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;

export const mediaUsageResourceTypeSchema = z.enum(["user", "document", "document_block", "module_record"]);
export type MediaUsageResourceType = z.infer<typeof mediaUsageResourceTypeSchema>;

export const mediaUsageKindSchema = z.enum(["avatar", "attachment", "cover", "inline"]);
export type MediaUsageKind = z.infer<typeof mediaUsageKindSchema>;

export const createMediaUploadUsageKindSchema = z.enum(["avatar", "inline"]);
export type CreateMediaUploadUsageKind = z.infer<typeof createMediaUploadUsageKindSchema>;

export const searchEntityTypeSchema = z.enum([
  "project",
  "document",
  "document_block",
  "module_record",
]);
export type SearchEntityType = z.infer<typeof searchEntityTypeSchema>;

export const authContextSchema = z.object({
  userId: uuidSchema,
  tenantId: uuidSchema,
  role: projectRoleSchema,
  requestId: z.string().min(1),
});
export type AuthContext = z.infer<typeof authContextSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  avatarMediaId: uuidSchema.nullable(),
  avatar: z.object({
    kind: z.enum(["generated", "uploaded"]),
    url: z.string(),
    version: z.string(),
    byteSize: z.number().int().nonnegative().nullable(),
  }),
});
export type User = z.infer<typeof userSchema>;

export const tenantSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: tenantKindSchema,
  storageQuotaBytes: z.number().int().positive(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const meResponseSchema = z.object({
  user: userSchema,
  tenant: tenantSchema,
  role: projectRoleSchema,
  authProvider: authProviderSchema.nullable().optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const tenantMemberSchema = userSchema.pick({ id: true, email: true, displayName: true, avatar: true });
export type TenantMember = z.infer<typeof tenantMemberSchema>;

export const passwordLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;

export const passwordRegisterRequestSchema = passwordLoginRequestSchema.extend({
  displayName: z.string().trim().min(1).max(80),
});
export type PasswordRegisterRequest = z.infer<typeof passwordRegisterRequestSchema>;

export const authResponseSchema = meResponseSchema;
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const projectSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  tags: z.array(z.string()),
  ownerId: uuidSchema,
  updatedAt: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectRecentSchema = projectSchema.extend({
  lastViewedAt: isoDateTimeSchema,
});
export type ProjectRecent = z.infer<typeof projectRecentSchema>;

export const moduleFieldOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
});
export type ModuleFieldOption = z.infer<typeof moduleFieldOptionSchema>;

export const moduleFieldSchema = z.object({
  id: uuidSchema,
  moduleId: uuidSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  type: moduleFieldTypeSchema,
  required: z.boolean(),
  defaultKind: fieldDefaultKindSchema,
  defaultValue: z.unknown().nullable(),
  options: z.array(moduleFieldOptionSchema),
  sortKey: z.string(),
});
export type ModuleField = z.infer<typeof moduleFieldSchema>;

export const moduleTemplateFieldSchema = moduleFieldSchema.omit({ moduleId: true });
export type ModuleTemplateField = z.infer<typeof moduleTemplateFieldSchema>;

export const moduleTemplateSchema = z.object({
  id: uuidSchema,
  sourceSystemTemplateId: uuidSchema.nullable().optional(),
  isSystemFixed: z.boolean(),
  key: z.string(),
  name: z.string(),
  kind: moduleKindSchema,
  description: z.string().nullable(),
  icon: z.string().nullable().optional(),
  includedInNewProjects: z.boolean(),
  sortKey: z.string().optional(),
  fields: z.array(moduleTemplateFieldSchema),
});
export type ModuleTemplate = z.infer<typeof moduleTemplateSchema>;

export const createModuleTemplateRequestSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  kind: moduleKindSchema,
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(40).optional(),
  includedInNewProjects: z.boolean().default(true),
});
export type CreateModuleTemplateRequest = z.infer<typeof createModuleTemplateRequestSchema>;

export const updateModuleTemplateRequestSchema = createModuleTemplateRequestSchema.omit({ kind: true }).partial().strict();
export type UpdateModuleTemplateRequest = z.infer<typeof updateModuleTemplateRequestSchema>;

export const reorderRequestSchema = z.object({
  ids: z.array(uuidSchema).min(1),
});
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;

export const projectModuleSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sourceTemplateId: uuidSchema.nullable().optional(),
  isSystemFixed: z.boolean(),
  key: z.string(),
  name: z.string(),
  kind: moduleKindSchema,
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortKey: z.string(),
  fields: z.array(moduleFieldSchema),
});
export type ProjectModule = z.infer<typeof projectModuleSchema>;

export const createModuleRequestSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  kind: moduleKindSchema,
  description: z.string().trim().max(500).optional(),
});
export type CreateModuleRequest = z.infer<typeof createModuleRequestSchema>;

export const updateModuleRequestSchema = createModuleRequestSchema
  .omit({ kind: true })
  .partial()
  .extend({
    icon: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
export type UpdateModuleRequest = z.infer<typeof updateModuleRequestSchema>;

export const upsertModuleFieldRequestSchema = z.object({
  id: uuidSchema.optional(),
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  type: moduleFieldTypeSchema,
  required: z.boolean().default(false),
  defaultKind: fieldDefaultKindSchema.default("none"),
  defaultValue: z.unknown().nullable().optional(),
  options: z.array(moduleFieldOptionSchema).default([]),
});
export type UpsertModuleFieldRequest = z.infer<typeof upsertModuleFieldRequestSchema>;

export const moduleRecordValuesSchema = z.record(uuidSchema, z.unknown());
export type ModuleRecordValues = z.infer<typeof moduleRecordValuesSchema>;

export const moduleRecordSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  moduleId: uuidSchema,
  title: z.string(),
  occurredAt: isoDateTimeSchema,
  values: moduleRecordValuesSchema,
  sortKey: z.string(),
  documents: z.array(
    z.object({
      id: uuidSchema,
      title: z.string(),
      updatedAt: isoDateTimeSchema,
    }),
  ),
});
export type ModuleRecord = z.infer<typeof moduleRecordSchema>;

export const createModuleRecordRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  occurredAt: isoDateTimeSchema.optional(),
  values: moduleRecordValuesSchema.default({}),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
});
export type CreateModuleRecordRequest = z.infer<typeof createModuleRecordRequestSchema>;

export const updateModuleRecordRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    occurredAt: isoDateTimeSchema.optional(),
    values: moduleRecordValuesSchema.optional(),
  })
  .strict();
export type UpdateModuleRecordRequest = z.infer<typeof updateModuleRecordRequestSchema>;

export const documentSummarySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  moduleId: uuidSchema,
  moduleRecordId: uuidSchema.nullable(),
  parentId: uuidSchema.nullable(),
  title: z.string(),
  status: documentStatusSchema,
  visibility: documentVisibilitySchema,
  sortKey: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const plateNodeSchema: z.ZodType<unknown> = z.unknown();

export const documentDetailSchema = documentSummarySchema.extend({
  currentVersion: z.number().int().positive(),
  plateJson: plateNodeSchema,
  markdown: z.string(),
  plainText: z.string(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const DOCUMENT_REVIEW_MAP_NAME = "review";
export const DOCUMENT_REVIEW_VERSION_KEY = "version";
export const DOCUMENT_REVIEW_VERSION = 2;
export const DOCUMENT_DISCUSSIONS_BY_ID_KEY = "discussionsById";
export const DOCUMENT_DISCUSSION_COMMENTS_BY_ID_KEY = "commentsById";
export const DOCUMENT_COMMENT_MARK_PREFIX = "comment_";
export const DOCUMENT_DRAFT_COMMENT_MARK_KEY = "comment_draft";
export const DOCUMENT_DISCUSSION_LIMITS = {
  commentsPerDiscussion: 500,
  discussionsPerDocument: 1000,
  readStatesPerRequest: 200,
} as const;

export const documentDiscussionCommentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  contentRich: z.array(plateNodeSchema),
  createdAt: isoDateTimeSchema,
  discussionId: z.string().trim().min(1).max(120),
  isEdited: z.boolean(),
  updatedAt: isoDateTimeSchema,
  userId: uuidSchema,
});
export type DocumentDiscussionComment = z.infer<typeof documentDiscussionCommentSchema>;

export const documentDiscussionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  comments: z.array(documentDiscussionCommentSchema).max(DOCUMENT_DISCUSSION_LIMITS.commentsPerDiscussion),
  createdAt: isoDateTimeSchema,
  documentContent: z.string().max(2000).optional(),
  isResolved: z.boolean(),
  updatedAt: isoDateTimeSchema,
  userId: uuidSchema,
});
export type DocumentDiscussion = z.infer<typeof documentDiscussionSchema>;

export const documentDiscussionListSchema = z
  .array(documentDiscussionSchema)
  .max(DOCUMENT_DISCUSSION_LIMITS.discussionsPerDocument);
export type DocumentDiscussionList = z.infer<typeof documentDiscussionListSchema>;

export const documentDiscussionReadStateSchema = z.object({
  activityKey: z.string().trim().min(1).max(160),
  discussionId: z.string().trim().min(1).max(120),
  readAt: isoDateTimeSchema,
});
export type DocumentDiscussionReadState = z.infer<typeof documentDiscussionReadStateSchema>;

export const documentDiscussionReadStateListSchema = z
  .array(documentDiscussionReadStateSchema)
  .max(DOCUMENT_DISCUSSION_LIMITS.discussionsPerDocument);
export type DocumentDiscussionReadStateList = z.infer<typeof documentDiscussionReadStateListSchema>;

export const documentDiscussionsResponseSchema = z.object({
  discussions: documentDiscussionListSchema,
  readStates: documentDiscussionReadStateListSchema,
});
export type DocumentDiscussionsResponse = z.infer<typeof documentDiscussionsResponseSchema>;

export const markDocumentDiscussionsReadRequestSchema = z.object({
  items: z
    .array(
      z.object({
        activityKey: z.string().trim().min(1).max(160),
        discussionId: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(DOCUMENT_DISCUSSION_LIMITS.readStatesPerRequest),
});
export type MarkDocumentDiscussionsReadRequest = z.infer<typeof markDocumentDiscussionsReadRequestSchema>;

export const markDocumentDiscussionsReadResponseSchema = z.object({
  readStates: documentDiscussionReadStateListSchema,
});
export type MarkDocumentDiscussionsReadResponse = z.infer<typeof markDocumentDiscussionsReadResponseSchema>;

export const createDocumentRequestSchema = z.object({
  moduleId: uuidSchema,
  moduleRecordId: uuidSchema.nullable().optional(),
  parentId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const updateDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  plateJson: plateNodeSchema.optional(),
  markdown: z.string().optional(),
  plainText: z.string().optional(),
  visibility: documentVisibilitySchema.optional(),
});
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

export const searchResultSchema = z.object({
  id: uuidSchema,
  entityType: searchEntityTypeSchema,
  entityId: uuidSchema,
  projectId: uuidSchema.nullable(),
  documentId: uuidSchema.nullable(),
  blockId: z.string().nullable(),
  title: z.string(),
  path: z.string().nullable(),
  snippet: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const createMediaUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().min(1),
  usageKind: createMediaUploadUsageKindSchema,
});
export type CreateMediaUploadRequest = z.infer<typeof createMediaUploadRequestSchema>;

export const mediaUploadResponseSchema = z.object({
  uploadId: uuidSchema,
  mediaId: uuidSchema,
  url: z.string().url(),
  fields: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema,
});
export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;

export const mediaLimitsSchema = z.object({
  avatarMaxBytes: z.number().int().positive(),
});
export type MediaLimits = z.infer<typeof mediaLimitsSchema>;

export const completeMediaUploadUsageSchema = z.object({
  resourceType: z.literal("document"),
  resourceId: uuidSchema,
  usageKind: z.literal("inline"),
});
export type CompleteMediaUploadUsage = z.infer<typeof completeMediaUploadUsageSchema>;

export const completeMediaUploadRequestSchema = z.object({
  byteSize: z.number().int().min(1),
  mimeType: z.string().trim().min(1).max(120),
  usage: completeMediaUploadUsageSchema.optional(),
});
export type CompleteMediaUploadRequest = z.infer<typeof completeMediaUploadRequestSchema>;

export const mediaObjectSchema = z.object({
  id: uuidSchema,
  parentMediaId: uuidSchema.nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  purpose: mediaPurposeSchema,
  status: mediaStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type MediaObject = z.infer<typeof mediaObjectSchema>;

export const storageSummarySchema = z.object({
  quotaBytes: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  reservedBytes: z.number().int().nonnegative(),
  reclaimingBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  breakdown: z.object({
    avatar: z.number().int().nonnegative(),
    inline: z.number().int().nonnegative(),
    attachment: z.number().int().nonnegative(),
    cover: z.number().int().nonnegative(),
  }),
});
export type StorageSummary = z.infer<typeof storageSummarySchema>;

export const contextPackSchema = z.object({
  project: z.object({
    id: uuidSchema,
    name: z.string(),
  }),
  topic: z.string(),
  records: z.array(moduleRecordSchema),
  documents: z.array(documentSummarySchema),
  evidence: z.array(z.unknown()),
  compressedSummary: z.string(),
});
export type ContextPack = z.infer<typeof contextPackSchema>;

export const apiHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("api"),
  version: z.string(),
});
export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>;

export const collabHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("collab"),
  version: z.string(),
});
export type CollabHealthResponse = z.infer<typeof collabHealthResponseSchema>;

export const workerHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("worker"),
  version: z.string(),
});
export type WorkerHealthResponse = z.infer<typeof workerHealthResponseSchema>;
