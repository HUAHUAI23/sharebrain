// 展示时间线记录、属性摘要与记录创建入口。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
  const recordItems = records.data?.items ?? [];

  return (
    <div className="module-page">
      <div className="module-header flex items-start justify-between gap-6 border-b border-border-subtle pb-6">
        <PageTitle
          className="mb-0"
          title={module?.name ?? m.module_timeline_label()}
          description={m.module_timeline_description()}
        />
        <Button className="mt-0.5 shrink-0" size="sm" onClick={() => setComposerOpen(true)}>
          <Plus />
          {m.timeline_create_placeholder()}
        </Button>
      </div>
      <div className={recordItems.length ? "timeline-list mt-7" : ""}>
        {recordItems.length > 0 ? (
          recordItems.map((record) => {
            const properties = (module?.fields ?? []).flatMap((field) => {
                  const displayValue = formatModuleFieldValue(field, record.values[field.id], members.data?.items);
              return displayValue ? [{ field, displayValue }] : [];
            });
            return (
              <article className="timeline-item" key={record.id}>
                <div className="timeline-marker" aria-hidden="true" />
                <time>{new Date(record.occurredAt).toLocaleString()}</time>
                <h2>{record.title}</h2>
                {properties.length ? (
                  <dl className="record-values">
                    {properties.map(({ field, displayValue }) => (
                      <div className="record-property" key={field.id}>
                        <dt>{field.label}</dt>
                        <dd>{displayValue}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <RecordDocuments projectId={projectId} moduleId={moduleId} recordId={record.id} onNavigate={onNavigate} />
              </article>
            );
          })
        ) : (
          <NotionEmpty className="flex min-h-32 items-center justify-center border-b border-border-subtle px-4 py-10 text-sm">
            {m.module_no_records()}
          </NotionEmpty>
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
