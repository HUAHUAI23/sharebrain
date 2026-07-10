export type TemplateFieldSeed = {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultPolicy: string;
  defaultValue: unknown;
  options: Array<{ id: string; label: string; color?: string }>;
  sortKey: string;
};

export type TemplateSeed = {
  id: string;
  key: string;
  name: string;
  kind: string;
  description: string;
  icon: string;
  sortKey: string;
  metadata: Record<string, unknown>;
  fields: TemplateFieldSeed[];
};

export const moduleTemplateSeeds: TemplateSeed[] = [
  {
    id: "00000000-0000-4000-8300-000000000001",
    key: "logs",
    name: "日志",
    kind: "timeline",
    description: "按时间线记录项目日志、变更、问题和关键事件。",
    icon: "list-tree",
    sortKey: "a0",
    metadata: { fixed: true },
    fields: [],
  },
  {
    id: "00000000-0000-4000-8300-000000000002",
    key: "project-background",
    name: "项目背景",
    kind: "collection",
    description: "沉淀项目目标、背景资料、范围约束和关键上下文。",
    icon: "file-text",
    sortKey: "b0",
    metadata: { fixed: true },
    fields: [],
  },
  {
    id: "00000000-0000-4000-8300-000000000003",
    key: "knowledge-base",
    name: "知识库",
    kind: "collection",
    description: "组织长期复用的项目知识、操作手册和排障文档。",
    icon: "book-open-text",
    sortKey: "c0",
    metadata: { fixed: true },
    fields: [],
  },
];
