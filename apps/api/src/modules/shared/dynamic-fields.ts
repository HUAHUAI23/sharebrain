import { z } from "zod";

import { ApiError } from "../../app/api-error";

export type FieldDefinition = {
  id: string;
  type: string;
  required: boolean;
  defaultKind: string;
  defaultValue: unknown;
  options?: Array<{ id: string; label: string; color?: string | undefined }>;
};

export type FieldDefinitionInput = {
  type: string;
  required: boolean;
  defaultKind: string;
  defaultValue?: unknown;
  options: Array<{ id: string; label: string; color?: string | undefined }>;
};

export type FieldDefaultContext = {
  now: Date;
  userId: string;
  timezoneOffsetMinutes: number;
};

function valueSchemaForField(field: Pick<FieldDefinition, "type"> & Partial<Pick<FieldDefinition, "required">>) {
  switch (field.type) {
    case "user":
      return z.string().uuid();
    case "text":
      return field.required ? z.string().trim().min(1) : z.string();
    case "date":
      return z.string().date();
    case "datetime":
      return z.string().datetime({ offset: true });
    case "url":
      return z.string().url();
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

function normalizeOptions(options: Array<{ id: string; label: string; color?: string | undefined }>) {
  return options.map((option) => ({
    id: option.id.trim(),
    label: option.label.trim(),
    ...(option.color?.trim() ? { color: option.color.trim() } : {}),
  }));
}

function validateSelectOptions(options: Array<{ id: string; label: string; color?: string | undefined }>) {
  if (options.length === 0) {
    throw new ApiError("FIELD_OPTIONS_REQUIRED", "select 字段必须配置选项。", 422);
  }

  const seen = new Set<string>();
  for (const option of options) {
    if (!option.id || !option.label) {
      throw new ApiError("FIELD_OPTION_INVALID", "字段选项必须包含 id 和 label。", 422);
    }
    if (seen.has(option.id)) {
      throw new ApiError("FIELD_OPTION_DUPLICATED", "字段选项 id 不能重复。", 422, { optionId: option.id });
    }
    seen.add(option.id);
  }
}

export function validateFieldDefinitionInput(field: FieldDefinitionInput) {
  const options = field.type === "select" ? normalizeOptions(field.options) : [];
  if (field.type === "select") {
    validateSelectOptions(options);
  }

  const defaultKind = field.defaultKind;
  const supportedDefaultKinds = new Set(["none", "literal", "now", "today", "current_user"]);
  if (!supportedDefaultKinds.has(defaultKind)) {
    throw new ApiError("FIELD_DEFAULT_KIND_INVALID", "字段默认值类型无效。", 422);
  }

  const dynamicDefaultTypes: Record<string, string> = {
    now: "datetime",
    today: "date",
    current_user: "user",
  };
  const requiredType = dynamicDefaultTypes[defaultKind];
  if (requiredType && field.type !== requiredType) {
    throw new ApiError("FIELD_DEFAULT_KIND_INVALID", "默认值类型与字段类型不匹配。", 422, {
      defaultKind,
      fieldType: field.type,
    });
  }

  let defaultValue = defaultKind === "literal" ? field.defaultValue : null;
  if (defaultKind === "literal") {
    const parsed = valueSchemaForField(field).safeParse(defaultValue);
    if (!parsed.success) {
      throw new ApiError("FIELD_DEFAULT_VALUE_INVALID", "字段默认值类型不匹配。", 422, parsed.error.flatten());
    }
    defaultValue = parsed.data;
    if (field.type === "select" && !options.some((option) => option.id === parsed.data)) {
      throw new ApiError("FIELD_DEFAULT_VALUE_INVALID", "select 默认值必须匹配已有选项。", 422);
    }
  }

  return {
    defaultValue,
    options,
  };
}

function resolveDefaultValue(field: FieldDefinition, context: FieldDefaultContext) {
  if (field.defaultKind === "literal") {
    return field.defaultValue;
  }
  if (field.defaultKind === "now") {
    return context.now.toISOString();
  }
  if (field.defaultKind === "today") {
    return new Date(context.now.getTime() - context.timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  if (field.defaultKind === "current_user") {
    return context.userId;
  }
  return undefined;
}

function applyDefaultValue(
  field: FieldDefinition,
  values: Record<string, unknown>,
  context: FieldDefaultContext,
) {
  if (Object.hasOwn(values, field.id)) {
    return values[field.id];
  }

  return resolveDefaultValue(field, context);
}

export function validateRecordValues(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  context: FieldDefaultContext,
) {
  const allowed = new Set(fields.map((field) => field.id));
  const unknownKeys = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("UNKNOWN_FIELD_VALUE", "记录包含未知字段值。", 422, { fieldIds: unknownKeys });
  }

  const shape: Record<string, z.ZodType> = {};
  const normalizedValues: Record<string, unknown> = {};
  for (const field of fields) {
    const base = valueSchemaForField(field);
    shape[field.id] = field.required ? base : base.optional().nullable();
    const value = applyDefaultValue(field, values, context);
    if (value !== undefined) {
      normalizedValues[field.id] = value;
    }
  }

  const parsed = z.object(shape).safeParse(normalizedValues);
  if (!parsed.success) {
    throw new ApiError("FIELD_VALUE_INVALID", "记录字段值类型不匹配。", 422, parsed.error.flatten());
  }

  for (const field of fields) {
    if (field.type !== "select") {
      continue;
    }
    const value = parsed.data[field.id];
    if (value == null) {
      continue;
    }
    const options = field.options ?? [];
    if (!options.some((option) => option.id === value)) {
      throw new ApiError("FIELD_VALUE_INVALID", "select 字段值必须匹配已有选项。", 422, { fieldId: field.id });
    }
  }

  return parsed.data;
}

export function validateRecordValuePatch(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
) {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const unknownKeys = Object.keys(values).filter((key) => !fieldsById.has(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("UNKNOWN_FIELD_VALUE", "记录包含未知字段值。", 422, { fieldIds: unknownKeys });
  }

  const normalizedValues: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(values)) {
    const field = fieldsById.get(fieldId)!;
    const schema = field.required ? valueSchemaForField(field) : valueSchemaForField(field).nullable();
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ApiError("FIELD_VALUE_INVALID", "记录字段值类型不匹配。", 422, {
        fieldId,
        ...parsed.error.flatten(),
      });
    }
    if (
      field.type === "select" &&
      parsed.data !== null &&
      !(field.options ?? []).some((option) => option.id === parsed.data)
    ) {
      throw new ApiError("FIELD_VALUE_INVALID", "select 字段值必须匹配已有选项。", 422, { fieldId });
    }
    normalizedValues[fieldId] = parsed.data;
  }

  return normalizedValues;
}
