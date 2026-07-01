import type { DocumentDetail, DocumentSummary, ModuleRecord, ModuleTemplate, Project, ProjectModule } from "@sharebrain/contracts";

export type WorkspaceView =
  | { type: "home" }
  | { type: "module-templates" }
  | { type: "project"; projectId: string; moduleId?: string; recordId?: string }
  | { type: "document"; projectId: string; moduleId: string; documentId: string; recordId?: string };

export type ProjectsResponse = { items: Project[] };
export type RecentsResponse = { items: Array<Project & { lastViewedAt: string }> };
export type MeResponse = {
  user: {
    id: string;
    displayName: string;
    email: string;
    avatarMediaId: string | null;
  };
  tenant: {
    id: string;
    name: string;
    kind: string;
  };
  role: string;
  authProvider?: string | null;
};
export type ModulesResponse = { items: ProjectModule[] };
export type ModuleTemplatesResponse = { items: ModuleTemplate[] };
export type RecordsResponse = { items: ModuleRecord[] };
export type DocumentsResponse = { items: DocumentSummary[] };
export type SearchResponse = { items: Array<{ id: string; title: string; snippet: string; entityType: string; projectId: string | null; documentId: string | null }> };
export type DocumentResponse = DocumentDetail;
