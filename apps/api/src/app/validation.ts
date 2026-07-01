import type { z } from "zod";

import { ApiError } from "./api-error";

export function parseJson<TSchema extends z.ZodType>(schema: TSchema, value: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "请求参数不合法。", 422, parsed.error.flatten());
  }

  return parsed.data;
}

export function requireQuery(value: string | undefined, name: string) {
  if (!value || value.trim().length === 0) {
    throw new ApiError("VALIDATION_FAILED", `缺少查询参数 ${name}。`, 422);
  }

  return value.trim();
}
