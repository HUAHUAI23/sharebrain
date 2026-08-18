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
