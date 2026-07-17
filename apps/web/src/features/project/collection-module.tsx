// 展示文档集合模块的页面列表与轻量创建入口。
import { m } from "@sharebrain/i18n";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";

import { PageTitle } from "../../components/page-title";
import { ApiClientError } from "../../lib/api-client";
import { apiRequest, queryKeys } from "../../lib/api-client";
import type { DocumentsResponse } from "../workspace/workspace-types";
import type { ModuleViewProps } from "./project-types";

export function CollectionModule({ projectId, moduleId, module, onNavigate }: ModuleViewProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: queryKeys.documents(projectId, moduleId),
    queryFn: () => apiRequest<DocumentsResponse>(`/api/projects/${projectId}/documents?moduleId=${moduleId}`),
  });
  const createDocument = useMutation({
    mutationFn: (documentTitle: string) =>
      apiRequest<{ id: string }>(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: { moduleId, title: documentTitle },
      }),
    async onSuccess(document) {
      setTitle("");
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId, moduleId) });
      onNavigate({ type: "document", projectId, moduleId, documentId: document.id });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_document_error());
    },
  });

  return (
    <div className="module-page">
      <PageTitle
        title={module?.name ?? m.module_collection_label()}
        description={m.module_collection_description()}
      />
      <NotionList className="gap-0 overflow-hidden rounded-lg border border-border-subtle bg-background divide-y divide-border-subtle">
        {(documents.data?.items ?? []).length > 0 ? (
          (documents.data?.items ?? []).map((document) => (
            <NotionListRow
              asChild
              key={document.id}
              className="min-h-12 grid-cols-[32px_minmax(0,1fr)] rounded-none px-3 py-1.5"
            >
              <button type="button" onClick={() => onNavigate({ type: "document", projectId, moduleId, documentId: document.id })}>
                <NotionIcon className="size-8 bg-muted/60 text-muted-foreground">
                  <FileText className="size-4" />
                </NotionIcon>
                <span className="truncate text-[13px] font-medium">{document.title}</span>
              </button>
            </NotionListRow>
          ))
        ) : (
          <NotionEmpty className="flex min-h-32 items-center justify-center px-4 py-10 text-sm">
            {m.module_no_documents()}
          </NotionEmpty>
        )}
      </NotionList>
      <NotionCreateRow
        className="mt-2 min-h-10 px-2 py-1.5"
        value={title}
        onValueChange={(value) => {
          setTitle(value);
          setCreateError(null);
        }}
        onCreate={() => createDocument.mutate(title.trim() || m.document_untitled())}
        placeholder={m.document_create_placeholder()}
        ariaLabel={m.document_create_aria()}
        isPending={createDocument.isPending}
        error={createError}
      />
    </div>
  );
}
