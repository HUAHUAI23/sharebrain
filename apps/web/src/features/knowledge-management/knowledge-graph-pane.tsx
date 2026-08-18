// 渲染最多两跳的有界知识关系图，并把概念选择同步回 URL。
import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useIsMobile } from "@sharebrain/ui/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sharebrain/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderKanban, Tags } from "lucide-react";
import { useMemo } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { layoutKnowledgeGraph } from "./knowledge-graph-layout";
import type { KnowledgeSearchChange, KnowledgeSettingsSearch } from "./knowledge-management.types";

import type { KnowledgeConcept, KnowledgeGraph } from "@sharebrain/contracts";

export function KnowledgeGraphPane({
  search,
  onSearchChange,
}: {
  search: KnowledgeSettingsSearch;
  onSearchChange: KnowledgeSearchChange;
}) {
  const isMobile = useIsMobile();
  const canvasWidth = isMobile ? 360 : 900;
  const canvasHeight = 520;
  const concepts = useQuery({
    queryKey: queryKeys.knowledgeConcepts("active", "project_spread", ""),
    queryFn: () => apiRequest<{ items: KnowledgeConcept[] }>(
      "/api/knowledge/concepts?status=active&sort=project_spread",
    ),
  });
  const graph = useQuery({
    queryKey: queryKeys.knowledgeGraph(search.conceptId ?? null, search.graphDepth),
    queryFn: () => {
      const params = new URLSearchParams({ depth: String(search.graphDepth), limit: "100" });
      if (search.conceptId) params.set("conceptId", search.conceptId);
      return apiRequest<KnowledgeGraph>(`/api/knowledge/graph?${params}`);
    },
  });
  const positioned = useMemo(
    () => graph.data ? layoutKnowledgeGraph(graph.data, canvasWidth, canvasHeight) : [],
    [canvasHeight, canvasWidth, graph.data],
  );
  const byId = new Map(positioned.map((node) => [node.id, node]));

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={search.conceptId ?? "all"}
          onValueChange={(value) => onSearchChange({ conceptId: value === "all" ? undefined : value })}
        >
          <SelectTrigger className="w-full max-w-72" aria-label={m.knowledge_graph_focus()}>
            <SelectValue placeholder={m.knowledge_graph_all()} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{m.knowledge_graph_all()}</SelectItem>
            {(concepts.data?.items ?? []).map((concept) => (
              <SelectItem key={concept.id} value={concept.id}>{concept.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(search.graphDepth)}
          onValueChange={(value) => onSearchChange({ graphDepth: value === "2" ? 2 : 1 })}
        >
          <SelectTrigger className="w-36" aria-label={m.knowledge_graph_depth()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{m.knowledge_graph_one_hop()}</SelectItem>
            <SelectItem value="2">{m.knowledge_graph_two_hops()}</SelectItem>
          </SelectContent>
        </Select>
        <GraphLegend />
      </div>

      {graph.isLoading ? <NotionEmpty className="min-h-96">{m.common_loading()}</NotionEmpty> : null}
      {graph.error ? <NotionEmpty className="min-h-96">{m.knowledge_load_failed()}</NotionEmpty> : null}
      {graph.data && graph.data.nodes.length === 0 ? (
        <NotionEmpty className="min-h-96">{m.knowledge_graph_empty()}</NotionEmpty>
      ) : null}
      {graph.data && graph.data.nodes.length > 0 ? (
        <div className="min-w-0 overflow-hidden border border-border bg-muted/10">
          <svg
            className="block aspect-[3/4] min-h-[320px] w-full min-[768px]:aspect-[16/9]"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            role="img"
            aria-label={m.knowledge_graph_aria({ nodes: graph.data.nodes.length, edges: graph.data.edges.length })}
          >
            {graph.data.edges.map((edge) => {
              const source = byId.get(edge.sourceId);
              const target = byId.get(edge.targetId);
              if (!source || !target) return null;
              return (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={edge.status === "proposed" ? "stroke-amber-500/45" : "stroke-border"}
                  strokeWidth={Math.max(1, edge.weight * 2.5)}
                  strokeDasharray={edge.status === "proposed" ? "5 5" : undefined}
                >
                  <title>{edge.relation}</title>
                </line>
              );
            })}
            {positioned.map((node) => (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className={node.type === "concept" ? "cursor-pointer" : undefined}
                role={node.type === "concept" ? "button" : undefined}
                aria-label={node.type === "concept" ? node.label : undefined}
                tabIndex={node.type === "concept" ? 0 : undefined}
                onClick={() => node.type === "concept" && onSearchChange({ conceptId: node.id })}
                onKeyDown={(event) => {
                  if (node.type === "concept" && (event.key === "Enter" || event.key === " ")) {
                    onSearchChange({ conceptId: node.id });
                  }
                }}
              >
                <circle
                  r={node.type === "concept" ? 10 : 8}
                  className={node.type === "concept"
                    ? "fill-emerald-600 stroke-background"
                    : node.type === "project"
                      ? "fill-amber-500 stroke-background"
                      : "fill-sky-600 stroke-background"}
                  strokeWidth="3"
                />
                <text
                  y={node.type === "concept" ? 24 : 21}
                  textAnchor="middle"
                  className="pointer-events-none fill-foreground text-[10px]"
                >
                  {truncateLabel(node.label)}
                </text>
                <title>{node.label}</title>
              </g>
            ))}
          </svg>
        </div>
      ) : null}
      {graph.data?.truncated ? (
        <p className="m-0 border-l-2 border-amber-500 px-3 py-1 text-xs leading-5 text-muted-foreground">
          {m.knowledge_graph_truncated()}
        </p>
      ) : null}
    </section>
  );
}

function GraphLegend() {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground max-[640px]:ml-0">
      <span className="inline-flex items-center gap-1"><Tags className="size-3.5 text-emerald-600" />{m.knowledge_source_concepts()}</span>
      <span className="inline-flex items-center gap-1"><FileText className="size-3.5 text-sky-600" />{m.knowledge_source_documents()}</span>
      <span className="inline-flex items-center gap-1"><FolderKanban className="size-3.5 text-amber-500" />{m.knowledge_source_projects()}</span>
    </div>
  );
}

function truncateLabel(value: string) {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value;
}
