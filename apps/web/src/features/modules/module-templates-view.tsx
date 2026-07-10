import { Button } from "@sharebrain/ui/components/button";
import { m } from "@sharebrain/i18n";
import { Input } from "@sharebrain/ui/components/input";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import {
  NotionEmpty,
  NotionIcon,
  NotionList,
  NotionListRow,
  NotionSegmentedButton,
  NotionSegmentedControl,
  NotionText,
  NotionToolbar,
} from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenText, Boxes, FileText, LayoutList, LockKeyhole, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PageTitle } from "../../components/page-title";
import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import { ModuleTemplateEditor } from "./module-template-editor";
import { getKindLabel, moduleKinds, slugifyKey } from "./module-template-utils";
import type { ModuleTemplatesResponse, WorkspaceView } from "../workspace/workspace-types";

import type { ModuleFieldType, ModuleKind, ModuleTemplate } from "@sharebrain/contracts";

type ModuleTemplatesViewProps = {
  onNavigate: (view: WorkspaceView) => void;
};

type TemplateUpdatePayload = {
  key?: string;
  name?: string;
  description?: string;
  icon?: string;
};

type FieldPayload = {
  id?: string;
  key: string;
  label: string;
  type: ModuleFieldType;
  required: boolean;
  defaultPolicy: "empty" | "fixed";
  defaultValue?: unknown;
  options: Array<{ id: string; label: string; color?: string }>;
};

function templateIcon(template: ModuleTemplate) {
  if (template.kind === "timeline") {
    return <LayoutList size={14} />;
  }
  return template.key === "knowledge-base" ? <BookOpenText size={14} /> : <FileText size={14} />;
}

function TemplateListSection({
  title,
  items,
  selectedId,
  onSelect,
  onDelete,
  isDeleting,
}: {
  title: ReactNode;
  items: ModuleTemplate[];
  selectedId: string | undefined;
  onSelect: (templateId: string) => void;
  onDelete: (templateId: string) => void;
  isDeleting: boolean;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-1">
      <div className="px-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      <NotionList>
        {items.map((template) => (
          <NotionListRow
            asChild
            key={template.id}
            active={selectedId === template.id}
            className="grid-cols-[24px_minmax(0,1fr)_30px] px-1.5 py-1.5"
          >
            <div>
              <button className="contents" type="button" onClick={() => onSelect(template.id)}>
                <NotionIcon>{templateIcon(template)}</NotionIcon>
                <NotionText title={template.name} description={`${getKindLabel(template.kind)} · ${m.module_field_count({ count: template.fields.length })}`} />
              </button>
              {template.isSystemFixed ? (
                <span className="inline-flex size-7 items-center justify-center text-muted-foreground" aria-label={m.template_fixed_badge()}>
                  <LockKeyhole size={13} />
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.common_delete_named({ name: template.name })}
                  disabled={isDeleting}
                  onClick={() => onDelete(template.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </NotionListRow>
        ))}
      </NotionList>
    </div>
  );
}

export function ModuleTemplatesView({ onNavigate }: ModuleTemplatesViewProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ModuleKind>("timeline");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: queryKeys.moduleTemplates,
    queryFn: () => apiRequest<ModuleTemplatesResponse>("/api/module-templates"),
  });

  const items = useMemo(() => templates.data?.items ?? [], [templates.data?.items]);
  const fixedItems = useMemo(() => items.filter((template) => template.isSystemFixed), [items]);
  const customItems = useMemo(() => items.filter((template) => !template.isSystemFixed), [items]);
  const selectedTemplate = items.find((template) => template.id === selectedId) ?? items[0];

  useEffect(() => {
    if (!selectedId && items[0]) {
      setSelectedId(items[0].id);
      return;
    }
    if (selectedId && items.length > 0 && !items.some((template) => template.id === selectedId)) {
      setSelectedId(items[0]?.id);
    }
  }, [items, selectedId]);

  useEffect(() => {
    setUpdateError(null);
    setFieldError(null);
  }, [selectedId]);

  const createTemplate = useMutation({
    mutationFn: (templateName: string) =>
      apiRequest<ModuleTemplate>("/api/module-templates", {
        method: "POST",
        body: {
          key: slugifyKey(templateName) || `module-${Date.now()}`,
          name: templateName,
          kind,
        },
      }),
    async onSuccess(template) {
      setName("");
      setCreateError(null);
      setSelectedId(template.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_template_error());
    },
  });

  const updateTemplate = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: TemplateUpdatePayload }) =>
      apiRequest<ModuleTemplate>(`/api/module-templates/${templateId}`, {
        method: "PATCH",
        body: payload,
      }),
    async onSuccess(template) {
      setSelectedId(template.id);
      setUpdateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setUpdateError(error instanceof ApiClientError ? error.message : m.template_update_error());
    },
  });

  const saveField = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: FieldPayload }) =>
      apiRequest(`/api/module-templates/${templateId}/fields`, {
        method: "POST",
        body: payload,
      }),
    async onSuccess() {
      setFieldError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setFieldError(error instanceof ApiClientError ? error.message : m.field_save_error());
    },
  });

  const deleteField = useMutation({
    mutationFn: ({ templateId, fieldId }: { templateId: string; fieldId: string }) =>
      apiRequest(`/api/module-templates/${templateId}/fields/${fieldId}`, {
        method: "DELETE",
      }),
    async onSuccess() {
      setFieldError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setFieldError(error instanceof ApiClientError ? error.message : m.field_delete_error());
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
        <PageTitle icon={<Boxes size={22} />} title={m.module_templates_title()} description={m.module_templates_description()} />

        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-8 max-[860px]:grid-cols-1">
          <aside className="grid content-start gap-5">
            {templates.isLoading ? (
              <NotionEmpty>{m.module_templates_loading()}</NotionEmpty>
            ) : items.length > 0 ? (
              <>
                <TemplateListSection
                  title={m.template_fixed_section()}
                  items={fixedItems}
                  selectedId={selectedTemplate?.id}
                  isDeleting={deleteTemplate.isPending}
                  onSelect={setSelectedId}
                  onDelete={(templateId) => deleteTemplate.mutate(templateId)}
                />
                <TemplateListSection
                  title={m.template_custom_section()}
                  items={customItems}
                  selectedId={selectedTemplate?.id}
                  isDeleting={deleteTemplate.isPending}
                  onSelect={setSelectedId}
                  onDelete={(templateId) => deleteTemplate.mutate(templateId)}
                />
              </>
            ) : (
              <NotionEmpty>{m.module_no_templates()}</NotionEmpty>
            )}

            <div className="grid gap-2">
              <NotionSegmentedControl role="group" aria-label={m.module_type_aria()}>
                {moduleKinds.map((option) => (
                  <NotionSegmentedButton key={option} type="button" active={kind === option} onClick={() => setKind(option)}>
                    {getKindLabel(option)}
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
                className="items-start"
              >
                <Input value={slugifyKey(name)} readOnly aria-label={m.module_key_aria()} placeholder="module-key" className="h-6 text-xs text-muted-foreground" />
              </NotionCreateRow>
            </div>
          </aside>

          <ModuleTemplateEditor
            template={selectedTemplate}
            isUpdating={updateTemplate.isPending}
            updateError={updateError}
            isSavingField={saveField.isPending}
            fieldError={fieldError}
            onUpdate={(templateId, payload) => updateTemplate.mutate({ templateId, payload })}
            onSaveField={(templateId, payload) => saveField.mutate({ templateId, payload })}
            onDeleteField={(templateId, fieldId) => deleteField.mutate({ templateId, fieldId })}
          />
        </div>
      </section>
    </main>
  );
}
