// 组合新项目模块配置的导航、编辑工作区与创建流程。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sharebrain/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sharebrain/ui/components/dropdown-menu";
import { Input } from "@sharebrain/ui/components/input";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow, NotionText, NotionToolbar } from "@sharebrain/ui/components/notion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sharebrain/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import { ModuleTemplateEditor } from "./module-template-editor";
import type { FieldPayload, TemplateUpdatePayload } from "./module-template-editor.types";
import { getKindLabel, moduleKinds, slugifyKey } from "./module-template-utils";
import { getModuleTemplateVisual } from "./module-template-visual";

import type { ModuleKind, ModuleTemplate, TenantMember } from "@sharebrain/contracts";

type ModuleTemplatesViewProps = {
  selectedTemplateId?: string;
};

function TemplateListSection({
  title,
  items,
  selectedId,
  onSelect,
  onDropTemplate,
  onMoveTemplate,
}: {
  title: ReactNode;
  items: ModuleTemplate[];
  selectedId: string | undefined;
  onSelect: (templateId: string) => void;
  onDropTemplate: (draggedId: string, targetId: string) => void;
  onMoveTemplate: (templateId: string, offset: -1 | 1) => void;
}) {
  const [draggedId, setDraggedId] = useState<string>();
  if (!items.length) return null;
  return (
    <div className="grid gap-1.5">
      <div className="px-2.5 text-[11px] font-semibold text-muted-foreground">{title}</div>
      <NotionList className="gap-1">
        {items.map((template, index) => {
          const { Icon, tone } = getModuleTemplateVisual(template);
          return (
            <NotionListRow
              key={template.id}
              active={selectedId === template.id}
              className="group min-h-12 grid-cols-[16px_minmax(0,1fr)_28px] px-2 py-1.5 hover:bg-background/80 data-[active=true]:bg-background data-[active=true]:shadow-xs"
              draggable
              onDragStart={() => setDraggedId(template.id)}
              onDragEnd={() => setDraggedId(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedId && draggedId !== template.id) onDropTemplate(draggedId, template.id);
                setDraggedId(undefined);
              }}
            >
              <GripVertical className="size-3.5 cursor-grab text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[900px]:opacity-100" />
              <button
                type="button"
                className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 border-0 bg-transparent p-0 text-left"
                onClick={() => onSelect(template.id)}
              >
                <NotionIcon className={`size-8 ${tone}`}>
                  <Icon className="size-[17px]" />
                </NotionIcon>
                <NotionText
                  title={template.name}
                  description={getKindLabel(template.kind)}
                  titleClassName="text-[13px]"
                  descriptionClassName="text-[11px]"
                />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[900px]:opacity-100"
                    aria-label={m.common_reorder()}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-36 bg-popover" align="end">
                  <DropdownMenuItem disabled={index === 0} onSelect={() => onMoveTemplate(template.id, -1)}>
                    <ArrowUp />
                    {m.common_move_up()}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === items.length - 1}
                    onSelect={() => onMoveTemplate(template.id, 1)}
                  >
                    <ArrowDown />
                    {m.common_move_down()}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </NotionListRow>
          );
        })}
      </NotionList>
    </div>
  );
}

export function ModuleTemplatesView({ selectedTemplateId }: ModuleTemplatesViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: queryKeys.moduleTemplates,
    queryFn: () => apiRequest<{ items: ModuleTemplate[] }>("/api/module-templates"),
  });
  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => apiRequest<{ items: TenantMember[] }>("/api/members"),
  });
  const items = useMemo(() => templates.data?.items ?? [], [templates.data?.items]);
  const fixedItems = useMemo(() => items.filter((template) => template.isSystemFixed), [items]);
  const customItems = useMemo(() => items.filter((template) => !template.isSystemFixed), [items]);
  const orderedItems = useMemo(() => [...fixedItems, ...customItems], [customItems, fixedItems]);
  const selectedTemplate = items.find((template) => template.id === selectedTemplateId) ?? items[0];

  useEffect(() => {
    if (templates.data && selectedTemplate && selectedTemplateId !== selectedTemplate.id) {
      void navigate({
        to: "/settings/new-project/modules/$templateId",
        params: { templateId: selectedTemplate.id },
        replace: true,
      });
    }
  }, [navigate, selectedTemplate, selectedTemplateId, templates.data]);

  const createTemplate = useMutation({
    mutationFn: (payload: { name: string; kind: ModuleKind }) =>
      apiRequest<ModuleTemplate>("/api/module-templates", {
        method: "POST",
        body: { key: slugifyKey(payload.name) || `module-${Date.now()}`, name: payload.name, kind: payload.kind },
      }),
    onMutate() {
      setCreateError(null);
    },
    async onSuccess(template) {
      setCreateError(null);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
      await navigate({ to: "/settings/new-project/modules/$templateId", params: { templateId: template.id } });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.module_create_template_error());
    },
  });
  const updateTemplate = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: TemplateUpdatePayload }) =>
      apiRequest<ModuleTemplate>(`/api/module-templates/${templateId}`, { method: "PATCH", body: payload }),
    onMutate() {
      setUpdateError(null);
    },
    async onSuccess() {
      setUpdateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setUpdateError(error instanceof ApiClientError ? error.message : m.template_update_error());
    },
  });
  const saveField = useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: FieldPayload }) =>
      apiRequest(`/api/module-templates/${templateId}/fields`, { method: "POST", body: payload }),
    onMutate() {
      setFieldError(null);
    },
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
      apiRequest(`/api/module-templates/${templateId}/fields/${fieldId}`, { method: "DELETE" }),
    onMutate() {
      setFieldError(null);
    },
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setFieldError(error instanceof ApiClientError ? error.message : m.field_delete_error());
    },
  });
  const deleteTemplate = useMutation({
    mutationFn: (templateId: string) => apiRequest(`/api/module-templates/${templateId}`, { method: "DELETE" }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
      await navigate({ to: "/settings/new-project", replace: true });
    },
    onError(error) {
      setUpdateError(error instanceof ApiClientError ? error.message : m.template_update_error());
    },
  });
  const reorderTemplates = useMutation({
    mutationFn: (ids: string[]) => apiRequest("/api/module-templates/reorder", { method: "POST", body: { ids } }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setUpdateError(error instanceof ApiClientError ? error.message : m.template_update_error());
    },
  });
  const reorderFields = useMutation({
    mutationFn: ({ templateId, ids }: { templateId: string; ids: string[] }) =>
      apiRequest(`/api/module-templates/${templateId}/fields/reorder`, { method: "POST", body: { ids } }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setFieldError(error instanceof ApiClientError ? error.message : m.field_save_error());
    },
  });
  const resetTemplate = useMutation({
    mutationFn: (templateId: string) => apiRequest(`/api/module-templates/${templateId}/reset`, { method: "POST" }),
    onMutate() {
      setUpdateError(null);
    },
    async onSuccess() {
      setUpdateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.moduleTemplates });
    },
    onError(error) {
      setUpdateError(error instanceof ApiClientError ? error.message : m.template_update_error());
    },
  });

  useEffect(() => {
    setUpdateError(null);
    setFieldError(null);
    updateTemplate.reset();
    saveField.reset();
    deleteField.reset();
  }, [selectedTemplate?.id]);

  function moveTemplate(draggedId: string, targetId: string) {
    const ids = orderedItems.map((item) => item.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    reorderTemplates.mutate(ids);
  }

  function moveTemplateByOffset(templateId: string, sectionItems: ModuleTemplate[], offset: -1 | 1) {
    const index = sectionItems.findIndex((item) => item.id === templateId);
    const target = sectionItems[index + offset];
    if (target) moveTemplate(templateId, target.id);
  }

  return (
    <main className="template-shell">
      <NotionToolbar className="justify-between px-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={m.common_back_home()} onClick={() => void navigate({ to: "/" })}>
            <ArrowLeft />
          </Button>
          <strong className="text-sm font-semibold">{m.module_templates_title()}</strong>
        </div>
        <AccountMenu />
      </NotionToolbar>

      <section className="mx-auto grid w-[min(1120px,calc(100vw-40px))] gap-7 py-8 max-[640px]:w-[calc(100vw-24px)] max-[640px]:gap-5 max-[640px]:py-5">
        <header className="flex items-start justify-between gap-6 max-[640px]:items-center">
          <div className="grid max-w-2xl gap-1.5">
            <h1 className="m-0 text-[28px] leading-tight font-semibold text-foreground max-[560px]:text-2xl">
              {m.module_templates_title()}
            </h1>
            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground max-[640px]:hidden">
              {m.module_templates_description()}
            </p>
          </div>
          <Button
            size="sm"
            className="mt-0.5"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            <Plus />{m.module_new()}
          </Button>
        </header>
        <div className="grid min-h-[600px] grid-cols-[280px_minmax(0,1fr)] items-start gap-10 border-t border-border-subtle pt-6 max-[900px]:grid-cols-1 max-[900px]:gap-6">
          <aside className="grid content-start gap-6 rounded-lg bg-muted/40 p-3 max-[900px]:max-h-80 max-[900px]:overflow-y-auto">
            {templates.isLoading ? <NotionEmpty>{m.module_templates_loading()}</NotionEmpty> : null}
            <TemplateListSection
              title={m.template_fixed_section()}
              items={fixedItems}
              selectedId={selectedTemplate?.id}
              onDropTemplate={moveTemplate}
              onMoveTemplate={(templateId, offset) => moveTemplateByOffset(templateId, fixedItems, offset)}
              onSelect={(templateId) => void navigate({ to: "/settings/new-project/modules/$templateId", params: { templateId } })}
            />
            <TemplateListSection
              title={m.template_custom_section()}
              items={customItems}
              selectedId={selectedTemplate?.id}
              onDropTemplate={moveTemplate}
              onMoveTemplate={(templateId, offset) => moveTemplateByOffset(templateId, customItems, offset)}
              onSelect={(templateId) => void navigate({ to: "/settings/new-project/modules/$templateId", params: { templateId } })}
            />
          </aside>
          <ModuleTemplateEditor
            template={selectedTemplate}
            members={members.data?.items ?? []}
            isUpdating={updateTemplate.isPending}
            updateError={updateError}
            isSavingField={saveField.isPending || deleteField.isPending}
            fieldError={fieldError}
            onUpdate={(templateId, payload) => updateTemplate.mutate({ templateId, payload })}
            onSaveField={async (templateId, payload) => {
              await saveField.mutateAsync({ templateId, payload });
            }}
            onDeleteField={(templateId, fieldId) => deleteField.mutate({ templateId, fieldId })}
            onDeleteTemplate={(templateId) => deleteTemplate.mutate(templateId)}
            onResetTemplate={(templateId) => resetTemplate.mutate(templateId)}
            onReorderFields={(templateId, ids) => reorderFields.mutate({ templateId, ids })}
            onBeginUpdate={() => {
              setUpdateError(null);
              updateTemplate.reset();
            }}
            onBeginFieldEdit={() => {
              setFieldError(null);
              saveField.reset();
              deleteField.reset();
            }}
          />
        </div>
      </section>
      <CreateModuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        error={createError}
        isPending={createTemplate.isPending}
        onCreate={(name, kind) => createTemplate.mutate({ name, kind })}
      />
    </main>
  );
}

function CreateModuleDialog({
  open,
  onOpenChange,
  error,
  isPending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  isPending: boolean;
  onCreate: (name: string, kind: ModuleKind) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ModuleKind>("timeline");
  useEffect(() => {
    if (!open) {
      setName("");
      setKind("timeline");
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{m.module_new()}</DialogTitle>
          <DialogDescription>{m.module_settings_scope()}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {m.template_name_label()}
            <Input value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {m.module_type_aria()}
            <Select value={kind} onValueChange={(value) => setKind(value as ModuleKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {moduleKinds.map((option) => <SelectItem key={option} value={option}>{getKindLabel(option)}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={isPending} onClick={() => onOpenChange(false)}>{m.common_cancel()}</Button>
          <Button disabled={!name.trim() || isPending} onClick={() => onCreate(name.trim(), kind)}>{m.module_new()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
