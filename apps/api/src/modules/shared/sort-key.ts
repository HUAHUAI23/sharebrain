const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function nextSortKey(currentCount: number) {
  return `${String(currentCount + 1).padStart(6, "0")}`;
}

export function appendSortKey() {
  const timestamp = Date.now().toString(36).padStart(10, "0");
  const entropy = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `z${timestamp}${entropy}`;
}

export function betweenSortKeys(before?: string | null, after?: string | null) {
  if (!before && !after) {
    return "000001";
  }

  if (before && !after) {
    return `${before}z`;
  }

  if (!before && after) {
    return `${after.slice(0, Math.max(0, after.length - 1))}${alphabet[0]}`;
  }

  return `${before}m`;
}
