import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Field, FieldLabel } from "@sharebrain/ui/components/field";
import { Input } from "@sharebrain/ui/components/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@sharebrain/ui/components/sheet";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { DynamicFieldControl } from "../dynamic-fields/dynamic-field-control";
import { createInitialFieldValues, isEmptyFieldValue } from "../dynamic-fields/field-defaults";

import type { MeResponse, ModuleField, ModuleRecord, TenantMember } from "@sharebrain/contracts";

type RecordComposerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  moduleId: string;
  fields: ModuleField[];
};

export function RecordComposerSheet({ open, onOpenChange, projectId, moduleId, fields }: RecordComposerSheetProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => apiRequest<MeResponse>("/api/me") });
  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => apiRequest<{ items: TenantMember[] }>("/api/members"),
    enabled: fields.some((field) => field.type === "user"),
  });
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  const initialValues = () =>
    createInitialFieldValues(fields, {
      now: new Date(),
      userId: me.data?.user.id ?? "",
      timezoneOffsetMinutes,
    });

  const createRecord = useMutation({
    mutationFn: (value: { title: string; values: Record<string, unknown> }) =>
      apiRequest<ModuleRecord>(`/api/projects/${projectId}/modules/${moduleId}/records`, {
        method: "POST",
        body: {
          title: value.title.trim() || m.timeline_untitled(),
          values: value.values,
          timezoneOffsetMinutes,
        },
      }),
    onSuccess(record) {
      queryClient.setQueryData<{ items: ModuleRecord[] }>(queryKeys.records(projectId, moduleId), (current) => ({
        items: [...(current?.items ?? []), record],
      }));
    },
  });

  const form = useForm({
    defaultValues: { title: "", values: initialValues() },
    onSubmit: async ({ value }) => {
      const missingField = fields.find((field) => field.required && isEmptyFieldValue(value.values[field.id]));
      if (missingField) {
        setFormError(`${missingField.label}: ${m.field_required()}`);
        return;
      }
      setFormError(null);
      await createRecord.mutateAsync(value);
      form.reset({ title: "", values: initialValues() });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (open && me.data) {
      createRecord.reset();
      form.reset({ title: "", values: initialValues() });
      setFormError(null);
    }
  }, [fields, me.data, open]);

  const error = createRecord.error instanceof Error ? createRecord.error.message : formError;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && createRecord.isPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="w-full sm:max-w-[520px]">
        <SheetHeader className="border-b border-border-subtle px-6 py-5">
          <SheetTitle className="text-base">{m.timeline_create_placeholder()}</SheetTitle>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid flex-1 content-start overflow-y-auto px-6 py-4">
            <form.Field name="title">
              {(field) => (
                <Field className="border-b border-border-subtle pb-5">
                  <FieldLabel htmlFor={field.name}>{m.template_name_label()}</FieldLabel>
                  <Input
                    id={field.name}
                    autoFocus
                    className="h-10 border-input bg-background text-base"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="values">
              {(valuesField) => (
                <div className="grid divide-y divide-border-subtle pt-2">
                  {fields.map((field) => (
                    <Field
                      className="grid grid-cols-[minmax(112px,0.42fr)_minmax(0,1fr)] items-center gap-4 py-3 max-[460px]:grid-cols-1 max-[460px]:gap-2"
                      key={field.id}
                    >
                      <FieldLabel htmlFor={`record-${field.id}`}>
                        {field.label}{field.required ? <span className="text-destructive">*</span> : null}
                      </FieldLabel>
                      <DynamicFieldControl
                        id={`record-${field.id}`}
                        type={field.type}
                        options={field.options}
                        members={members.data?.items}
                        value={valuesField.state.value[field.id]}
                        onValueChange={(value) => {
                          createRecord.reset();
                          setFormError(null);
                          const next = { ...valuesField.state.value };
                          if (value === undefined) delete next[field.id];
                          else next[field.id] = value;
                          valuesField.handleChange(next);
                        }}
                        ariaLabel={field.label}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </form.Field>
            {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border-subtle px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              disabled={createRecord.isPending}
              onClick={() => onOpenChange(false)}
            >
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={createRecord.isPending}>
              <Check />
              {m.timeline_create_placeholder()}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
