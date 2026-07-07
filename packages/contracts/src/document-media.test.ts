import { describe, expect, test } from "bun:test";

import { extractDocumentInlineMediaIds } from "./document-media";

describe("extractDocumentInlineMediaIds", () => {
  test("extracts media ids from media node source keys and stable URLs only", () => {
    const mediaIdFromKey = "00000000-0000-4000-9200-000000000001";
    const mediaIdFromUrl = "00000000-0000-4000-9200-000000000002";
    const textOnlyMediaId = "00000000-0000-4000-9200-000000000003";
    const nodeKeyOnlyMediaId = "00000000-0000-4000-9200-000000000004";

    expect(
      extractDocumentInlineMediaIds([
        {
          type: "img",
          sourceKey: mediaIdFromKey,
          url: `/api/media/${mediaIdFromKey}/raw`,
          children: [{ text: "" }],
        },
        {
          type: "p",
          children: [{ text: `plain text /api/media/${textOnlyMediaId}/raw reference` }],
        },
        {
          type: "img",
          key: nodeKeyOnlyMediaId,
          children: [{ text: "" }],
        },
        {
          type: "img",
          url: `/api/media/${mediaIdFromUrl}/raw`,
          children: [{ text: "" }],
        },
      ]),
    ).toEqual([mediaIdFromKey, mediaIdFromUrl]);
  });
});
