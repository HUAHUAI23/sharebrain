// 组织知识治理的五个 URL 驱动视图，并统一权限提示、重索引与设置页导航。
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
import { Button } from "@sharebrain/ui/components/button";
import { NotionToolbar } from "@sharebrain/ui/components/notion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  GitFork,
  RefreshCw,
  Scale,
  Sparkles,
  Tags,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import { KnowledgeAnalyticsPane } from "./knowledge-analytics-pane";
import { KnowledgeConceptsPane } from "./knowledge-concepts-pane";
import { KnowledgeGraphPane } from "./knowledge-graph-pane";
import { KnowledgeProposalsPane } from "./knowledge-proposals-pane";
import { KnowledgeSourcesPane } from "./knowledge-sources-pane";
import type {
  KnowledgeSearchChange,
  KnowledgeSettingsSearch,
  KnowledgeSettingsView,
} from "./knowledge-management.types";

import type { MeResponse } from "@sharebrain/contracts";

const views = [
  ["concepts", m.knowledge_nav_concepts, Tags],
  ["proposals", m.knowledge_nav_proposals, Sparkles],
  ["weights", m.knowledge_nav_weights, Scale],
  ["graph", m.knowledge_nav_graph, GitFork],
  ["analytics", m.knowledge_nav_analytics, BarChart3],
] as const;

export function KnowledgeManagementView({
  search,
  onSearchChange,
}: {
  search: KnowledgeSettingsSearch;
  onSearchChange: KnowledgeSearchChange;
}) {
  const navigate = useNavigate();
  const [reindexOpen, setReindexOpen] = useState(false);
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiRequest<MeResponse>("/api/me"),
  });
  const isAdmin = me.data?.role === "admin";
  const reindex = useMutation({
    mutationFn: () => apiRequest<{ enqueued: number }>("/api/knowledge/reindex", {
      method: "POST",
      body: { targetType: "all" },
    }),
    onSuccess(result) {
      setReindexOpen(false);
      toast.success(m.knowledge_reindex_queued({ count: result.enqueued }));
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : m.knowledge_action_failed());
    },
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <NotionToolbar className="justify-between px-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.common_back_home()}
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeft />
        </Button>
        <AccountMenu />
      </NotionToolbar>
      <div className="mx-auto grid w-full max-w-[1440px] gap-6 px-6 py-8 max-[640px]:px-3 max-[640px]:py-5">
        <header className="flex min-w-0 items-start justify-between gap-4 max-[640px]:items-center">
          <div className="min-w-0">
            <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-normal max-[560px]:text-2xl">
              {m.knowledge_title()}
            </h1>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
              {m.knowledge_description()}
            </p>
          </div>
          {isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => setReindexOpen(true)}>
              <RefreshCw />
              <span className="max-[480px]:sr-only">{m.knowledge_reindex()}</span>
            </Button>
          ) : null}
        </header>

        <nav className="flex min-h-10 max-w-full gap-1 overflow-x-auto border-b border-border" aria-label={m.knowledge_title()}>
          {views.map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              data-active={search.view === value}
              className="relative inline-flex h-10 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0 data-[active=true]:after:opacity-100"
              onClick={() => onSearchChange({ view: value as KnowledgeSettingsView })}
            >
              <Icon className="size-4" />
              {label()}
            </button>
          ))}
        </nav>

        {!me.isLoading && !isAdmin ? (
          <p className="m-0 border-l-2 border-border px-3 py-1 text-xs leading-5 text-muted-foreground">
            {m.knowledge_read_only()}
          </p>
        ) : null}

        {search.view === "concepts" ? (
          <KnowledgeConceptsPane search={search} onSearchChange={onSearchChange} isAdmin={isAdmin} />
        ) : null}
        {search.view === "proposals" ? (
          <KnowledgeProposalsPane search={search} onSearchChange={onSearchChange} isAdmin={isAdmin} />
        ) : null}
        {search.view === "weights" ? (
          <KnowledgeSourcesPane search={search} onSearchChange={onSearchChange} isAdmin={isAdmin} />
        ) : null}
        {search.view === "graph" ? (
          <KnowledgeGraphPane search={search} onSearchChange={onSearchChange} />
        ) : null}
        {search.view === "analytics" ? <KnowledgeAnalyticsPane /> : null}
      </div>

      <AlertDialog open={reindexOpen} onOpenChange={setReindexOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{m.knowledge_reindex_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.knowledge_reindex_confirm_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction disabled={reindex.isPending} onClick={() => reindex.mutate()}>
              {m.knowledge_reindex()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
