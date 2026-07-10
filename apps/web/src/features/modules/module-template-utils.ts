import { m } from "@sharebrain/i18n";

import type { ModuleFieldType, ModuleKind } from "@sharebrain/contracts";

export const moduleKinds = ["timeline", "collection"] as const satisfies readonly ModuleKind[];

export const moduleFieldTypes = [
  "text",
  "number",
  "date",
  "datetime",
  "boolean",
  "select",
  "url",
  "user",
] as const satisfies readonly ModuleFieldType[];

export function getKindLabel(kind: ModuleKind) {
  return kind === "timeline" ? m.module_timeline_label() : m.module_collection_label();
}

export function getFieldTypeLabel(type: ModuleFieldType) {
  const labels: Record<ModuleFieldType, string> = {
    text: m.field_type_text(),
    number: m.field_type_number(),
    date: m.field_type_date(),
    datetime: m.field_type_datetime(),
    boolean: m.field_type_boolean(),
    select: m.field_type_select(),
    url: m.field_type_url(),
    user: m.field_type_user(),
  };
  return labels[type];
}

export function slugifyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
