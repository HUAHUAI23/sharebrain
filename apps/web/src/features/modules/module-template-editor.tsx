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
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { FieldEditorSheet, getDefaultSummary } from "./field-editor-sheet";
import { getFieldTypeLabel, getKindLabel } from "./module-template-utils";
import { TemplateIdentityForm } from "./template-identity-form";

import type { ModuleTemplate, ModuleTemplateField, TenantMember } from "@sharebrain/contracts";
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
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="grid min-w-0 gap-1">
          <div className="flex items-center gap-2">
            <h2 className="m-0 truncate text-xl font-semibold tracking-normal">{template.name}</h2>
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
        <section className="grid gap-3 border-t border-border py-6">
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
            <NotionList className="divide-y divide-border border-y border-border">
              {template.fields.map((field, index) => {
                const defaultSummary = getDefaultSummary(field);
                return (
                  <NotionListRow
                    asChild
                    key={field.id}
                    className="grid-cols-[20px_28px_minmax(0,1fr)_96px] rounded-none px-1 py-2"
                  >
                    <div
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
                      <GripVertical className="size-4 text-muted-foreground/60" />
                      <button
                        type="button"
                        className="contents"
                        onClick={() => {
                          onBeginFieldEdit();
                          setEditingField(field);
                          setFieldSheetOpen(true);
                        }}
                      >
                        <NotionIcon><Braces /></NotionIcon>
                        <NotionText
                          title={field.label}
                          description={`${getFieldTypeLabel(field.type)}${defaultSummary ? ` · ${defaultSummary}` : ""}`}
                        />
                      </button>
                      <div className="flex items-center justify-end">
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
