const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_RAW_URL_PATTERN =
  /\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/raw\b/gi;
const DOCUMENT_MEDIA_NODE_TYPES = new Set(["img", "video", "audio", "file"]);

function collectRawUrlMediaIds(value: string, mediaIds: Set<string>) {
  for (const match of value.matchAll(MEDIA_RAW_URL_PATTERN)) {
    const mediaId = match[1];
    if (mediaId) {
      mediaIds.add(mediaId);
    }
  }
}

function collectDocumentInlineMediaIds(value: unknown, mediaIds: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDocumentInlineMediaIds(item, mediaIds);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const url = typeof record.url === "string" ? record.url : "";
  const isMediaNode = DOCUMENT_MEDIA_NODE_TYPES.has(type);
  const sourceKey = typeof record.sourceKey === "string" ? record.sourceKey : "";

  if (isMediaNode && UUID_PATTERN.test(sourceKey)) {
    mediaIds.add(sourceKey);
  }

  if (isMediaNode && url) {
    collectRawUrlMediaIds(url, mediaIds);
  }

  for (const item of Object.values(record)) {
    collectDocumentInlineMediaIds(item, mediaIds);
  }
}

export function extractDocumentInlineMediaIds(value: unknown) {
  const mediaIds = new Set<string>();
  collectDocumentInlineMediaIds(value, mediaIds);
  return [...mediaIds];
}
