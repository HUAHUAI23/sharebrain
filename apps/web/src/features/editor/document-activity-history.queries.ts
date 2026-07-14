// 封装文档活动时间线的游标分页和打开期间轮询，UI 不直接拼接 HTTP 协议。
import type { DocumentActivityDetail, DocumentActivityListResponse } from "@sharebrain/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiRequest, queryKeys } from "../../lib/api-client";

export function useDocumentActivityList(documentId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.documentActivities(documentId),
    queryFn: ({ pageParam }) => {
      const cursor = typeof pageParam === "string" ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      return apiRequest<DocumentActivityListResponse>(
        `/api/documents/${documentId}/activities?limit=30${cursor}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function useDocumentActivityDetail(
  documentId: string,
  activityId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.documentActivity(documentId, activityId ?? "none"),
    queryFn: () =>
      apiRequest<DocumentActivityDetail>(
        `/api/documents/${documentId}/activities/${activityId}`,
      ),
    enabled: enabled && Boolean(activityId),
    refetchInterval: (query) => query.state.data?.status === "open" ? 2_000 : false,
    staleTime: (query) => query.state.data?.status === "sealed" ? Number.POSITIVE_INFINITY : 0,
  });
}
