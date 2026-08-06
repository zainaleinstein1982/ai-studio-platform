import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EmptyState,
  KindTag,
  SectionTitle,
  StatCard,
  StatusBadge,
  fmtMs,
  fmtShortTime,
  kindLabel,
  providerLabel,
} from "./bits";
import { Skeleton } from "@/components/ui/skeleton";
import { planById } from "@/convex/catalog";
import { ArrowUpRight } from "lucide-react";
import type { ConsoleTab } from "@/pages/Dashboard";

export function OverviewTab({ onNavigate }: { onNavigate: (tab: ConsoleTab) => void }) {
  const stats = useQuery(api.gateway.stats);
  const recent = useQuery(api.gateway.list, { limit: 6 });

  if (!stats) {
    return (
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  const plan = planById(stats.plan);
  const successRate =
    stats.totalRequests > 0
      ? Math.round((stats.completedRequests / stats.totalRequests) * 100)
      : 0;
  const chartData = stats.byDay.map((d) => ({ name: d.label, credits: d.credits }));

  if (stats.totalRequests === 0) {
    return (
      <EmptyState
        title="The gallery is empty"
        body="Your first gateway call will appear here — pick a route in the Gateway, send a request, and watch it flow through the queue to the provider."
        actionLabel="Open the gateway"
        onAction={() => onNavigate("gateway")}
      />
    );
  }

  return (
    <div className="grid gap-8">
      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Credits remaining"
          value={stats.credits.toLocaleString()}
          sub={`${plan ? `${plan.name} plan · ${plan.price}/mo` : "Starter plan"}`}
          accent
        />
        <StatCard label="Requests today" value={stats.requestsToday} sub="across all routes" />
        <StatCard label="Success rate" value={`${successRate}%`} sub={`${stats.completedRequests} completed`} />
        <StatCard label="Avg latency" value={fmtMs(stats.avgLatency)} sub="provider round trip" />
      </div>

      {/* chart */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Usage · last 7 days"
          title="Credits spent"
          right={
            <span className="text-[11.5px] text-muted-foreground">
              {stats.creditsUsed.toLocaleString()} credits total
            </span>
          }
        />
        <div className="mt-6 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "oklch(0.52 0.016 75)" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "oklch(0.52 0.016 75)" }}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "oklch(0.92 0.015 84 / 0.5)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid oklch(0.885 0.011 85)",
                  background: "oklch(0.992 0.004 90)",
                  fontSize: 12,
                  fontFamily: "Inter, sans-serif",
                }}
                formatter={(value: number | string) => [`${value} credits`, "Spent"]}
              />
              <Bar dataKey="credits" radius={[3, 3, 0, 0]} fill="oklch(0.585 0.075 55)" maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* recent */}
      <div>
        <SectionTitle
          kicker="Ledger"
          title="Recent requests"
          right={
            <button
              onClick={() => onNavigate("history")}
              className="group inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          }
        />
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {(recent ?? []).map((r) => (
            <div
              key={r._id}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 transition-colors hover:bg-card-foreground/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {kindLabel(r.kind)}
                  <span className="mx-2 text-muted-foreground/60">·</span>
                  <span className="font-normal text-muted-foreground">
                    {providerLabel(r.provider)} / {r.model}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtShortTime(r.createdAt)}</p>
              </div>
              <KindTag kind={r.kind} />
              <StatusBadge status={r.status} />
              <span className="w-16 text-right font-mono text-[12px] text-muted-foreground">
                {r.credits} cr
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
