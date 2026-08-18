const SEARCH_TOKEN = /[\p{L}\p{N}]/u;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function tokenizeForSearch(value: string): string {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const tokens: string[] = [];

  for (const part of segmenter.segment(normalized)) {
    const token = part.segment.trim();
    if (!token || !SEARCH_TOKEN.test(token)) continue;
    tokens.push(token);
  }

  return tokens.join(" ");
}

export function toSimpleTsQuery(value: string): string {
  return tokenizeForSearch(value)
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => token.replace(/[':&|!()]/gu, ""))
    .filter(Boolean)
    .join(" & ");
}
