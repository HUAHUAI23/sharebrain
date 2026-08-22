// 定义知识管理台的 URL 状态和分析响应，避免各子视图重复声明接口形状。
export type KnowledgeSettingsView = "concepts" | "proposals" | "weights" | "graph" | "analytics";
export type KnowledgeProposalKind = "concept" | "relation" | "merge";
export type KnowledgeWeightSourceType = "document" | "project" | "concept";

export type KnowledgeSettingsSearch = {
  view: KnowledgeSettingsView;
  conceptId?: string;
  proposalKind: KnowledgeProposalKind;
  sourceType: KnowledgeWeightSourceType;
  graphDepth: 1 | 2;
};

export type KnowledgeAnalytics = {
  feedback: {
    up: number;
    down: number;
    wrongProject: number;
  };
  feedbackByTier?: Array<{
    tier: "active_project" | "tenant_global" | "graph_expanded";
    up: number;
    down: number;
  }>;
  topSources: Array<{
    sourceType: string;
    sourceId: string;
    title: string;
    citations: number;
  }>;
  wrongProjectTrend: Array<{
    date: string;
    count: number;
  }>;
};

export type KnowledgeSearchPatch = Partial<Omit<KnowledgeSettingsSearch, "conceptId">> & {
  conceptId?: string | undefined;
};

export type KnowledgeSearchChange = (
  next: KnowledgeSearchPatch,
  replace?: boolean,
) => void;
