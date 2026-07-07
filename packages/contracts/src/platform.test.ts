import { describe, expect, test } from "bun:test";

import { createMediaUploadRequestSchema } from "./platform";

describe("createMediaUploadRequestSchema", () => {
  const baseRequest = {
    fileName: "image.png",
    mimeType: "image/png",
    byteSize: 64,
  };

  test("accepts currently supported upload usage kinds", () => {
    expect(createMediaUploadRequestSchema.safeParse({ ...baseRequest, usageKind: "avatar" }).success).toBe(true);
    expect(createMediaUploadRequestSchema.safeParse({ ...baseRequest, usageKind: "inline" }).success).toBe(true);
  });

  test("rejects media usage kinds that are not upload entry points", () => {
    expect(createMediaUploadRequestSchema.safeParse({ ...baseRequest, usageKind: "cover" }).success).toBe(false);
    expect(createMediaUploadRequestSchema.safeParse({ ...baseRequest, usageKind: "attachment" }).success).toBe(false);
  });
});
