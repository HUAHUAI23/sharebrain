import { Checkbox } from "@sharebrain/ui/components/checkbox";
import { Input } from "@sharebrain/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sharebrain/ui/components/select";
import { m } from "@sharebrain/i18n";

import type { ModuleFieldOption, ModuleFieldType } from "@sharebrain/contracts";

type ModuleFieldValueInputProps = {
  id?: string;
  type: ModuleFieldType;
  options?: ModuleFieldOption[];
  value: unknown;
  onValueChange: (value: unknown) => void;
  ariaLabel: string;
  disabled?: boolean;
};

function toDateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (value.length === 0) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toTextValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

export function formatModuleFieldValue(
  field: { type: ModuleFieldType; options?: ModuleFieldOption[] },
  value: unknown,
) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (field.type === "boolean") {
    return value === true ? m.common_yes() : m.common_no();
  }

  if (field.type === "select") {
    const option = field.options?.find((item) => item.id === value);
    return option?.label ?? String(value);
  }

  return String(value);
}

export function ModuleFieldValueInput({
  id,
  type,
  options = [],
  value,
  onValueChange,
  ariaLabel,
  disabled,
}: ModuleFieldValueInputProps) {
  if (type === "boolean") {
    return (
      <label className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onValueChange(checked === true)}
        />
        {value === true ? m.common_yes() : m.common_no()}
      </label>
    );
  }

  if (type === "select") {
    const selectValue = typeof value === "string" ? value : undefined;

    return (
      <Select
        {...(selectValue === undefined ? {} : { value: selectValue })}
        disabled={disabled || options.length === 0}
        onValueChange={onValueChange}
      >
        <SelectTrigger id={id} className="h-8 w-full" aria-label={ariaLabel}>
          <SelectValue placeholder={m.field_select_placeholder()} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const inputType =
    type === "number"
      ? "number"
      : type === "date"
        ? "date"
        : type === "datetime"
          ? "datetime-local"
          : type === "url"
            ? "url"
            : "text";

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      type={inputType}
      value={type === "datetime" ? toDateTimeLocalValue(value) : toTextValue(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (type === "number") {
          onValueChange(raw === "" ? undefined : Number(raw));
          return;
        }
        if (type === "datetime") {
          onValueChange(toIsoDateTime(raw));
          return;
        }
        if (type === "date" || type === "url") {
          onValueChange(raw === "" ? undefined : raw);
          return;
        }
        onValueChange(raw);
      }}
    />
  );
}
