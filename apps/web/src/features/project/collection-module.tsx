import { m } from "@sharebrain/i18n";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import { NotionEmpty, NotionList, NotionListRow } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, FileText } from "lucide-react";
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
        icon={<BookOpenText size={24} />}
        title={module?.name ?? m.module_collection_label()}
        description={m.module_collection_description()}
      />
      <NotionList>
        {(documents.data?.items ?? []).length > 0 ? (
          (documents.data?.items ?? []).map((document) => (
            <NotionListRow
              asChild
              key={document.id}
              className="grid-cols-[18px_minmax(0,1fr)] px-2 py-1.5"
            >
              <button type="button" onClick={() => onNavigate({ type: "document", projectId, moduleId, documentId: document.id })}>
                <FileText size={15} />
                <span className="truncate">{document.title}</span>
              </button>
            </NotionListRow>
          ))
        ) : (
          <NotionEmpty>{m.module_no_documents()}</NotionEmpty>
        )}
      </NotionList>
      <NotionCreateRow
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
