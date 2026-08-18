import { isQueryStopword } from "./stopwords";

const SEARCH_TOKEN = /[\p{L}\p{N}]/u;
// 只剥 tsquery 的操作符。别的字符必须原样留下：索引端写入的是同一个分词器的输出，
// 多剥一个点就会让 `registry.example` 这类词在查询端和索引端对不上。
const TSQUERY_OPERATORS = /['"\\:&|!()<>*]/gu;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export type TsQueryMode = "all" | "any";

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

// 查询端在分词后再去一次功能词。自然语言提问里的"怎么/如何/的"不是检索意图，
// 留着会在 all 模式下把召回打到零，在 any 模式下稀释 ts_rank。
export function tokenizeQueryTerms(value: string): string[] {
  const tokens = tokenizeForSearch(value)
    .split(/\s+/u)
    .map((token) => token.replace(TSQUERY_OPERATORS, ""))
    .filter(Boolean);
  const meaningful = tokens.filter((token) => !isQueryStopword(token));
  return [...new Set(meaningful.length > 0 ? meaningful : tokens)];
}

export function toSimpleTsQuery(value: string, mode: TsQueryMode = "all"): string {
  return tokenizeQueryTerms(value).join(mode === "all" ? " & " : " | ");
}
