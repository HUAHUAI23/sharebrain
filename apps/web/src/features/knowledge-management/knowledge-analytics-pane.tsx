// 汇总回答反馈、范围错误趋势和高频引用来源，供管理员复盘检索质量。
import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Quote, ThumbsDown, ThumbsUp } from "lucide-react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type { KnowledgeAnalytics } from "./knowledge-management.types";

export function KnowledgeAnalyticsPane() {
  const analytics = useQuery({
    queryKey: queryKeys.knowledgeAnalytics,
    queryFn: () => apiRequest<KnowledgeAnalytics>("/api/knowledge/analytics"),
  });
  if (analytics.isLoading) return <NotionEmpty className="min-h-96">{m.common_loading()}</NotionEmpty>;
  if (analytics.error || !analytics.data) return <NotionEmpty className="min-h-96">{m.knowledge_load_failed()}</NotionEmpty>;
  const total = analytics.data.feedback.up + analytics.data.feedback.down;
  const approval = total === 0 ? 0 : Math.round((analytics.data.feedback.up / total) * 100);
  const feedbackByTier = completeFeedbackTiers(analytics.data.feedbackByTier);
  const trend = completeTrend(analytics.data.wrongProjectTrend);
  const maxTrend = Math.max(1, ...trend.map((item) => item.count));

  return (
    <section className="grid gap-8">
      <div className="grid grid-cols-4 divide-x divide-border border-y border-border py-4 max-[760px]:grid-cols-2 max-[760px]:gap-y-4 max-[760px]:divide-x-0 max-[460px]:grid-cols-1">
        <AnalyticsMetric icon={ThumbsUp} label={m.knowledge_feedback_up()} value={analytics.data.feedback.up} />
        <AnalyticsMetric icon={ThumbsDown} label={m.knowledge_feedback_down()} value={analytics.data.feedback.down} />
        <AnalyticsMetric icon={Quote} label={m.knowledge_approval_rate()} value={`${approval}%`} />
        <AnalyticsMetric icon={AlertTriangle} label={m.knowledge_wrong_project()} value={analytics.data.feedback.wrongProject} />
      </div>

      <section className="grid gap-3">
        <h2 className="m-0 text-sm font-semibold">{m.knowledge_feedback_by_tier()}</h2>
        <div className="divide-y divide-border border-y border-border">
          {feedbackByTier.map((item) => {
            const itemTotal = item.up + item.down;
            const itemApproval = itemTotal === 0 ? 0 : Math.round((item.up / itemTotal) * 100);
            return (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5" key={item.tier}>
                <strong className="truncate text-[13px] font-medium">{tierLabel(item.tier)}</strong>
                <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3.5" />{item.up}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsDown className="size-3.5" />{item.down}</span>
                  <span className="w-10 text-right text-foreground">{itemApproval}%</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold">{m.knowledge_wrong_project_trend()}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{m.knowledge_last_14_days()}</p>
        </div>
        <div className="grid h-44 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1 border-b border-border px-2 pt-4" aria-label={m.knowledge_wrong_project_trend()}>
          {trend.map((item) => (
            <div key={item.date} className="group relative flex h-full items-end justify-center">
              <div
                className="w-full max-w-6 bg-amber-500/75 transition-colors group-hover:bg-amber-500"
                style={{ height: `${Math.max(item.count === 0 ? 2 : 8, (item.count / maxTrend) * 100)}%` }}
              />
              <span className="sr-only">{item.date}: {item.count}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatTrendDate(trend[0]?.date)}</span>
          <span>{formatTrendDate(trend.at(-1)?.date)}</span>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-sm font-semibold">{m.knowledge_top_sources()}</h2>
        <div className="divide-y divide-border border-y border-border">
          {analytics.data.topSources.map((source, index) => (
            <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-2.5" key={`${source.sourceType}:${source.sourceId}`}>
              <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                <strong className="block truncate text-[13px] font-medium">{source.title}</strong>
                <span className="block text-[10px] text-muted-foreground">{source.sourceType}</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {m.knowledge_citation_count({ count: source.citations })}
              </span>
            </div>
          ))}
          {analytics.data.topSources.length === 0 ? (
            <p className="py-4 text-xs text-muted-foreground">{m.knowledge_analytics_empty()}</p>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function AnalyticsMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ThumbsUp;
  label: string;
  value: string | number;
}) {
  return (
    <div className="grid gap-2 px-5 first:pl-0 last:pr-0 max-[760px]:px-0">
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{label}</span>
      <strong className="text-2xl font-semibold tabular-nums">{value}</strong>
    </div>
  );
}

function completeTrend(items: KnowledgeAnalytics["wrongProjectTrend"]) {
  const byDate = new Map(items.map((item) => [item.date, item.count]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: byDate.get(key) ?? 0 };
  });
}

function formatTrendDate(value?: string) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

type FeedbackTier = NonNullable<KnowledgeAnalytics["feedbackByTier"]>[number];

function completeFeedbackTiers(items: KnowledgeAnalytics["feedbackByTier"]) {
  const byTier = new Map((items ?? []).map((item) => [item.tier, item]));
  return (["active_project", "tenant_global", "graph_expanded"] as const).map(
    (tier): FeedbackTier => byTier.get(tier) ?? { tier, up: 0, down: 0 },
  );
}

function tierLabel(tier: FeedbackTier["tier"]) {
  return tier === "active_project"
    ? m.chat_tier_active()
    : tier === "graph_expanded"
      ? m.chat_tier_graph()
      : m.chat_tier_global();
}
