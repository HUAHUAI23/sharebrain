import { describe, expect, test } from "bun:test";

import { ApiError } from "../../app/api-error";
import {
  validateFieldDefinitionInput,
  validateRecordValuePatch,
  validateRecordValues,
  type FieldDefinition,
} from "./dynamic-fields";

const context = {
  now: new Date("2026-07-09T20:30:00.000Z"),
  userId: "00000000-0000-4000-8000-000000000001",
  timezoneOffsetMinutes: -480,
};

function field(overrides: Partial<FieldDefinition> & Pick<FieldDefinition, "id" | "type">): FieldDefinition {
  return {
    required: false,
    defaultKind: "none",
    defaultValue: null,
    ...overrides,
  };
}

describe("dynamic field defaults", () => {
  test("resolves literal and contextual defaults", () => {
    const values = validateRecordValues(
      [
        field({ id: "literal", type: "text", defaultKind: "literal", defaultValue: "ready" }),
        field({ id: "now", type: "datetime", defaultKind: "now" }),
        field({ id: "today", type: "date", defaultKind: "today" }),
        field({ id: "current-user", type: "user", defaultKind: "current_user" }),
        field({ id: "none", type: "text" }),
      ],
      {},
      context,
    );

    expect(values).toEqual({
      literal: "ready",
      now: "2026-07-09T20:30:00.000Z",
      today: "2026-07-10",
      "current-user": context.userId,
    });
  });

  test("preserves explicit false and zero values", () => {
    const values = validateRecordValues(
      [
        field({ id: "enabled", type: "boolean", defaultKind: "literal", defaultValue: true }),
        field({ id: "count", type: "number", defaultKind: "literal", defaultValue: 12 }),
      ],
      { enabled: false, count: 0 },
      context,
    );

    expect(values).toEqual({ enabled: false, count: 0 });
  });

  test("rejects malformed user ids before membership queries", () => {
    expect(() =>
      validateRecordValues(
        [field({ id: "owner", type: "user" })],
        { owner: "not-a-user-id" },
        context,
      ),
    ).toThrow(ApiError);

    try {
      validateRecordValues(
        [field({ id: "owner", type: "user" })],
        { owner: "not-a-user-id" },
        context,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: "FIELD_VALUE_INVALID", status: 422 });
    }
  });

  test("rejects default kinds that do not match the field type", () => {
    expect(() =>
      validateFieldDefinitionInput({
        type: "date",
        required: false,
        defaultKind: "current_user",
        options: [],
      }),
    ).toThrow(ApiError);
  });

  test("validates record patches without applying creation defaults", () => {
    const fields = [
      field({ id: "now", type: "datetime", defaultKind: "now" }),
      field({ id: "enabled", type: "boolean", required: true }),
    ];

    expect(validateRecordValuePatch(fields, { enabled: false })).toEqual({ enabled: false });
    expect(() => validateRecordValuePatch(fields, { unknown: "value" })).toThrow(ApiError);
  });
});
