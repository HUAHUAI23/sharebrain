import type {
  DocumentDetail,
  DocumentPreview,
  DocumentMetadata,
  DocumentSummary,
  MediaObject,
  ModuleField,
  ModuleTemplateField,
  ModuleRecord,
  Project,
  ProjectModule,
  ProjectRecent,
  User,
} from "@sharebrain/contracts";
import type {
  documents,
  documentVersions,
  mediaObjects,
  moduleRecords,
  moduleTemplateFields,
  projectModuleFields,
  projectModules,
  projects,
  projectRecents,
  users,
} from "@sharebrain/db/schema";
import { createGeneratedAvatarDescriptor } from "./avatar";

type Select<TTable extends { $inferSelect: unknown }> = TTable["$inferSelect"];

export function toIso(value: Date) {
  return value.toISOString();
}

export function serializeUser(
  row: Select<typeof users>,
  avatar: User["avatar"] = createGeneratedAvatarDescriptor(row.id),
): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarMediaId: row.avatarMediaId,
    avatar,
  };
}

export function serializeProject(row: Select<typeof projects>): Project {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    status: row.status,
    tags: row.tags,
    ownerId: row.ownerId,
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeProjectRecent(
  project: Select<typeof projects>,
  recent: Pick<Select<typeof projectRecents>, "lastViewedAt">,
): ProjectRecent {
  return {
    ...serializeProject(project),
    lastViewedAt: toIso(recent.lastViewedAt),
  };
}

export function serializeField(row: Select<typeof projectModuleFields>): ModuleField {
  return {
    id: row.id,
    moduleId: row.moduleId,
    key: row.key,
    label: row.label,
    type: row.type as ModuleField["type"],
    required: row.required,
    defaultKind: row.defaultKind as ModuleField["defaultKind"],
    defaultValue: row.defaultValue ?? null,
    options: row.options,
    sortKey: row.sortKey,
  };
}

export function serializeTemplateField(row: Select<typeof moduleTemplateFields>): ModuleTemplateField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as ModuleTemplateField["type"],
    required: row.required,
    defaultKind: row.defaultKind as ModuleTemplateField["defaultKind"],
    defaultValue: row.defaultValue ?? null,
    options: row.options,
    sortKey: row.sortKey,
  };
}

export function serializeModule(
  row: Select<typeof projectModules>,
  fields: Select<typeof projectModuleFields>[],
  options: { isSystemFixed?: boolean } = {},
): ProjectModule {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceTemplateId: row.sourceTemplateId,
    isSystemFixed: options.isSystemFixed ?? false,
    key: row.key,
    name: row.name,
    kind: row.kind as ProjectModule["kind"],
    description: row.description,
    icon: row.icon,
    sortKey: row.sortKey,
    fields: fields.map(serializeField),
  };
}

export function serializeDocumentSummary(row: Select<typeof documents>): DocumentSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    moduleId: row.moduleId,
    moduleRecordId: row.moduleRecordId,
    parentId: row.parentId,
    title: row.title,
    status: row.status as DocumentSummary["status"],
    visibility: row.visibility as DocumentSummary["visibility"],
    sortKey: row.sortKey,
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeModuleRecord(
  row: Select<typeof moduleRecords>,
  recordDocuments: Select<typeof documents>[],
): ModuleRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    moduleId: row.moduleId,
    title: row.title,
    occurredAt: toIso(row.occurredAt),
    values: row.values,
    sortKey: row.sortKey,
    documents: recordDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      updatedAt: toIso(document.updatedAt),
    })),
  };
}

export function serializeDocumentDetail(
  row: Select<typeof documents>,
  version: Pick<Select<typeof documentVersions>, "plateJson" | "markdown" | "plainText"> | undefined,
): DocumentDetail {
  return {
    ...serializeDocumentSummary(row),
    currentVersion: row.currentVersion,
    plateJson: version?.plateJson ?? [{ type: "p", children: [{ text: "" }] }],
    markdown: version?.markdown ?? "",
    plainText: version?.plainText ?? "",
  };
}

export function serializeDocumentMetadata(
  row: Select<typeof documents>,
): DocumentMetadata {
  return {
    ...serializeDocumentSummary(row),
    currentVersion: row.currentVersion,
  };
}

export function serializeDocumentPreview(
  row: Select<typeof documents>,
  plateJson: unknown[],
  totalBlocks: number,
): DocumentPreview {
  return {
    ...serializeDocumentMetadata(row),
    plateJson,
    totalBlocks,
  };
}

export function serializeMediaObject(row: Select<typeof mediaObjects>): MediaObject {
  return {
    id: row.id,
    parentMediaId: row.parentMediaId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    purpose: row.purpose as MediaObject["purpose"],
    status: row.status as MediaObject["status"],
    createdAt: toIso(row.createdAt),
  };
}
