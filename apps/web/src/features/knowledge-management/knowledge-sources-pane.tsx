// 展示文档、项目和概念来源的反馈聚合，并允许管理员调整人工排序乘数。
import { m } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { Slider } from "@sharebrain/ui/components/slider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderKanban, Save, Search, Tags, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type {
  KnowledgeSearchChange,
  KnowledgeSettingsSearch,
  KnowledgeWeightSourceType,
} from "./knowledge-management.types";

import type { KnowledgeSourceListItem } from "@sharebrain/contracts";

const sourceTypes = [
  ["document", m.knowledge_source_documents, FileText],
  ["project", m.knowledge_source_projects, FolderKanban],
  ["concept", m.knowledge_source_concepts, Tags],
] as const;

export function KnowledgeSourcesPane({
  search,
  onSearchChange,
  isAdmin,
}: {
  search: KnowledgeSettingsSearch;
  onSearchChange: KnowledgeSearchChange;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const sources = useQuery({
    queryKey: queryKeys.knowledgeSources(search.sourceType, query),
    queryFn: () => {
      const params = new URLSearchParams({ type: search.sourceType });
      if (query.trim()) params.set("q", query.trim());
      return apiRequest<{ items: KnowledgeSourceListItem[] }>(`/api/knowledge/sources?${params}`);
    },
  });
  const update = useMutation({
    mutationFn: ({ source, manualWeight }: { source: KnowledgeSourceListItem; manualWeight: number }) =>
      apiRequest(`/api/knowledge/sources/${source.sourceType}/${source.sourceId}/score`, {
        method: "PATCH",
        body: { manualWeight },
      }),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ["knowledge", "sources"] });
      toast.success(m.knowledge_weight_saved());
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : m.knowledge_action_failed());
    },
  });
  const items = sources.data?.items ?? [];

  return (
    <section className="grid gap-4">
      <div className="flex min-w-0 items-end justify-between gap-4 max-[640px]:grid max-[640px]:items-stretch">
        <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-border">
          {sourceTypes.map(([type, label, Icon]) => (
            <button
              type="button"
              key={type}
              data-active={search.sourceType === type}
              className="inline-flex h-10 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground data-[active=true]:text-foreground"
              onClick={() => onSearchChange({ sourceType: type as KnowledgeWeightSourceType })}
            >
              <Icon className="size-4" />
              {label()}
            </button>
          ))}
        </div>
        <label className="relative block w-full max-w-72 max-[640px]:max-w-none">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            value={query}
            placeholder={m.knowledge_source_search()}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_140px_180px] gap-4 border-b border-border px-3 pb-2 text-[11px] font-medium text-muted-foreground max-[720px]:hidden">
        <span>{m.knowledge_source()}</span>
        <span>{m.knowledge_feedback()}</span>
        <span>{m.knowledge_manual_weight()}</span>
      </div>
      {sources.isLoading ? <NotionEmpty>{m.common_loading()}</NotionEmpty> : null}
      {sources.error ? <NotionEmpty>{m.knowledge_load_failed()}</NotionEmpty> : null}
      {!sources.isLoading && !sources.error && items.length === 0 ? (
        <NotionEmpty className="min-h-72">{m.knowledge_sources_empty()}</NotionEmpty>
      ) : null}
      <div className="divide-y divide-border border-y border-border">
        {items.map((source) => (
          <SourceWeightRow
            key={`${source.sourceType}:${source.sourceId}`}
            source={source}
            isAdmin={isAdmin}
            saving={update.isPending && update.variables?.source.sourceId === source.sourceId}
            onSave={(manualWeight) => update.mutate({ source, manualWeight })}
          />
        ))}
      </div>
    </section>
  );
}

function SourceWeightRow({
  source,
  isAdmin,
  saving,
  onSave,
}: {
  source: KnowledgeSourceListItem;
  isAdmin: boolean;
  saving: boolean;
  onSave: (manualWeight: number) => void;
}) {
  const [draft, setDraft] = useState(source.manualWeight);
  useEffect(() => setDraft(source.manualWeight), [source.manualWeight]);
  const changed = Math.abs(draft - source.manualWeight) > 0.001;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_140px_180px] items-center gap-4 px-3 py-3 max-[720px]:grid-cols-1 max-[720px]:gap-2">
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-medium">{source.title}</strong>
        {source.subtitle ? <span className="block truncate text-[11px] text-muted-foreground">{source.subtitle}</span> : null}
      </span>
      <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1" aria-label={m.feedback_up()}><ThumbsUp className="size-3.5" />{source.upCount}</span>
        <span className="inline-flex items-center gap-1" aria-label={m.feedback_down()}><ThumbsDown className="size-3.5" />{source.downCount}</span>
      </span>
      {isAdmin ? (
        <span className="grid grid-cols-[minmax(0,1fr)_38px_28px] items-center gap-2">
          <Slider
            value={[draft]}
            min={0}
            max={2}
            step={0.05}
            aria-label={m.knowledge_manual_weight()}
            onValueChange={(value) => setDraft(value[0] ?? 1)}
          />
          <span className="text-right text-xs font-medium tabular-nums">{draft.toFixed(2)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!changed || saving}
            aria-label={m.common_save()}
            onClick={() => onSave(Number(draft.toFixed(2)))}
          >
            <Save />
          </Button>
        </span>
      ) : (
        <span className="text-xs font-medium tabular-nums">{source.manualWeight.toFixed(2)}</span>
      )}
    </div>
  );
}
