const TRAILING_QUALIFIER = /(?:\([^()]*(?:\)|$)|（[^（）]*(?:）|$))$/u;

export function normalizeConceptName(value: string): string {
  let normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
  while (TRAILING_QUALIFIER.test(normalized)) {
    normalized = normalized.replace(TRAILING_QUALIFIER, "").trim();
  }
  return normalized.replace(/\s+/gu, "");
}
