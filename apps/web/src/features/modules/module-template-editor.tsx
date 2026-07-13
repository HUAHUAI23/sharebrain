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
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  GripVertical,
  Hash,
  Link2,
  ListFilter,
  Plus,
  RotateCcw,
  TextCursorInput,
  ToggleLeft,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";

import { FieldEditorSheet, getDefaultSummary } from "./field-editor-sheet";
import { getFieldTypeLabel, getKindLabel } from "./module-template-utils";
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
  if (type === "datetime") return <Clock3 />;
  if (type === "boolean") return <ToggleLeft />;
  if (type === "url") return <Link2 />;
  if (type === "select") return <ListFilter />;
  if (type === "user") return <UserRound />;
  if (type === "text") return <TextCursorInput />;
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

  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-4 pb-2">
        <div className="grid min-w-0 gap-1">
          <div className="flex items-center gap-2">
            <h2 className="m-0 truncate text-lg font-semibold tracking-normal">{template.name}</h2>
            {template.isSystemFixed ? (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {m.template_fixed_badge()}
              </span>
            ) : null}
          </div>
          <p className="m-0 text-sm text-muted-foreground">{getKindLabel(template.kind)}</p>
        </div>
        {template.isSystemFixed ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
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
              <Button variant="ghost" size="icon" aria-label={m.common_delete_named({ name: template.name })}>
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
      </div>

      <TemplateIdentityForm
        key={template.id}
        template={template}
        isUpdating={isUpdating}
        error={updateError}
        onEdit={onBeginUpdate}
        onUpdate={onUpdate}
      />

      {template.kind === "timeline" ? (
        <section className="grid gap-3 pt-4 pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-px">
              <h3 className="m-0 text-sm font-semibold">{m.template_fields_title()}</h3>
              <p className="m-0 text-xs text-muted-foreground">{m.template_fields_description()}</p>
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
            <NotionList className="divide-y divide-border-subtle">
              {template.fields.map((field, index) => {
                const defaultSummary = getDefaultSummary(field);
                return (
                  <NotionListRow
                    key={field.id}
                    className="group grid-cols-[20px_minmax(0,1fr)_96px] rounded-none px-1 py-1.5 hover:bg-accent"
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
                    <GripVertical className="size-4 cursor-grab text-muted-foreground/35 transition-colors group-hover:text-muted-foreground/60" />
                    <button
                      type="button"
                      className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent p-0 text-left"
                      onClick={() => {
                        onBeginFieldEdit();
                        setEditingField(field);
                        setFieldSheetOpen(true);
                      }}
                    >
                      <NotionIcon className="bg-transparent text-muted-foreground">
                        {fieldIcon(field.type)}
                      </NotionIcon>
                      <NotionText
                        title={field.label}
                        description={`${getFieldTypeLabel(field.type)}${defaultSummary ? ` · ${defaultSummary}` : ""}`}
                      />
                    </button>
                    <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[800px]:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
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
                          size="icon"
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
                              size="icon"
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
            <NotionEmpty className="py-8">{m.template_no_fields()}</NotionEmpty>
          )}
        </section>
      ) : (
        <NotionEmpty className="border-t border-border py-10">{m.template_collection_fields_note()}</NotionEmpty>
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
