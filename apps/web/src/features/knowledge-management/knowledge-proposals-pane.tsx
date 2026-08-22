// 提供三类知识提议队列、跨行选择和管理员批量确认/拒绝操作。
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
import { Checkbox } from "@sharebrain/ui/components/checkbox";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitCompareArrows, Link2, Tags, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type {
  KnowledgeProposalKind,
  KnowledgeSearchChange,
  KnowledgeSettingsSearch,
} from "./knowledge-management.types";

import type { KnowledgeProposal } from "@sharebrain/contracts";

const proposalKinds = [
  ["concept", m.knowledge_proposal_concepts, Tags],
  ["relation", m.knowledge_proposal_relations, Link2],
  ["merge", m.knowledge_proposal_merges, GitCompareArrows],
] as const;

export function KnowledgeProposalsPane({
  search,
  onSearchChange,
  isAdmin,
}: {
  search: KnowledgeSettingsSearch;
  onSearchChange: KnowledgeSearchChange;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<"accept" | "reject" | null>(null);
  const proposals = useQuery({
    queryKey: queryKeys.knowledgeProposals(search.proposalKind),
    queryFn: () => apiRequest<{ items: KnowledgeProposal[] }>(
      `/api/knowledge/proposals?kind=${search.proposalKind}`,
    ),
  });
  const items = proposals.data?.items ?? [];

  useEffect(() => setSelected(new Set()), [search.proposalKind]);

  const decide = useMutation({
    mutationFn: (nextDecision: "accept" | "reject") =>
      apiRequest<{ ok: boolean; count: number }>("/api/knowledge/proposals/batch", {
        method: "POST",
        body: {
          kind: search.proposalKind,
          ids: [...selected],
          decision: nextDecision,
        },
      }),
    async onSuccess(result) {
      setDecision(null);
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge", "proposals"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge", "concepts"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge", "graph"] }),
      ]);
      toast.success(m.knowledge_proposal_updated({ count: result.count }));
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : m.knowledge_action_failed());
    },
  });
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <section className="grid gap-4">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {proposalKinds.map(([kind, label, Icon]) => (
            <button
              type="button"
              key={kind}
              data-active={search.proposalKind === kind}
              className="inline-flex h-10 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground data-[active=true]:text-foreground"
              onClick={() => onSearchChange({ proposalKind: kind as KnowledgeProposalKind })}
            >
              <Icon className="size-4" />
              {label()}
            </button>
          ))}
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 gap-1 pb-1">
            <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setDecision("reject")}>
              <X />
              <span className="max-[520px]:sr-only">{m.knowledge_reject()}</span>
            </Button>
            <Button size="sm" disabled={selected.size === 0} onClick={() => setDecision("accept")}>
              <Check />
              <span className="max-[520px]:sr-only">{m.knowledge_accept()}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {isAdmin && items.length > 0 ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => setSelected(checked === true
              ? new Set(items.map((item) => item.id))
              : new Set())}
          />
          {m.knowledge_select_all()}
        </label>
      ) : null}

      {proposals.isLoading ? <NotionEmpty>{m.common_loading()}</NotionEmpty> : null}
      {proposals.error ? <NotionEmpty>{m.knowledge_load_failed()}</NotionEmpty> : null}
      {!proposals.isLoading && !proposals.error && items.length === 0 ? (
        <NotionEmpty className="min-h-72">{m.knowledge_proposals_empty()}</NotionEmpty>
      ) : null}
      <div className="divide-y divide-border border-y border-border">
        {items.map((proposal) => (
          <label
            key={proposal.id}
            className="grid min-w-0 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 px-2 py-3.5 hover:bg-accent/40 max-[560px]:grid-cols-[20px_minmax(0,1fr)]"
          >
            {isAdmin ? (
              <Checkbox
                className="mt-0.5"
                checked={selected.has(proposal.id)}
                onCheckedChange={(checked) => setSelected((current) => {
                  const next = new Set(current);
                  if (checked === true) next.add(proposal.id);
                  else next.delete(proposal.id);
                  return next;
                })}
              />
            ) : <span />}
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="break-words text-[13px] font-medium">{proposal.title}</strong>
                <Badge variant="outline" className="rounded-sm">{proposalKindLabel(proposal.kind)}</Badge>
              </span>
              {proposal.description ? (
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{proposal.description}</span>
              ) : null}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {new Date(proposal.createdAt).toLocaleDateString()}
              </span>
            </span>
            <Evidence evidence={proposal.evidence} />
          </label>
        ))}
      </div>

      <AlertDialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision === "accept" ? m.knowledge_accept_confirm_title() : m.knowledge_reject_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.knowledge_proposal_confirm_description({ count: selected.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant={decision === "reject" ? "destructive" : "default"}
              disabled={decide.isPending}
              onClick={() => decision && decide.mutate(decision)}
            >
              {decision === "accept" ? m.knowledge_accept() : m.knowledge_reject()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).slice(0, 3);
  if (entries.length === 0) return null;
  return (
    <span className="grid max-w-56 gap-0.5 text-right text-[10px] text-muted-foreground max-[560px]:col-start-2 max-[560px]:max-w-none max-[560px]:text-left">
      {entries.map(([key, value]) => (
        <span className="truncate" key={key}>{key}: {String(value)}</span>
      ))}
    </span>
  );
}

function proposalKindLabel(kind: KnowledgeProposal["kind"]) {
  return kind === "concept"
    ? m.knowledge_proposal_concept()
    : kind === "relation"
      ? m.knowledge_proposal_relation()
      : m.knowledge_proposal_merge();
}
