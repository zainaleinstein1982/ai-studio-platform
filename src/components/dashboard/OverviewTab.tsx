import { api } from "@/convex/_generated/api";
import {
  formatBytes,
  formatDollars,
  healthSummary,
  queuePressure,
} from "@/convex/dashboard/core";
import { planById } from "@/convex/catalog";
import { useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  Clock,
  CreditCard,
  Database,
  KeyRound,
  Radio,
  Server,
  Users,
  Wallet,
} from "lucide-react";
import { SectionTitle, StatCard, fmtShortTime, providerLabel } from "./bits";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import type { ConsoleTab } from "@/pages/Dashboard";
import type { FeedItemLike } from "@/convex/dashboard/core";

const STORAGE_CAP_BYTES = 2 * 1024 * 1024 * 1024; // simulated 2 GB workspace
const LIVE_ITEM_MS = 7_000; // estimated wall time for in-flight items

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string; pulse: boolean }> = {
  queued: {
    label: "Queued",
    cls: "border-chart-5/50 bg-chart-5/10 text-chart-5",
    dot: "bg-chart-5",
    pulse: true,
  },
  processing: {
    label: "Processing",
    cls: "border-chart-4/50 bg-chart-4/10 text-chart-4",
    dot: "bg-chart-4",
    pulse: true,
  },
  completed: {
    label: "Completed",
    cls: "border-chart-2/50 bg-chart-2/10 text-chart-2",
    dot: "bg-chart-2",
    pulse: false,
  },
  failed: {
    label: "Failed",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    pulse: false,
  },
  dead: {
    label: "Dead letter",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    pulse: false,
  },
  cancelled: {
    label: "Cancelled",
    cls: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    pulse: false,
  },
};

function LiveBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.queued;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium",
        cfg.cls,
      )}
    >
      <span className={cn("size-1.5 rounded-full", cfg.dot, cfg.pulse && "animate-pulse")} />
      {cfg.label}
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = { gateway: "Gateway", sdk: "SDK", queue: "Queue" };

function sourceTone(source: string): string {
  return source === "gateway"
    ? "border-chart-1/40 bg-chart-1/10 text-chart-1"
    : source === "sdk"
      ? "border-chart-3/40 bg-chart-3/10 text-chart-3"
      : "border-chart-5/40 bg-chart-5/10 text-chart-5";
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-[11.5px] shadow-sm">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-1.5 rounded-full" style={{ background: String(p.fill) }} />
          {p.dataKey === "credits" ? "Credits" : "Requests"}
          <span className="ml-auto pl-3 font-mono text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mission Control                                                     */
/* ------------------------------------------------------------------ */

export function OverviewTab({ onNavigate }: { onNavigate: (tab: ConsoleTab) => void }) {
  const view = useQuery(api.dashboard.missionControl);
  const now = useNow(1000);

  if (!view) {
    return (
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-lg" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-[260px] rounded-lg" />
          <Skeleton className="h-[260px] rounded-lg" />
        </div>
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  const plan = planById(view.plan);
  const stats = view.stats;
  const hs = healthSummary(view.health);
  const qStats = view.queue?.stats;
  const pressure = queuePressure(
    { pending: qStats?.queued ?? 0, processing: qStats?.processing ?? 0, retrying: qStats?.failed ?? 0, dead: qStats?.dead ?? 0 },
    view.queue?.workers.length ?? 4,
  );
  const successRate =
    stats && stats.totalRequests > 0
      ? Math.round((stats.completedRequests / stats.totalRequests) * 100)
      : 0;
  const storagePct =
    ((view.storage?.totalBytes ?? 0) / STORAGE_CAP_BYTES) * 100;
  const chartData = (stats?.byDay ?? []).map((d) => ({ name: d.label, credits: d.credits, requests: d.requests }));
  const providerMax = Math.max(1, ...(stats?.byProvider ?? []).map((p) => p.credits));

  const systemTone =
    hs.down > 0
      ? { label: `${hs.down} provider${hs.down > 1 ? "s" : ""} down`, cls: "text-destructive", dot: "bg-destructive" }
      : hs.degraded > 0
        ? { label: `${hs.degraded} at risk`, cls: "text-chart-4", dot: "bg-chart-4" }
        : { label: "All systems operational", cls: "text-chart-2", dot: "bg-chart-2" };

  const timeStr = new Date(now).toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
  const dateStr = new Date(now).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const idle = (stats?.totalRequests ?? 0) === 0 && view.keys.total === 0 && view.feed.length === 0;

  const inFlightPct = (at: number) =>
    Math.min(100, Math.max(5, Math.round(((now - at) / LIVE_ITEM_MS) * 100)));

  const miniCards = [
    {
      icon: KeyRound,
      label: "API Keys",
      value: String(view.keys.active),
      sub: `${view.keys.total} total · ${view.keys.revoked} revoked`,
      to: "keys" as ConsoleTab,
    },
    {
      icon: Users,
      label: "Team",
      value: String(view.team.count),
      sub:
        view.team.platform != null
          ? `${view.team.platform} platform users · admin view`
          : "members · org roles",
      to: "account" as ConsoleTab,
    },
    {
      icon: Database,
      label: "Storage",
      value: String(view.storage?.totalObjects ?? 0),
      sub: `${view.storage?.cacheEntries ?? 0} cache entries · ${view.storage?.cacheHits ?? 0} hits`,
      to: "storage" as ConsoleTab,
    },
    {
      icon: CreditCard,
      label: "Billing",
      value: `${view.revenue.spentThisMonth.toLocaleString()} cr`,
      sub: `${formatDollars(view.revenue.perCredit)}/credit · ${plan?.name ?? "Starter"} plan`,
      to: "billing" as ConsoleTab,
    },
  ];

  return (
    <div className="space-y-8">
      {/* ── command strip ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background">
            <Radio className={cn("size-4", view.live.total > 0 ? "text-chart-4" : "text-muted-foreground")} />
          </span>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Mission Control · {dateStr}
            </p>
            <p className="mt-0.5 font-display text-2xl font-light tracking-tight text-foreground">
              {timeStr} <span className="text-[12px] font-normal text-muted-foreground">UTC</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px]">
            <span className={cn("size-1.5 rounded-full", systemTone.dot, hs.down === 0 && hs.degraded === 0 ? "" : "animate-pulse")} />
            <span className={systemTone.cls}>{systemTone.label}</span>
            <span className="text-muted-foreground">· {hs.uptimePct}% uptime</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px] text-muted-foreground">
            <Wallet className="size-3 text-chart-1" />
            {plan?.name ?? "Starter"} plan
          </span>
          <span className="rounded-full border border-chart-1/40 bg-chart-1/10 px-3 py-1.5 font-mono text-[11.5px] text-chart-1">
            {view.credits.toLocaleString()} cr
          </span>
        </div>
      </div>

      {/* first-run banner */}
      {idle && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-card px-5 py-4">
          <div>
            <p className="text-[13px] font-medium text-foreground">The gallery is empty</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Send your first gateway request and watch every panel light up — provider health, the task queue, revenue, and the live feed.
            </p>
          </div>
          <button
            onClick={() => onNavigate("gateway")}
            className="group inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open the gateway
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        </div>
      )}

      {/* ── KPI row ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="Credits remaining"
          value={view.credits.toLocaleString()}
          sub={`${plan?.name ?? "Starter"} · ${formatDollars(view.revenue.perCredit)}/credit`}
          accent
        />
        <StatCard
          label="Revenue"
          value={formatDollars(view.revenue.mrr)}
          sub={`est ${formatDollars(view.revenue.estimated)} this month`}
        />
        <StatCard label="Requests today" value={stats?.requestsToday ?? 0} sub="across all routes" />
        <StatCard
          label="Success rate"
          value={`${successRate}%`}
          sub={`${stats?.completedRequests ?? 0} completed`}
        />
        <StatCard
          label="Live tasks"
          value={view.live.total}
          sub={
            view.live.total > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-chart-4" />
                streaming through 6 pipelines
              </span>
            ) : (
              "in flight · 6 pipelines"
            )
          }
        />
        <StatCard
          label="Storage used"
          value={formatBytes(view.storage?.totalBytes ?? 0)}
          sub={`${view.storage?.totalObjects ?? 0} objects · ${storagePct.toFixed(1)}% of 2 GB`}
        />
      </div>

      {/* ── provider status + task queue ──────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* provider status */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Provider status"
            title="Upstream health"
            right={
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <Server className="size-3.5" />
                {hs.healthy}/{hs.total} healthy
              </span>
            }
          />
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {view.health.map((h) => (
              <div
                key={h.provider}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
                  h.healthy ? "border-border bg-background" : "border-destructive/40 bg-destructive/5",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    h.state === "closed" && "bg-chart-2",
                    h.state === "half_open" && "bg-chart-4",
                    h.state === "open" && "bg-destructive",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-foreground">{h.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {h.state.replace("_", " ")}
                    {h.retryInSec != null && ` · retry ${h.retryInSec}s`}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">
                  {h.successCount} ok · {h.failures} fail
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* task queue */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Task queue"
            title="Worker pool"
            right={
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <Activity className="size-3.5" />
                {qStats?.processing ?? 0} processing · {qStats?.queued ?? 0} queued
              </span>
            }
          />
          <div className="mt-5 space-y-5">
            {/* pool pressure */}
            <div>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">Pool pressure</span>
                <span className={cn("font-mono", pressure > 0.7 ? "text-destructive" : "text-foreground")}>
                  {Math.round(pressure * 100)}%
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    pressure > 0.7 ? "bg-destructive" : "bg-chart-4",
                  )}
                  style={{ width: `${Math.max(2, pressure * 100)}%` }}
                />
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {(view.queue?.workers ?? []).map((w) => (
                  <span
                    key={w.id}
                    title={`Worker ${w.id} · ${w.busy ? "busy" : "idle"}`}
                    className={cn(
                      "size-2 rounded-full transition-colors",
                      w.busy ? "animate-pulse bg-chart-4" : "bg-border",
                    )}
                  />
                ))}
                <span className="ml-1.5 text-[10.5px] text-muted-foreground">
                  {view.queue?.workers.length ?? 4} worker slots
                </span>
              </div>
            </div>

            {/* per-queue backlog */}
            <div className="space-y-2.5">
              {(view.queue?.byQueue ?? []).map((q) => {
                const queued = q.stats.queued + q.stats.failed;
                const processing = q.stats.processing;
                const total = Math.max(1, queued + processing);
                return (
                  <div key={q.id} className="grid grid-cols-[92px_1fr_auto] items-center gap-3">
                    <span className="truncate text-[11.5px] text-muted-foreground">{q.label}</span>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-border/60">
                      <div
                        className="bg-chart-4 transition-all duration-500"
                        style={{ width: `${(processing / total) * 100}%` }}
                      />
                      <div
                        className="bg-chart-5/70 transition-all duration-500"
                        style={{ width: `${(queued / total) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-[10.5px] text-muted-foreground">
                      {processing}+{queued}
                    </span>
                  </div>
                );
              })}
              {!view.queue?.byQueue.length && (
                <p className="py-3 text-center text-[12px] text-muted-foreground">
                  No queue jobs yet — enqueue one from the Queue tab.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── analytics + usage ─────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-6 xl:col-span-2">
          <SectionTitle
            kicker="Analytics · last 7 days"
            title="Credits & requests"
            right={
              <span className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-chart-1" /> credits
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-chart-4" /> requests
                </span>
              </span>
            }
          />
          <div className="mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barGap={3}>
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
                <Tooltip cursor={{ fill: "oklch(0.92 0.015 84 / 0.5)" }} content={<ChartTooltip />} />
                <Bar dataKey="requests" radius={[3, 3, 0, 0]} fill="oklch(0.6 0.1 210)" maxBarSize={18} />
                <Bar dataKey="credits" radius={[3, 3, 0, 0]} fill="oklch(0.585 0.075 55)" maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* usage by provider */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Usage"
            title="By provider"
            right={
              <span className="font-mono text-[11px] text-muted-foreground">
                {stats?.creditsUsed.toLocaleString() ?? 0} cr
              </span>
            }
          />
          <div className="mt-5 space-y-3">
            {(stats?.byProvider ?? []).slice(0, 6).map((p) => (
              <div key={p.provider}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-muted-foreground">{providerLabel(p.provider)}</span>
                  <span className="font-mono text-foreground">{p.credits} cr</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60">
                  <div
                    className="h-full rounded-full bg-chart-1/80 transition-all duration-700"
                    style={{ width: `${Math.max(2, (p.credits / providerMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {!stats?.byProvider.length && (
              <p className="py-4 text-center text-[12px] text-muted-foreground">
                Provider usage appears after the first completed request.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── module mini-panels ────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {miniCards.map((c) => (
          <button
            key={c.label}
            onClick={() => onNavigate(c.to)}
            className="group rounded-lg border border-border bg-card p-5 text-left transition-all hover:border-foreground/25 hover:bg-accent/40"
          >
            <div className="flex items-center justify-between">
              <c.icon className="size-4 text-muted-foreground transition-colors group-hover:text-chart-1" />
              <ArrowUpRight className="size-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-chart-1" />
            </div>
            <p className="mt-4 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {c.label}
            </p>
            <p className="mt-1 font-display text-2xl font-light tracking-tight text-foreground">{c.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{c.sub}</p>
          </button>
        ))}
      </div>

      {/* ── realtime activity feed ────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="Realtime"
          title="Activity feed"
          right={
            <span className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Clock className="size-3.5" />
              {timeStr} UTC
              {view.live.total > 0 && (
                <span className="inline-flex items-center gap-1.5 text-chart-4">
                  <span className="size-1.5 animate-pulse rounded-full bg-chart-4" />
                  live
                </span>
              )}
            </span>
          }
        />
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {view.feed.length === 0 ? (
            <p className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              Nothing in flight yet — gateway requests, SDK jobs, and queue tasks will stream here in real time.
            </p>
          ) : (
            view.feed.map((item: FeedItemLike) => {
              const inFlight = item.status === "queued" || item.status === "processing";
              return (
                <div key={`${item.source}:${item.id}`} className="px-5 py-3.5 transition-colors hover:bg-card-foreground/[0.02]">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", sourceTone(item.source))}>
                      {SOURCE_LABEL[item.source] ?? item.source}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
                      {item.sub && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">“{item.sub}…”</p>
                      )}
                    </div>
                    {item.credits != null && (
                      <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{item.credits} cr</span>
                    )}
                    <LiveBadge status={item.status} />
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">
                      {fmtShortTime(item.at)}
                    </span>
                  </div>
                  {inFlight && (
                    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full rounded-full bg-chart-4 transition-all duration-1000"
                        style={{ width: `${inFlightPct(item.at)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
