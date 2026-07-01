import { Input } from "@sharebrain/ui/components/input";
import { m } from "@sharebrain/i18n";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import { NotionEmpty, NotionIcon } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../lib/api-client";
import { apiRequest, queryKeys } from "../../lib/api-client";
import type { RecordsResponse } from "../workspace/workspace-types";
import type { ModuleViewProps } from "./project-types";
import { RecordDocuments } from "./record-documents";

export function TimelineModule({ projectId, moduleId, module, onNavigate }: ModuleViewProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const records = useQuery({
    queryKey: queryKeys.records(projectId, moduleId),
    queryFn: () => apiRequest<RecordsResponse>(`/api/projects/${projectId}/modules/${moduleId}/records`),
  });
  const createRecord = useMutation({
    mutationFn: () =>
      apiRequest(`/api/projects/${projectId}/modules/${moduleId}/records`, {
        method: "POST",
        body: { title: title.trim() || m.timeline_untitled(), values },
      }),
    async onSuccess() {
      setTitle("");
      setValues({});
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.records(projectId, moduleId) });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_record_error());
    },
  });

  function createTimelineRecord() {
    createRecord.mutate();
  }

  return (
    <div className="module-page">
      <header className="page-title">
        <NotionIcon size="lg">
          <ListTree size={24} />
        </NotionIcon>
        <div>
          <h1>{module?.name ?? m.module_timeline_label()}</h1>
          <p>{m.module_timeline_description()}</p>
        </div>
      </header>
      <NotionCreateRow
        value={title}
        onValueChange={(value) => {
          setTitle(value);
          setCreateError(null);
        }}
        onCreate={createTimelineRecord}
        placeholder={m.timeline_create_placeholder()}
        ariaLabel={m.timeline_create_aria()}
        isPending={createRecord.isPending}
        error={createError}
        className="record-composer"
      >
        {module?.fields.map((field) => (
          <label className="grid min-h-7 grid-cols-[132px_minmax(0,1fr)] items-center gap-2 py-px text-[13px] text-muted-foreground max-[860px]:grid-cols-1 max-[860px]:gap-1" key={field.id}>
            <span className="truncate">{field.label}</span>
            <Input
              aria-label={field.label}
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              value={String(values[field.id] ?? "")}
              onChange={(event) => {
                const raw = event.target.value;
                setCreateError(null);
                setValues((current) => ({
                  ...current,
                  [field.id]: field.type === "number" && raw !== "" ? Number(raw) : raw,
                }));
              }}
            />
          </label>
        ))}
      </NotionCreateRow>
      <div className="timeline-list">
        {(records.data?.items ?? []).length > 0 ? (
          (records.data?.items ?? []).map((record) => (
            <article className="timeline-item" key={record.id}>
              <div className="timeline-marker" aria-hidden="true" />
              <time>{new Date(record.occurredAt).toLocaleString()}</time>
              <h2>{record.title}</h2>
              <div className="record-values">
                {module?.fields.map((field) => {
                  const value = record.values[field.id];
                  return value ? (
                    <span key={field.id}>
                      {field.label}: {String(value)}
                    </span>
                  ) : null;
                })}
              </div>
              <RecordDocuments projectId={projectId} moduleId={moduleId} recordId={record.id} onNavigate={onNavigate} />
            </article>
          ))
        ) : (
          <NotionEmpty>{m.module_no_records()}</NotionEmpty>
        )}
      </div>
    </div>
  );
}
