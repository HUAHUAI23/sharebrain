import { Button } from "@sharebrain/ui/components/button";
import { m } from "@sharebrain/i18n";
import { Input } from "@sharebrain/ui/components/input";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import {
  NotionEmpty,
  NotionIcon,
  NotionList,
  NotionSegmentedButton,
  NotionSegmentedControl,
  NotionText,
  NotionToolbar,
} from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Boxes, FileText, LayoutList, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import type { ModuleTemplatesResponse, WorkspaceView } from "../workspace/workspace-types";

type ModuleTemplatesViewProps = {
  onNavigate: (view: WorkspaceView) => void;
};

type ModuleKind = "timeline" | "collection";

const kindLabels: Record<ModuleKind, string> = {
  timeline: m.module_timeline_label(),
  collection: m.module_collection_label(),
};

function slugifyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function ModuleTemplatesView({ onNavigate }: ModuleTemplatesViewProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ModuleKind>("timeline");
  const [createError, setCreateError] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: queryKeys.moduleTemplates,
    queryFn: () => apiRequest<ModuleTemplatesResponse>("/api/module-templates"),
  });

  const createTemplate = useMutation({
    mutationFn: (templateName: string) =>
      apiRequest("/api/module-templates", {
        method: "POST",
        body: {
          key: slugifyKey(templateName) || `module-${Date.now()}`,
          name: templateName,
          kind,
        },
      }),
    async onSuccess() {
      setName("");
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_template_error());
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest(`/api/module-templates/${templateId}`, {
        method: "DELETE",
      }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
  });

  const items = templates.data?.items ?? [];

  return (
    <main className="template-shell">
      <NotionToolbar>
        <Button variant="ghost" size="icon" aria-label={m.common_back_home()} onClick={() => onNavigate({ type: "home" })}>
          <ArrowLeft size={16} />
        </Button>
        <NotionIcon>
          <LayoutList size={14} />
        </NotionIcon>
        <strong className="text-[13px] font-semibold">{m.module_templates_title()}</strong>
      </NotionToolbar>

      <section className="template-page">
        <div className="page-title">
          <NotionIcon size="lg">
            <Boxes size={22} />
          </NotionIcon>
          <div>
            <h1>{m.module_templates_title()}</h1>
            <p>{m.module_templates_description()}</p>
          </div>
        </div>

        <NotionList>
          {templates.isLoading ? (
            <NotionEmpty>{m.module_templates_loading()}</NotionEmpty>
          ) : items.length > 0 ? (
            items.map((template) => (
              <div
                className="grid min-h-[38px] grid-cols-[28px_minmax(0,1fr)_30px] items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent"
                key={template.id}
              >
                <NotionIcon>
                  <FileText size={14} />
                </NotionIcon>
                <NotionText title={template.name} description={`${kindLabels[template.kind]} · ${m.module_field_count({ count: template.fields.length })}`} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.common_delete_named({ name: template.name })}
                  disabled={deleteTemplate.isPending}
                  onClick={() => deleteTemplate.mutate(template.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))
          ) : (
            <NotionEmpty>{m.module_no_templates()}</NotionEmpty>
          )}
        </NotionList>

        <div className="template-composer">
          <NotionSegmentedControl role="group" aria-label={m.module_type_aria()}>
            {(["timeline", "collection"] as const).map((option) => (
              <NotionSegmentedButton
                key={option}
                type="button"
                active={kind === option}
                onClick={() => setKind(option)}
              >
                {kindLabels[option]}
              </NotionSegmentedButton>
            ))}
          </NotionSegmentedControl>
          <NotionCreateRow
            value={name}
            onValueChange={(value) => {
              setName(value);
              setCreateError(null);
            }}
            onCreate={() => createTemplate.mutate(name.trim() || m.template_untitled())}
            placeholder={m.template_create_placeholder()}
            ariaLabel={m.template_create_aria()}
            isPending={createTemplate.isPending}
            error={createError}
          >
            <Input value={slugifyKey(name)} readOnly aria-label={m.module_key_aria()} placeholder="module-key" />
          </NotionCreateRow>
        </div>
      </section>
    </main>
  );
}
