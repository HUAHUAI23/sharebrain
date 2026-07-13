// 编辑初始模块身份和启用状态，所有字段使用同一次显式保存。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@sharebrain/ui/components/field";
import { Input } from "@sharebrain/ui/components/input";
import { Switch } from "@sharebrain/ui/components/switch";
import { Textarea } from "@sharebrain/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { Check } from "lucide-react";
import { useEffect } from "react";

import type { ModuleTemplate } from "@sharebrain/contracts";
import type { TemplateUpdatePayload } from "./module-template-editor.types";

type TemplateIdentityFormProps = {
  template: ModuleTemplate;
  isUpdating: boolean;
  error: string | null;
  onEdit: () => void;
  onUpdate: (templateId: string, payload: TemplateUpdatePayload) => void;
};

export function TemplateIdentityForm({
  template,
  isUpdating,
  error,
  onEdit,
  onUpdate,
}: TemplateIdentityFormProps) {
  const form = useForm({
    defaultValues: toIdentityDraft(template),
    onSubmit: ({ value }) => {
      onUpdate(template.id, {
        name: value.name.trim(),
        description: value.description.trim(),
        includedInNewProjects: value.includedInNewProjects,
      });
    },
  });

  useEffect(() => {
    form.reset(toIdentityDraft(template));
  }, [
    form,
    template.description,
    template.includedInNewProjects,
    template.name,
  ]);

  return (
    <form
      className="grid max-w-3xl gap-5 py-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="name"
          validators={{ onChange: ({ value }) => (!value.trim() ? m.template_name_label() : undefined) }}
        >
          {(field) => (
            <Field data-invalid={!field.state.meta.isValid}>
              <FieldLabel htmlFor={field.name}>{m.template_name_label()}</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  onEdit();
                  field.handleChange(event.target.value);
                }}
              />
              {!field.state.meta.isValid ? (
                <p className="m-0 text-xs text-destructive">{String(field.state.meta.errors[0] ?? "")}</p>
              ) : null}
            </Field>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{m.template_description_label()}</FieldLabel>
              <Textarea
                id={field.name}
                className="min-h-20"
                value={field.state.value}
                onChange={(event) => {
                  onEdit();
                  field.handleChange(event.target.value);
                }}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="includedInNewProjects">
          {(field) => (
            <div className="flex items-center justify-between gap-4 rounded-sm bg-muted/50 px-3 py-2.5">
              <div className="grid gap-px">
                <span className="text-sm font-medium">{m.module_included()}</span>
                <span className="text-xs text-muted-foreground">{m.module_settings_scope()}</span>
              </div>
              <Switch
                checked={field.state.value}
                disabled={template.isSystemFixed || isUpdating}
                onCheckedChange={(checked) => {
                  onEdit();
                  field.handleChange(checked);
                }}
              />
            </div>
          )}
        </form.Field>
      </FieldGroup>
      {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isDirty]}>
        {([canSubmit, isDirty]) => (
          <Button className="ml-auto w-fit" size="sm" type="submit" disabled={!canSubmit || !isDirty || isUpdating}>
            <Check />
            {m.common_save()}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function toIdentityDraft(template: ModuleTemplate) {
  return {
    name: template.name,
    description: template.description ?? "",
    includedInNewProjects: template.includedInNewProjects,
  };
}
