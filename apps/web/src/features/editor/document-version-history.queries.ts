// 封装 sealed 版本列表分页和详情懒加载，UI 不直接拼接 HTTP 协议。
import type { DocumentVersionDetail, DocumentVersionListResponse } from "@sharebrain/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiRequest, queryKeys } from "../../lib/api-client";

export function useDocumentVersionList(documentId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.documentVersions(documentId),
    queryFn: ({ pageParam }) => {
      const cursor = typeof pageParam === "string" ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      return apiRequest<DocumentVersionListResponse>(
        `/api/documents/${documentId}/versions?limit=30${cursor}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export function useDocumentVersionDetail(
  documentId: string,
  versionId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.documentVersion(documentId, versionId ?? "none"),
    queryFn: () =>
      apiRequest<DocumentVersionDetail>(`/api/documents/${documentId}/versions/${versionId}`),
    enabled: enabled && Boolean(versionId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
