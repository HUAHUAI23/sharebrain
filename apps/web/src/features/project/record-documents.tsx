import { m } from "@sharebrain/i18n";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import { NotionListRow } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../lib/api-client";
import { apiRequest, queryKeys } from "../../lib/api-client";
import type { DocumentsResponse } from "../workspace/workspace-types";
import type { ModuleViewProps } from "./project-types";

type RecordDocumentsProps = ModuleViewProps & {
  recordId: string;
};

export function RecordDocuments({ projectId, moduleId, recordId, onNavigate }: RecordDocumentsProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: queryKeys.documents(projectId, moduleId, recordId),
    queryFn: () =>
      apiRequest<DocumentsResponse>(
        `/api/projects/${projectId}/documents?moduleId=${moduleId}&moduleRecordId=${recordId}`,
      ),
  });
  const createDocument = useMutation({
    mutationFn: (documentTitle: string) =>
      apiRequest<{ id: string }>(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: { moduleId, moduleRecordId: recordId, title: documentTitle },
      }),
    async onSuccess(document) {
      setTitle("");
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId, moduleId, recordId) });
      onNavigate({ type: "document", projectId, moduleId, recordId, documentId: document.id });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_document_error());
    },
  });

  return (
    <div className="record-documents">
      {(documents.data?.items ?? []).map((document) => (
        <NotionListRow
          asChild
          className="w-fit grid-cols-[14px_minmax(0,1fr)] px-1.5 py-1 text-[13px] text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
          key={document.id}
        >
          <button type="button" onClick={() => onNavigate({ type: "document", projectId, moduleId, recordId, documentId: document.id })}>
            <FileText size={14} />
            <span className="truncate">{document.title}</span>
          </button>
        </NotionListRow>
      ))}
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
        compact
      />
    </div>
  );
}
