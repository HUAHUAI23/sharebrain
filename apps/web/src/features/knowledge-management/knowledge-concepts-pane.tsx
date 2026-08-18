// 展示概念主从列表、来源分布，并提供管理员状态治理和软合并入口。
import { m } from "@sharebrain/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@sharebrain/ui/components/alert-dialog";
import { Badge } from "@sharebrain/ui/components/badge";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sharebrain/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, GitMerge, Search, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type { KnowledgeSearchChange, KnowledgeSettingsSearch } from "./knowledge-management.types";

import type { KnowledgeConcept, KnowledgeConceptDetail } from "@sharebrain/contracts";

type ConceptStatusFilter = "all" | "active" | "proposed" | "rejected" | "merged";

export function KnowledgeConceptsPane({
  search,
  onSearchChange,
  isAdmin,
}: {
  search: KnowledgeSettingsSearch;
  onSearchChange: KnowledgeSearchChange;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ConceptStatusFilter>("all");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [confirmMode, setConfirmMode] = useState<"merge" | "reject" | null>(null);
  const concepts = useQuery({
    queryKey: queryKeys.knowledgeConcepts(status, "project_spread", query),
    queryFn: () => {
      const params = new URLSearchParams({ sort: "project_spread" });
      if (status !== "all") params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      return apiRequest<{ items: KnowledgeConcept[] }>(`/api/knowledge/concepts?${params}`);
    },
  });
  const items = useMemo(() => concepts.data?.items ?? [], [concepts.data?.items]);
  const selectedId = search.conceptId;
  const detail = useQuery({
    queryKey: queryKeys.knowledgeConcept(selectedId ?? "none"),
    queryFn: () => apiRequest<KnowledgeConceptDetail>(`/api/knowledge/concepts/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!concepts.data) return;
    const nextId = items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id;
    if (nextId !== selectedId) onSearchChange({ conceptId: nextId }, true);
  }, [concepts.data, items, onSearchChange, selectedId]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["knowledge", "concepts"] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge", "proposals"] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge", "graph"] }),
    ]);
  };
  const updateStatus = useMutation({
    mutationFn: ({ conceptId, nextStatus }: { conceptId: string; nextStatus: "active" | "rejected" }) =>
      apiRequest(`/api/knowledge/concepts/${conceptId}`, {
        method: "PATCH",
        body: { status: nextStatus },
      }),
    async onSuccess() {
      setConfirmMode(null);
      await invalidate();
      toast.success(m.knowledge_saved());
    },
    onError: showActionError,
  });
  const merge = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      apiRequest(`/api/knowledge/concepts/${sourceId}/merge`, {
        method: "POST",
        body: { targetConceptId: targetId },
      }),
    async onSuccess() {
      setConfirmMode(null);
      setMergeTargetId("");
      await invalidate();
      toast.success(m.knowledge_merge_complete());
    },
    onError: showActionError,
  });
  const selected = detail.data;
  const mergeTargets = items.filter((item) => item.id !== selectedId && item.status === "active");

  return (
    <section className="grid min-h-[620px] grid-cols-[minmax(260px,340px)_minmax(0,1fr)] overflow-hidden border border-border max-[820px]:grid-cols-1">
      <div className="min-w-0 border-r border-border max-[820px]:border-r-0 max-[820px]:border-b">
        <div className="grid gap-2 border-b border-border p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              value={query}
              placeholder={m.knowledge_concept_search()}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select value={status} onValueChange={(value) => setStatus(value as ConceptStatusFilter)}>
            <SelectTrigger className="w-full" size="sm" aria-label={m.knowledge_status_filter()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{m.knowledge_status_all()}</SelectItem>
              <SelectItem value="active">{m.knowledge_status_active()}</SelectItem>
              <SelectItem value="proposed">{m.knowledge_status_proposed()}</SelectItem>
              <SelectItem value="rejected">{m.knowledge_status_rejected()}</SelectItem>
              <SelectItem value="merged">{m.knowledge_status_merged()}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-1.5 max-[820px]:max-h-64">
          {concepts.isLoading ? <NotionEmpty>{m.common_loading()}</NotionEmpty> : null}
          {concepts.error ? <NotionEmpty>{m.knowledge_load_failed()}</NotionEmpty> : null}
          {!concepts.isLoading && !concepts.error && items.length === 0 ? (
            <NotionEmpty>{m.knowledge_concepts_empty()}</NotionEmpty>
          ) : null}
          {items.map((concept) => (
            <button
              type="button"
              key={concept.id}
              data-active={selectedId === concept.id}
              className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border-0 bg-transparent px-3 py-2.5 text-left hover:bg-accent data-[active=true]:bg-accent"
              onClick={() => onSearchChange({ conceptId: concept.id })}
            >
              <span className="min-w-0">
                <strong className="block truncate text-[13px] font-medium">{concept.name}</strong>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {conceptTypeLabel(concept.type)} · {conceptStatusLabel(concept.status)}
                </span>
              </span>
              <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                <strong className="block font-medium text-foreground">{concept.projectSpread}</strong>
                {m.knowledge_projects_short()}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 p-6 max-[640px]:p-4">
        {detail.isLoading ? <NotionEmpty>{m.common_loading()}</NotionEmpty> : null}
        {detail.error ? <NotionEmpty>{m.knowledge_load_failed()}</NotionEmpty> : null}
        {!detail.isLoading && !detail.error && !selected ? (
          <NotionEmpty>{m.knowledge_select_concept()}</NotionEmpty>
        ) : null}
        {selected ? (
          <div className="grid gap-7">
            <header className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 min-w-0 break-words text-xl font-semibold">{selected.name}</h2>
                  <Badge variant="outline" className="rounded-sm">{conceptStatusLabel(selected.status)}</Badge>
                </div>
                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">
                  {selected.description || m.knowledge_no_description()}
                </p>
              </div>
              {isAdmin ? (
                <div className="flex shrink-0 gap-1">
                  {selected.status !== "active" && selected.status !== "merged" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ conceptId: selected.id, nextStatus: "active" })}
                    >
                      <ShieldCheck />
                      <span className="max-[520px]:sr-only">{m.knowledge_accept()}</span>
                    </Button>
                  ) : null}
                  {selected.status !== "rejected" && selected.status !== "merged" ? (
                    <Button size="icon-sm" variant="ghost" aria-label={m.knowledge_reject()} onClick={() => setConfirmMode("reject")}>
                      <ShieldX />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </header>

            <div className="grid grid-cols-3 divide-x divide-border border-y border-border py-3 max-[520px]:grid-cols-1 max-[520px]:divide-x-0 max-[520px]:divide-y max-[520px]:py-0">
              <ConceptMetric label={m.knowledge_mentions()} value={selected.mentionCount} />
              <ConceptMetric label={m.knowledge_project_spread()} value={selected.projectSpread} />
              <ConceptMetric label={m.knowledge_concept_type()} value={conceptTypeLabel(selected.type)} />
            </div>

            <section className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">{m.knowledge_aliases()}</h3>
              <div className="flex flex-wrap gap-1.5">
                {selected.aliases.length > 0
                  ? selected.aliases.map((alias) => <Badge key={alias} variant="secondary" className="rounded-sm">{alias}</Badge>)
                  : <span className="text-xs text-muted-foreground">{m.knowledge_aliases_empty()}</span>}
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">{m.knowledge_project_distribution()}</h3>
              <div className="divide-y divide-border border-y border-border">
                {selected.projectDistribution.map((item) => (
                  <div className="flex min-w-0 items-center justify-between gap-4 py-2.5 text-[13px]" key={item.projectId}>
                    <span className="truncate">{item.projectName}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {m.knowledge_mention_count({ count: item.mentionCount })}
                    </span>
                  </div>
                ))}
                {selected.projectDistribution.length === 0 ? (
                  <p className="py-3 text-xs text-muted-foreground">{m.knowledge_mentions_empty()}</p>
                ) : null}
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">{m.knowledge_mention_sources()}</h3>
              <div className="divide-y divide-border border-y border-border">
                {selected.mentions.map((mention) => (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5" key={mention.documentId}>
                    <span className="min-w-0">
                      <strong className="block truncate text-[13px] font-medium">{mention.documentTitle}</strong>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {mention.projectName} · {salienceLabel(mention.salience)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={m.chat_open_source()}
                      onClick={() => void navigate({
                        to: "/documents/$documentId",
                        params: { documentId: mention.documentId },
                      })}
                    >
                      <ExternalLink />
                    </Button>
                  </div>
                ))}
                {selected.mentions.length === 0 ? (
                  <p className="py-3 text-xs text-muted-foreground">{m.knowledge_mentions_empty()}</p>
                ) : null}
              </div>
            </section>

            {isAdmin && selected.status !== "merged" ? (
              <section className="grid gap-3 border-t border-border pt-5">
                <div>
                  <h3 className="m-0 text-sm font-semibold">{m.knowledge_merge()}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{m.knowledge_merge_help()}</p>
                </div>
                <div className="flex max-w-xl items-center gap-2 max-[520px]:items-stretch">
                  <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label={m.knowledge_merge_target()}>
                      <SelectValue placeholder={m.knowledge_merge_target()} />
                    </SelectTrigger>
                    <SelectContent>
                      {mergeTargets.map((target) => <SelectItem key={target.id} value={target.id}>{target.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" disabled={!mergeTargetId} onClick={() => setConfirmMode("merge")}>
                    <GitMerge />
                    {m.knowledge_merge()}
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmMode !== null} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmMode === "merge" ? m.knowledge_merge_confirm_title() : m.knowledge_reject_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "merge" ? m.knowledge_merge_confirm_description() : m.knowledge_reject_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmMode === "reject" ? "destructive" : "default"}
              disabled={merge.isPending || updateStatus.isPending}
              onClick={() => {
                if (!selected) return;
                if (confirmMode === "merge" && mergeTargetId) {
                  merge.mutate({ sourceId: selected.id, targetId: mergeTargetId });
                } else if (confirmMode === "reject") {
                  updateStatus.mutate({ conceptId: selected.id, nextStatus: "rejected" });
                }
              }}
            >
              {confirmMode === "merge" ? m.knowledge_merge() : m.knowledge_reject()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ConceptMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid gap-1 px-4 first:pl-0 last:pr-0 max-[520px]:px-0 max-[520px]:py-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <strong className="text-[13px] font-medium tabular-nums">{value}</strong>
    </div>
  );
}

function conceptTypeLabel(type: KnowledgeConcept["type"]) {
  const labels = {
    technology: m.knowledge_type_technology,
    component: m.knowledge_type_component,
    problem: m.knowledge_type_problem,
    solution: m.knowledge_type_solution,
    domain_term: m.knowledge_type_domain_term,
    practice: m.knowledge_type_practice,
  } as const;
  return labels[type]();
}

function conceptStatusLabel(status: KnowledgeConcept["status"]) {
  const labels = {
    active: m.knowledge_status_active,
    proposed: m.knowledge_status_proposed,
    rejected: m.knowledge_status_rejected,
    merged: m.knowledge_status_merged,
  } as const;
  return labels[status]();
}

function salienceLabel(salience: "primary" | "secondary" | "passing") {
  return salience === "primary"
    ? m.knowledge_salience_primary()
    : salience === "secondary"
      ? m.knowledge_salience_secondary()
      : m.knowledge_salience_passing();
}

function showActionError(error: Error) {
  toast.error(error.message || m.knowledge_action_failed());
}
