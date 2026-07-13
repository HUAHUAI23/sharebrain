import { m } from "@sharebrain/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@sharebrain/ui/components/avatar";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sharebrain/ui/components/select";
import { Switch } from "@sharebrain/ui/components/switch";
import { X } from "lucide-react";

import type { ModuleFieldOption, ModuleFieldType, TenantMember } from "@sharebrain/contracts";

type DynamicFieldControlProps = {
  id?: string;
  type: ModuleFieldType;
  options?: ModuleFieldOption[];
  members?: TenantMember[] | undefined;
  value: unknown;
  onValueChange: (value: unknown) => void;
  ariaLabel: string;
  disabled?: boolean;
};

function toDateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toTextValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

export function formatModuleFieldValue(
  field: { type: ModuleFieldType; options?: ModuleFieldOption[] },
  value: unknown,
  members: TenantMember[] = [],
) {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "boolean") return value === true ? m.common_yes() : m.common_no();
  if (field.type === "select") return field.options?.find((item) => item.id === value)?.label ?? String(value);
  if (field.type === "user") return members.find((item) => item.id === value)?.displayName ?? String(value);
  if (field.type === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}

export function DynamicFieldControl({
  id,
  type,
  options = [],
  members = [],
  value,
  onValueChange,
  ariaLabel,
  disabled,
}: DynamicFieldControlProps) {
  if (type === "boolean") {
    return (
      <div className="flex min-h-9 items-center justify-between rounded-sm bg-muted/60 px-2.5">
        <span className="text-sm text-muted-foreground">{value === true ? m.common_yes() : m.common_no()}</span>
        <Switch checked={value === true} disabled={disabled} onCheckedChange={onValueChange} />
      </div>
    );
  }

  if (type === "select" || type === "user") {
    const items = type === "select" ? options : members;
    const selectValue = typeof value === "string" && value ? value : undefined;
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Select value={selectValue ?? ""} disabled={disabled || !items.length} onValueChange={onValueChange}>
          <SelectTrigger id={id} className="h-9 min-w-0 flex-1 bg-background" aria-label={ariaLabel}>
            <SelectValue placeholder={m.field_select_placeholder()} />
          </SelectTrigger>
          <SelectContent>
            {type === "select"
              ? options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)
              : members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    <Avatar size="sm">
                      <AvatarImage src={member.avatar.url} alt={member.displayName} />
                      <AvatarFallback>{member.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {member.displayName}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
        {selectValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={m.field_clear_value()}
            onClick={() => onValueChange(undefined)}
          >
            <X />
          </Button>
        ) : null}
      </div>
    );
  }

  const inputType =
    type === "number" ? "number" : type === "date" ? "date" : type === "datetime" ? "datetime-local" : type === "url" ? "url" : "text";

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      type={inputType}
      className="h-9 border-input bg-background"
      value={type === "datetime" ? toDateTimeLocalValue(value) : toTextValue(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (type === "number") return onValueChange(raw === "" ? undefined : Number(raw));
        if (type === "datetime") return onValueChange(toIsoDateTime(raw));
        if (type === "date" || type === "url") return onValueChange(raw || undefined);
        onValueChange(raw);
      }}
    />
  );
}
