import { z } from "zod";

import { ApiError } from "../../app/api-error";

export type FieldDefinition = {
  id: string;
  type: string;
  required: boolean;
  defaultPolicy: string;
  defaultValue: unknown;
};

function schemaForField(field: FieldDefinition) {
  switch (field.type) {
    case "text":
    case "date":
    case "datetime":
    case "url":
    case "user":
    case "select":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      throw new ApiError("FIELD_TYPE_UNSUPPORTED", `不支持的字段类型: ${field.type}`, 422);
  }
}

function applyDefaultValue(field: FieldDefinition, values: Record<string, unknown>) {
  if (Object.hasOwn(values, field.id)) {
    return values[field.id];
  }

  if (field.defaultPolicy === "fixed") {
    return field.defaultValue;
  }

  return undefined;
}

export function validateRecordValues(fields: FieldDefinition[], values: Record<string, unknown>) {
  const allowed = new Set(fields.map((field) => field.id));
  const unknownKeys = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("UNKNOWN_FIELD_VALUE", "记录包含未知字段值。", 422, { fieldIds: unknownKeys });
  }

  const shape: Record<string, z.ZodType> = {};
  const normalizedValues: Record<string, unknown> = {};
  for (const field of fields) {
    const base = schemaForField(field);
    shape[field.id] = field.required ? base : base.optional().nullable();
    const value = applyDefaultValue(field, values);
    if (value !== undefined) {
      normalizedValues[field.id] = value;
    }
  }

  const parsed = z.object(shape).safeParse(normalizedValues);
  if (!parsed.success) {
    throw new ApiError("FIELD_VALUE_INVALID", "记录字段值类型不匹配。", 422, parsed.error.flatten());
  }

  return parsed.data;
}
