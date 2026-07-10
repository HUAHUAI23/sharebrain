import { Button } from "@sharebrain/ui/components/button";
import { Checkbox } from "@sharebrain/ui/components/checkbox";
import { Input } from "@sharebrain/ui/components/input";
import {
  NotionEmpty,
  NotionIcon,
  NotionList,
  NotionListRow,
  NotionSegmentedButton,
  NotionSegmentedControl,
  NotionText,
} from "@sharebrain/ui/components/notion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sharebrain/ui/components/select";
import { Textarea } from "@sharebrain/ui/components/textarea";
import { m } from "@sharebrain/i18n";
import { Check, FilePenLine, ListPlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ModuleFieldValueInput } from "../../components/module-field-value-input";
import { getFieldTypeLabel, getKindLabel, moduleFieldTypes, moduleKinds, slugifyKey } from "./module-template-utils";

import type { ModuleFieldType, ModuleKind, ModuleTemplate, ModuleTemplateField } from "@sharebrain/contracts";

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

type DraftOption = { id: string; label: string; color?: string | undefined };

type ModuleTemplateEditorProps = {
  template: ModuleTemplate | undefined;
  isUpdating: boolean;
  updateError: string | null | undefined;
  isSavingField: boolean;
  fieldError: string | null | undefined;
  onUpdate: (templateId: string, payload: TemplateUpdatePayload) => void;
  onSaveField: (templateId: string, payload: FieldPayload) => void;
  onDeleteField: (templateId: string, fieldId: string) => void;
};

function TemplateIdentityForm({
  template,
  isUpdating,
  updateError,
  onUpdate,
}: Pick<ModuleTemplateEditorProps, "template" | "isUpdating" | "updateError" | "onUpdate">) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<ModuleKind>("timeline");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");

  useEffect(() => {
    setName(template?.name ?? "");
    setKey(template?.key ?? "");
    setKind(template?.kind ?? "timeline");
    setDescription(template?.description ?? "");
    setIcon(template?.icon ?? "");
  }, [template]);

  if (!template) {
    return null;
  }

  const identityLocked = template.isSystemFixed;

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onUpdate(template.id, {
          name: name.trim() || m.template_untitled(),
          description: description.trim(),
          icon: icon.trim(),
          ...(identityLocked ? {} : { key: slugifyKey(key) || slugifyKey(name) || `module-${Date.now()}` }),
        });
      }}
    >
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="template-name">
          {m.template_name_label()}
        </label>
        <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3 max-[640px]:grid-cols-1">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="template-key">
            {m.module_key_aria()}
          </label>
          <Input id="template-key" value={key} disabled={identityLocked} onChange={(event) => setKey(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="template-icon">
            {m.template_icon_label()}
          </label>
          <Input id="template-icon" value={icon} onChange={(event) => setIcon(event.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{m.module_type_aria()}</span>
        <NotionSegmentedControl role="group" aria-label={m.module_type_aria()}>
          {moduleKinds.map((option) => (
            <NotionSegmentedButton key={option} type="button" active={kind === option} disabled>
              {getKindLabel(option)}
            </NotionSegmentedButton>
          ))}
        </NotionSegmentedControl>
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="template-description">
          {m.template_description_label()}
        </label>
        <Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">{identityLocked ? m.template_fixed_note() : m.template_kind_locked_note()}</p>
      {updateError ? <p className="text-xs text-destructive">{updateError}</p> : null}
      <div>
        <Button type="submit" size="sm" disabled={isUpdating}>
          <Check size={14} />
          {m.common_save()}
        </Button>
      </div>
    </form>
  );
}

function FieldEditor({
  template,
  isSavingField,
  fieldError,
  onSaveField,
  onDeleteField,
}: Pick<ModuleTemplateEditorProps, "template" | "isSavingField" | "fieldError" | "onSaveField" | "onDeleteField">) {
  const [editingField, setEditingField] = useState<ModuleTemplateField | null>(null);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState<ModuleFieldType>("text");
  const [required, setRequired] = useState(false);
  const [defaultPolicy, setDefaultPolicy] = useState<"empty" | "fixed">("empty");
  const [defaultValue, setDefaultValue] = useState<unknown>(undefined);
  const [options, setOptions] = useState<DraftOption[]>([]);

  useEffect(() => {
    setEditingField(null);
    setLabel("");
    setKey("");
    setType("text");
    setRequired(false);
    setDefaultPolicy("empty");
    setDefaultValue(undefined);
    setOptions([]);
  }, [template?.id]);

  useEffect(() => {
    if (!editingField) {
      return;
    }
    if (template?.fields.some((field) => field.id === editingField.id)) {
      return;
    }
    setEditingField(null);
    setLabel("");
    setKey("");
    setType("text");
    setRequired(false);
    setDefaultPolicy("empty");
    setDefaultValue(undefined);
    setOptions([]);
  }, [editingField, template?.fields]);

  function loadField(field: ModuleTemplateField) {
    setEditingField(field);
    setLabel(field.label);
    setKey(field.key);
    setType(field.type);
    setRequired(field.required);
    setDefaultPolicy(field.defaultPolicy);
    setDefaultValue(field.defaultValue ?? undefined);
    setOptions(field.options);
  }

  function clearFieldForm() {
    setEditingField(null);
    setLabel("");
    setKey("");
    setType("text");
    setRequired(false);
    setDefaultPolicy("empty");
    setDefaultValue(undefined);
    setOptions([]);
  }

  function updateOption(index: number, option: { id?: string; label?: string; color?: string | undefined }) {
    setOptions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...option } : item)),
    );
  }

  function removeOption(index: number) {
    setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  if (!template) {
    return null;
  }

  if (template.kind !== "timeline") {
    return <NotionEmpty className="px-0 py-2">{m.template_collection_fields_note()}</NotionEmpty>;
  }

  return (
    <div className="grid gap-4">
      <NotionList>
        {template.fields.length > 0 ? (
          template.fields.map((field) => (
            <NotionListRow
              asChild
              key={field.id}
              active={editingField?.id === field.id}
              className="grid-cols-[24px_minmax(0,1fr)_auto_30px] px-1.5 py-1.5"
            >
              <div>
                <button className="contents" type="button" onClick={() => loadField(field)}>
                  <NotionIcon>
                    <FilePenLine size={14} />
                  </NotionIcon>
                  <NotionText title={field.label} description={`${field.key} · ${getFieldTypeLabel(field.type)}`} />
                  <span className="text-xs text-muted-foreground">{field.required ? m.field_required() : m.field_optional()}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={m.common_delete_named({ name: field.label })}
                  disabled={isSavingField}
                  onClick={() => onDeleteField(template.id, field.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </NotionListRow>
          ))
        ) : (
          <NotionEmpty>{m.template_no_fields()}</NotionEmpty>
        )}
      </NotionList>

      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedOptions = options.map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.color ? { color: option.color } : {}),
          }));
          onSaveField(template.id, {
            ...(editingField ? { id: editingField.id } : {}),
            key: slugifyKey(key) || slugifyKey(label) || `field-${Date.now()}`,
            label: label.trim() || m.field_untitled(),
            type,
            required,
            defaultPolicy,
            defaultValue: defaultPolicy === "fixed" ? defaultValue : undefined,
            options: type === "select" ? normalizedOptions : [],
          });
        }}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListPlus size={14} />
          <span>{editingField ? m.field_edit_title() : m.field_create_title()}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="field-label">
              {m.field_label_label()}
            </label>
            <Input id="field-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="field-key">
              {m.field_key_label()}
            </label>
            <Input id="field-key" value={key} onChange={(event) => setKey(event.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 max-[640px]:grid-cols-1">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="field-type">
              {m.field_type_label()}
            </label>
            <Select
              value={type}
              onValueChange={(value) => {
                setType(value as ModuleFieldType);
                setDefaultValue(undefined);
              }}
            >
              <SelectTrigger id="field-type" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {moduleFieldTypes.map((option) => (
                  <SelectItem key={option} value={option}>
                    {getFieldTypeLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="field-default-policy">
              {m.field_default_policy_label()}
            </label>
            <Select value={defaultPolicy} onValueChange={(value) => setDefaultPolicy(value as "empty" | "fixed")}>
              <SelectTrigger id="field-default-policy" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="empty">{m.field_default_empty()}</SelectItem>
                <SelectItem value="fixed">{m.field_default_fixed()}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} />
            {m.field_required()}
          </label>
        </div>
        {defaultPolicy === "fixed" ? (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="field-default-value">
              {m.field_default_value_label()}
            </label>
            <ModuleFieldValueInput
              id="field-default-value"
              type={type}
              options={options}
              value={defaultValue}
              onValueChange={setDefaultValue}
              ariaLabel={m.field_default_value_label()}
            />
          </div>
        ) : null}
        {type === "select" ? (
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{m.field_options_label()}</span>
            <div className="grid gap-1">
              {options.map((option, index) => (
                <div
                  className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_84px_30px] gap-2 max-[720px]:grid-cols-1"
                  key={`${option.id}-${index}`}
                >
                  <Input
                    aria-label={m.field_option_id_label()}
                    value={option.id}
                    placeholder="todo"
                    onChange={(event) => updateOption(index, { id: event.target.value })}
                  />
                  <Input
                    aria-label={m.field_option_label_label()}
                    value={option.label}
                    placeholder={m.field_option_label_placeholder()}
                    onChange={(event) => updateOption(index, { label: event.target.value })}
                  />
                  <Input
                    aria-label={m.field_option_color_label()}
                    value={option.color ?? ""}
                    placeholder="gray"
                    onChange={(event) => updateOption(index, { color: event.target.value || undefined })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={m.common_delete_named({ name: option.label || option.id })}
                    onClick={() => removeOption(index)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() =>
                setOptions((current) => [
                  ...current,
                  { id: `option-${current.length + 1}`, label: m.field_option_label_placeholder() },
                ])
              }
            >
              <Plus size={14} />
              {m.field_option_add()}
            </Button>
          </div>
        ) : null}
        {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isSavingField}>
            <Check size={14} />
            {m.common_save()}
          </Button>
          {editingField ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFieldForm}>
              {m.field_new_button()}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export function ModuleTemplateEditor({
  template,
  isUpdating,
  updateError,
  isSavingField,
  fieldError,
  onUpdate,
  onSaveField,
  onDeleteField,
}: ModuleTemplateEditorProps) {
  const title = useMemo(() => template?.name ?? m.module_templates_title(), [template]);

  if (!template) {
    return <NotionEmpty className="p-8">{m.template_select_empty()}</NotionEmpty>;
  }

  return (
    <section className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-semibold tracking-normal">{title}</h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          {template.isSystemFixed ? m.template_fixed_badge() : m.template_custom_badge()} · {getKindLabel(template.kind)}
        </p>
      </div>
      <TemplateIdentityForm template={template} isUpdating={isUpdating} updateError={updateError} onUpdate={onUpdate} />
      <div className="grid gap-3">
        <div className="grid gap-px">
          <h3 className="m-0 text-sm font-semibold tracking-normal">{m.template_fields_title()}</h3>
          <p className="m-0 text-xs text-muted-foreground">{m.template_fields_description()}</p>
        </div>
        <FieldEditor
          template={template}
          isSavingField={isSavingField}
          fieldError={fieldError}
          onSaveField={onSaveField}
          onDeleteField={onDeleteField}
        />
      </div>
    </section>
  );
}
