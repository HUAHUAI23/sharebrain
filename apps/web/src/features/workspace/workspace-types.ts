import type {
  DocumentDetail,
  DocumentSummary,
  MeResponse,
  ModuleRecord,
  ModuleTemplate,
  Project,
  ProjectModule,
} from "@sharebrain/contracts";

// 页面身份以 TanStack Router URL 为事实源；WorkspaceView 只作为组件间导航意图适配类型。
export type WorkspaceView =
  | { type: "home" }
  | { type: "new-project-settings" }
  | { type: "storage-settings" }
  | { type: "project"; projectId: string; moduleId?: string; recordId?: string }
  | { type: "document"; projectId: string; moduleId: string; documentId: string; recordId?: string }
  | { type: "document-lookup"; documentId: string };

export type ProjectsResponse = { items: Project[] };
export type RecentsResponse = { items: Array<Project & { lastViewedAt: string }> };
export type { MeResponse };
export type ModulesResponse = { items: ProjectModule[] };
export type ModuleTemplatesResponse = { items: ModuleTemplate[] };
export type RecordsResponse = { items: ModuleRecord[] };
export type DocumentsResponse = { items: DocumentSummary[] };
export type SearchResponse = { items: Array<{ id: string; title: string; snippet: string; entityType: string; projectId: string | null; documentId: string | null }> };
export type DocumentResponse = DocumentDetail;
