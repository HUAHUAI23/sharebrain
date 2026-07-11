import type { ModuleField } from "@sharebrain/contracts";

type DefaultContext = {
  now: Date;
  userId: string;
  timezoneOffsetMinutes: number;
};

export function createInitialFieldValues(fields: ModuleField[], context: DefaultContext) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.defaultKind === "literal") {
      values[field.id] = structuredClone(field.defaultValue);
    } else if (field.defaultKind === "now") {
      values[field.id] = context.now.toISOString();
    } else if (field.defaultKind === "today") {
      values[field.id] = new Date(context.now.getTime() - context.timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10);
    } else if (field.defaultKind === "current_user") {
      values[field.id] = context.userId;
    } else if (field.type === "boolean") {
      values[field.id] = false;
    }
  }
  return values;
}

export function isEmptyFieldValue(value: unknown) {
  return value === undefined || value === null || value === "";
}
