import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { ListTree, Plus } from "lucide-react";
import { useState } from "react";

import { PageTitle } from "../../components/page-title";
import { apiRequest, queryKeys } from "../../lib/api-client";
import { formatModuleFieldValue } from "../dynamic-fields/dynamic-field-control";
import type { RecordsResponse } from "../workspace/workspace-types";
import type { ModuleViewProps } from "./project-types";
import { RecordComposerSheet } from "./record-composer-sheet";
import { RecordDocuments } from "./record-documents";

import type { TenantMember } from "@sharebrain/contracts";

export function TimelineModule({ projectId, moduleId, module, onNavigate }: ModuleViewProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const records = useQuery({
    queryKey: queryKeys.records(projectId, moduleId),
    queryFn: () => apiRequest<RecordsResponse>(`/api/projects/${projectId}/modules/${moduleId}/records`),
  });
  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => apiRequest<{ items: TenantMember[] }>("/api/members"),
    enabled: module?.fields.some((field) => field.type === "user") ?? false,
  });

  return (
    <div className="module-page">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <PageTitle
          icon={<ListTree size={24} />}
          title={module?.name ?? m.module_timeline_label()}
          description={m.module_timeline_description()}
        />
        <Button size="sm" onClick={() => setComposerOpen(true)}><Plus />{m.timeline_create_placeholder()}</Button>
      </div>
      <div className="timeline-list mt-8">
        {(records.data?.items ?? []).length > 0 ? (
          (records.data?.items ?? []).map((record) => (
            <article className="timeline-item" key={record.id}>
              <div className="timeline-marker" aria-hidden="true" />
              <time>{new Date(record.occurredAt).toLocaleString()}</time>
              <h2>{record.title}</h2>
              <div className="record-values">
                {module?.fields.map((field) => {
                  const displayValue = formatModuleFieldValue(field, record.values[field.id], members.data?.items);
                  return displayValue ? <span key={field.id}>{field.label}: {displayValue}</span> : null;
                })}
              </div>
              <RecordDocuments projectId={projectId} moduleId={moduleId} recordId={record.id} onNavigate={onNavigate} />
            </article>
          ))
        ) : (
          <NotionEmpty>{m.module_no_records()}</NotionEmpty>
        )}
      </div>
      <RecordComposerSheet
        open={composerOpen}
        onOpenChange={setComposerOpen}
        projectId={projectId}
        moduleId={moduleId}
        fields={module?.fields ?? []}
      />
    </div>
  );
}
