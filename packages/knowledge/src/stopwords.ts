import { normalizeConceptName } from "./concept-name";

const INITIAL_STOPWORDS = [
  "系统",
  "服务",
  "配置",
  "功能",
  "模块",
  "项目",
  "文档",
  "问题",
  "方案",
  "数据",
  "用户",
  "管理",
  "system",
  "service",
  "config",
  "configuration",
  "feature",
  "module",
  "project",
  "document",
  "data",
  "user",
] as const;

export const KNOWLEDGE_CONCEPT_STOPWORDS = new Set(
  INITIAL_STOPWORDS.map(normalizeConceptName),
);

export function isConceptStopword(value: string): boolean {
  return KNOWLEDGE_CONCEPT_STOPWORDS.has(normalizeConceptName(value));
}

// 只收功能词与疑问词，不收任何可能承载检索意图的名词。
const QUERY_STOPWORDS = [
  "的", "了", "着", "过", "是", "在", "有", "和", "与", "或", "也", "都", "就", "还",
  "把", "被", "从", "到", "给", "让", "对", "为", "以", "之", "而", "且", "等", "呢",
  "吗", "吧", "啊", "呀", "么", "样", "个", "些", "中", "上", "下", "里",
  "我", "你", "他", "她", "它", "我们", "你们", "他们",
  "这", "那", "这个", "那个", "这些", "那些", "这里", "那里",
  "什么", "怎么", "怎样", "如何", "为什么", "为何", "哪", "哪个", "哪些", "谁",
  "何时", "多少", "是否", "可以", "能否", "需要", "应该", "请", "请问", "一下",
  "如果", "因为", "所以", "但是", "关于", "一个", "一些",
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "for", "to", "from",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could",
  "should", "would", "will", "how", "what", "why", "when", "where", "which",
  "who", "this", "that", "these", "those", "i", "you", "he", "she", "it", "we",
  "they", "my", "your", "me", "please", "about",
] as const;

export const KNOWLEDGE_QUERY_STOPWORDS: ReadonlySet<string> = new Set(QUERY_STOPWORDS);

export function isQueryStopword(token: string): boolean {
  return KNOWLEDGE_QUERY_STOPWORDS.has(token);
}
