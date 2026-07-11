// 编辑初始模块动态字段，保持字段类型、默认值和选项在同一类型化表单中。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Checkbox } from "@sharebrain/ui/components/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@sharebrain/ui/components/collapsible";
import { Field, FieldLabel } from "@sharebrain/ui/components/field";
import { Input } from "@sharebrain/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sharebrain/ui/components/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@sharebrain/ui/components/sheet";
import { useForm } from "@tanstack/react-form";
import { Check, ChevronDown, ListPlus, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { DynamicFieldControl, formatModuleFieldValue } from "../dynamic-fields/dynamic-field-control";
import { getFieldTypeLabel, moduleFieldTypes, slugifyKey } from "./module-template-utils";

import type {
  FieldDefaultKind,
  ModuleFieldOption,
  ModuleFieldType,
  ModuleTemplateField,
  TenantMember,
} from "@sharebrain/contracts";
import type { FieldPayload } from "./module-template-editor.types";

type FieldEditorSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: ModuleTemplateField | undefined;
  members: TenantMember[];
  isSaving: boolean;
  error: string | null;
  onEdit: () => void;
  onSave: (payload: FieldPayload) => Promise<void>;
};

export function FieldEditorSheet({
  open,
  onOpenChange,
  field,
  members,
  isSaving,
  error,
  onEdit,
  onSave,
}: FieldEditorSheetProps) {
  const form = useForm({
    defaultValues: toFieldDraft(field),
    onSubmit: async ({ value }) => {
      try {
        await onSave({
          ...(field ? { id: field.id } : {}),
          key: slugifyKey(value.key) || slugifyKey(value.label) || `field-${Date.now()}`,
          label: value.label.trim() || m.field_untitled(),
          type: value.type,
          required: value.required,
          defaultKind: value.defaultKind,
          defaultValue: value.defaultKind === "literal" ? value.defaultValue : undefined,
          options: value.type === "select" ? value.options.filter((option) => option.label.trim()) : [],
        });
        onOpenChange(false);
      } catch {
        return;
      }
    },
  });

  useEffect(() => {
    form.reset(toFieldDraft(field));
  }, [field?.id, form, open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSaving) return;
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="w-full sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>{field ? m.field_edit_title() : m.field_create_title()}</SheetTitle>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-5">
            <form.Field name="label">
              {(formField) => (
                <Field>
                  <FieldLabel htmlFor={formField.name}>{m.field_label_label()}</FieldLabel>
                  <Input
                    id={formField.name}
                    value={formField.state.value}
                    onChange={(event) => {
                      onEdit();
                      formField.handleChange(event.target.value);
                    }}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="type">
              {(formField) => (
                <Field>
                  <FieldLabel>{m.field_type_label()}</FieldLabel>
                  <Select
                    value={formField.state.value}
                    onValueChange={(value) => {
                      onEdit();
                      formField.handleChange(value as ModuleFieldType);
                      form.setFieldValue("defaultKind", "none");
                      form.setFieldValue("defaultValue", null);
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {moduleFieldTypes.map((type) => (
                        <SelectItem key={type} value={type}>{getFieldTypeLabel(type)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="required">
              {(formField) => (
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <Checkbox
                    checked={formField.state.value}
                    onCheckedChange={(checked) => {
                      onEdit();
                      formField.handleChange(checked === true);
                    }}
                  />
                  {m.field_required()}
                </label>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.type}>
              {(type) => (
                <form.Field name="defaultKind">
                  {(formField) => (
                    <Field>
                      <FieldLabel>{m.field_default_kind_label()}</FieldLabel>
                      <Select
                        value={formField.state.value}
                        onValueChange={(value) => {
                          const defaultKind = value as FieldDefaultKind;
                          onEdit();
                          formField.handleChange(defaultKind);
                          form.setFieldValue(
                            "defaultValue",
                            defaultKind === "literal" && type === "boolean" ? false : null,
                          );
                        }}
                      >
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {getDefaultKinds(type).map((kind) => (
                            <SelectItem key={kind} value={kind}>{getDefaultKindLabel(kind)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
              )}
            </form.Subscribe>
            <form.Subscribe selector={(state) => [state.values.type, state.values.defaultKind, state.values.options] as const}>
              {([type, defaultKind, options]) => defaultKind === "literal" ? (
                <form.Field name="defaultValue">
                  {(formField) => (
                    <Field>
                      <FieldLabel>{m.field_default_value_label()}</FieldLabel>
                      <DynamicFieldControl
                        type={type}
                        options={options}
                        members={members}
                        value={formField.state.value}
                        onValueChange={(value) => {
                          onEdit();
                          formField.handleChange(value);
                        }}
                        ariaLabel={m.field_default_value_label()}
                      />
                    </Field>
                  )}
                </form.Field>
              ) : null}
            </form.Subscribe>
            <form.Subscribe selector={(state) => state.values.type}>
              {(type) => type === "select" ? (
                <form.Field name="options" mode="array">
                  {(optionsField) => (
                    <Field>
                      <FieldLabel>{m.field_options_label()}</FieldLabel>
                      <div className="grid gap-2">
                        {optionsField.state.value.map((option, index) => (
                          <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-2" key={option.id}>
                            <form.Field name={`options[${index}].label`}>
                              {(optionField) => (
                                <Input
                                  value={optionField.state.value}
                                  onChange={(event) => {
                                    onEdit();
                                    optionField.handleChange(event.target.value);
                                  }}
                                />
                              )}
                            </form.Field>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={m.common_delete_named({ name: option.label || String(index + 1) })}
                              onClick={() => {
                                onEdit();
                                if (form.state.values.defaultValue === option.id) {
                                  form.setFieldValue("defaultValue", null);
                                }
                                optionsField.removeValue(index);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-fit"
                          onClick={() => {
                            onEdit();
                            optionsField.pushValue({ id: `option-${crypto.randomUUID()}`, label: "", color: "gray" });
                          }}
                        >
                          <ListPlus />
                          {m.field_option_add()}
                        </Button>
                      </div>
                    </Field>
                  )}
                </form.Field>
              ) : null}
            </form.Subscribe>
            <Collapsible>
              <CollapsibleTrigger className="flex min-h-8 items-center gap-2 border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-4" />
                {m.template_advanced()}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <form.Field name="key">
                  {(formField) => (
                    <Field>
                      <FieldLabel htmlFor={formField.name}>{m.field_key_label()}</FieldLabel>
                      <Input
                        id={formField.name}
                        value={formField.state.value}
                        onChange={(event) => {
                          onEdit();
                          formField.handleChange(event.target.value);
                        }}
                      />
                    </Field>
                  )}
                </form.Field>
              </CollapsibleContent>
            </Collapsible>
            {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border px-5 py-4">
            <Button type="button" variant="ghost" disabled={isSaving} onClick={() => onOpenChange(false)}>
              {m.common_cancel()}
            </Button>
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <Button type="submit" disabled={isSaving || !canSaveField(values)}>
                  <Check />
                  {m.common_save()}
                </Button>
              )}
            </form.Subscribe>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type FieldDraft = {
  label: string;
  key: string;
  type: ModuleFieldType;
  required: boolean;
  defaultKind: FieldDefaultKind;
  defaultValue: unknown;
  options: ModuleFieldOption[];
};

function toFieldDraft(field?: ModuleTemplateField): FieldDraft {
  return {
    label: field?.label ?? "",
    key: field?.key ?? "",
    type: field?.type ?? "text",
    required: field?.required ?? false,
    defaultKind: field?.defaultKind ?? "none",
    defaultValue: field?.defaultValue ?? null,
    options: field?.options.map((option) => ({ ...option })) ?? [],
  };
}

function getDefaultKinds(type: ModuleFieldType): FieldDefaultKind[] {
  if (type === "datetime") return ["none", "literal", "now"];
  if (type === "date") return ["none", "literal", "today"];
  if (type === "user") return ["none", "literal", "current_user"];
  return ["none", "literal"];
}

function getDefaultKindLabel(kind: FieldDefaultKind) {
  const labels = {
    none: m.field_default_none(),
    literal: m.field_default_literal(),
    now: m.field_default_now(),
    today: m.field_default_today(),
    current_user: m.field_default_current_user(),
  };
  return labels[kind];
}

export function getDefaultSummary(field: ModuleTemplateField) {
  if (field.defaultKind === "none") return "";
  if (field.defaultKind !== "literal") return getDefaultKindLabel(field.defaultKind);
  return formatModuleFieldValue(field, field.defaultValue);
}

function canSaveField(value: FieldDraft) {
  if (!value.label.trim()) return false;
  if (value.type === "select" && !value.options.some((option) => option.label.trim())) return false;
  if (value.defaultKind !== "literal") return true;
  if (value.type === "boolean") return typeof value.defaultValue === "boolean";
  if (value.type === "number") return typeof value.defaultValue === "number" && Number.isFinite(value.defaultValue);
  if (value.type === "select") {
    return value.options.some(
      (option) => option.id === value.defaultValue && option.label.trim().length > 0,
    );
  }
  return typeof value.defaultValue === "string" && value.defaultValue.trim().length > 0;
}
