// 编辑单个初始模块的身份信息、启用状态与时间线字段。
import { m } from "@sharebrain/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@sharebrain/ui/components/alert-dialog";
import { Button } from "@sharebrain/ui/components/button";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow, NotionText } from "@sharebrain/ui/components/notion";
import {
  Braces,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Hash,
  Link2,
  ListChecks,
  Plus,
  RotateCcw,
  SquareCheckBig,
  Trash2,
  Type,
  UserRound,
} from "lucide-react";
import { useState } from "react";

import { FieldEditorSheet, getDefaultSummary } from "./field-editor-sheet";
import { getFieldTypeLabel, getKindLabel } from "./module-template-utils";
import { getModuleTemplateVisual } from "./module-template-visual";
import { TemplateIdentityForm } from "./template-identity-form";

import type { ModuleFieldType, ModuleTemplate, ModuleTemplateField, TenantMember } from "@sharebrain/contracts";
import type { FieldPayload, TemplateUpdatePayload } from "./module-template-editor.types";

type ModuleTemplateEditorProps = {
  template: ModuleTemplate | undefined;
  members: TenantMember[];
  isUpdating: boolean;
  updateError: string | null;
  isSavingField: boolean;
  fieldError: string | null;
  onUpdate: (templateId: string, payload: TemplateUpdatePayload) => void;
  onSaveField: (templateId: string, payload: FieldPayload) => Promise<void>;
  onDeleteField: (templateId: string, fieldId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onResetTemplate: (templateId: string) => void;
  onReorderFields: (templateId: string, ids: string[]) => void;
  onBeginUpdate: () => void;
  onBeginFieldEdit: () => void;
};

function fieldIcon(type: ModuleFieldType) {
  if (type === "number") return <Hash />;
  if (type === "date") return <CalendarDays />;
  if (type === "datetime") return <CalendarClock />;
  if (type === "boolean") return <SquareCheckBig />;
  if (type === "url") return <Link2 />;
  if (type === "select") return <ListChecks />;
  if (type === "user") return <UserRound />;
  if (type === "text") return <Type />;
  return <Braces />;
}

export function ModuleTemplateEditor({
  template,
  members,
  isUpdating,
  updateError,
  isSavingField,
  fieldError,
  onUpdate,
  onSaveField,
  onDeleteField,
  onDeleteTemplate,
  onResetTemplate,
  onReorderFields,
  onBeginUpdate,
  onBeginFieldEdit,
}: ModuleTemplateEditorProps) {
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  const [editingField, setEditingField] = useState<ModuleTemplateField>();
  const [draggedFieldId, setDraggedFieldId] = useState<string>();

  if (!template) return <NotionEmpty className="p-12">{m.template_select_empty()}</NotionEmpty>;
  const { Icon: TemplateIcon, tone } = getModuleTemplateVisual(template);

  return (
    <section className="min-w-0 max-w-[760px] pb-16">
      <header className="flex items-center justify-between gap-5 pb-6">
        <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5">
          <span className={`flex size-11 items-center justify-center rounded-lg ${tone}`}>
            <TemplateIcon className="size-5" />
          </span>
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="m-0 truncate text-xl leading-tight font-semibold tracking-normal">{template.name}</h2>
              {template.isSystemFixed ? (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {m.template_fixed_badge()}
                </span>
              ) : null}
            </div>
            <p className="m-0 text-xs text-muted-foreground">{getKindLabel(template.kind)}</p>
          </div>
        </div>
        {template.isSystemFixed ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <RotateCcw />
                {m.template_restore()}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>{m.template_restore_title()}</AlertDialogTitle>
                <AlertDialogDescription>{m.template_restore_description()}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onResetTemplate(template.id)}>{m.template_restore()}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="text-muted-foreground hover:text-destructive"
                variant="ghost"
                size="icon-sm"
                aria-label={m.common_delete_named({ name: template.name })}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>{m.template_delete_title()}</AlertDialogTitle>
                <AlertDialogDescription>{m.template_delete_description()}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => onDeleteTemplate(template.id)}>
                  {m.common_delete_named({ name: template.name })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <TemplateIdentityForm
        key={template.id}
        template={template}
        isUpdating={isUpdating}
        error={updateError}
        onEdit={onBeginUpdate}
        onUpdate={onUpdate}
      />

      {template.kind === "timeline" ? (
        <section className="grid gap-4 border-t border-border-subtle pt-6 pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <h3 className="m-0 text-[15px] font-semibold">{m.template_fields_title()}</h3>
              <p className="m-0 text-[12px] leading-relaxed text-muted-foreground">{m.template_fields_description()}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onBeginFieldEdit();
                setEditingField(undefined);
                setFieldSheetOpen(true);
              }}
            >
              <Plus />
              {m.field_create_title()}
            </Button>
          </div>
          {template.fields.length ? (
            <NotionList className="gap-0 overflow-hidden rounded-lg border border-border-subtle bg-background divide-y divide-border-subtle">
              {template.fields.map((field, index) => {
                const defaultSummary = getDefaultSummary(field);
                return (
                  <NotionListRow
                    key={field.id}
                    className="group min-h-14 grid-cols-[18px_minmax(0,1fr)_82px] rounded-none px-3 py-1.5 hover:bg-accent"
                    draggable
                    onDragStart={() => setDraggedFieldId(field.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!draggedFieldId || draggedFieldId === field.id) return;
                      const ids = template.fields.map((item) => item.id);
                      const from = ids.indexOf(draggedFieldId);
                      const to = ids.indexOf(field.id);
                      ids.splice(to, 0, ids.splice(from, 1)[0]!);
                      onReorderFields(template.id, ids);
                      setDraggedFieldId(undefined);
                    }}
                  >
                    <GripVertical className="size-3.5 cursor-grab text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[900px]:opacity-100" />
                    <button
                      type="button"
                      className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 border-0 bg-transparent p-0 text-left"
                      onClick={() => {
                        onBeginFieldEdit();
                        setEditingField(field);
                        setFieldSheetOpen(true);
                      }}
                    >
                      <NotionIcon className="size-8 bg-muted/60 text-muted-foreground">
                        {fieldIcon(field.type)}
                      </NotionIcon>
                      <NotionText
                        title={field.label}
                        description={`${getFieldTypeLabel(field.type)}${defaultSummary ? ` · ${defaultSummary}` : ""}`}
                      />
                    </button>
                    <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[900px]:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={m.common_move_up()}
                          disabled={isSavingField || index === 0}
                          onClick={() => {
                            const ids = template.fields.map((item) => item.id);
                            [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                            onReorderFields(template.id, ids);
                          }}
                        >
                          <ChevronUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={m.common_move_down()}
                          disabled={isSavingField || index === template.fields.length - 1}
                          onClick={() => {
                            const ids = template.fields.map((item) => item.id);
                            [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                            onReorderFields(template.id, ids);
                          }}
                        >
                          <ChevronDown />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={m.common_delete_named({ name: field.label })}
                              disabled={isSavingField}
                            >
                              <Trash2 />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>{m.field_delete_title()}</AlertDialogTitle>
                              <AlertDialogDescription>{m.field_delete_description({ name: field.label })}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => onDeleteField(template.id, field.id)}
                              >
                                {m.common_delete_named({ name: field.label })}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                    </div>
                  </NotionListRow>
                );
              })}
            </NotionList>
          ) : (
            <NotionEmpty className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-border-subtle bg-muted/20 text-sm">
              {m.template_no_fields()}
            </NotionEmpty>
          )}
        </section>
      ) : (
        <NotionEmpty className="border-t border-border-subtle py-10 text-sm">{m.template_collection_fields_note()}</NotionEmpty>
      )}

      <FieldEditorSheet
        open={fieldSheetOpen}
        onOpenChange={setFieldSheetOpen}
        field={editingField}
        members={members}
        isSaving={isSavingField}
        error={fieldError}
        onEdit={onBeginFieldEdit}
        onSave={(payload) => onSaveField(template.id, payload)}
      />
    </section>
  );
}
