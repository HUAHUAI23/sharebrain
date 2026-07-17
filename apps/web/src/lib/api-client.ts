import { m } from "@sharebrain/i18n";

import { runtimeEnv } from "./runtime-env";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function apiRequest<TResponse>(path: string, options: RequestOptions = {}) {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };
  const response = await fetch(`${runtimeEnv.WEB_PUBLIC_API_BASE_URL}${path}`, init);
  const contentType = response.headers.get("content-type") ?? "";

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = payload as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiClientError(
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? m.error_api_request_failed(),
      error?.details,
    );
  }

  if (!contentType.includes("application/json")) {
    throw new ApiClientError("INVALID_RESPONSE", m.error_api_invalid_response());
  }

  return payload as TResponse;
}

export const queryKeys = {
  me: ["me"] as const,
  auth: ["auth"] as const,
  recents: ["me", "recents"] as const,
  projects: ["projects"] as const,
  moduleTemplates: ["module-templates"] as const,
  storageSummary: ["storage", "summary"] as const,
  mediaLimits: ["media", "limits"] as const,
  members: ["members"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  modules: (projectId: string) => ["projects", projectId, "modules"] as const,
  records: (projectId: string, moduleId: string) =>
    ["projects", projectId, "modules", moduleId, "records"] as const,
  documents: (projectId: string, moduleId?: string, moduleRecordId?: string | null) =>
    ["projects", projectId, "documents", moduleId ?? "all", moduleRecordId ?? "none"] as const,
  document: (documentId: string) => ["documents", documentId] as const,
  documentMetadata: (documentId: string) => ["documents", documentId, "metadata"] as const,
  documentPreview: (documentId: string) => ["documents", documentId, "preview"] as const,
  documentDiscussions: (documentId: string) => ["documents", documentId, "discussions"] as const,
  documentActivities: (documentId: string) => ["documents", documentId, "activities"] as const,
  documentActivity: (documentId: string, activityId: string) =>
    ["documents", documentId, "activities", activityId] as const,
  documentVersions: (documentId: string) => ["documents", documentId, "versions"] as const,
  documentVersion: (documentId: string, versionId: string) =>
    ["documents", documentId, "versions", versionId] as const,
  search: (query: string) => ["search", query] as const,
};
