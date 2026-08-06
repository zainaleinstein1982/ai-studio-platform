// STEP 11 · Dashboard — pure derived metrics for Mission Control.
//
// Everything here is parsing + arithmetic only: no server imports, no
// Date.now() (callers pass timestamps), fully deterministic and
// unit-tested in core.test.ts. The Convex surface (./dashboard.ts)
// feeds raw data in; these functions turn it into KPI numbers.
//
//   revenue:      plan price → MRR, credit value, spend-based estimate
//   health:       provider circuit states → summary + uptime %
//   queue:        pending/retrying vs. worker capacity → pressure 0..1
//   storage:      utilization % + human byte formatting
//   feed:         merge + rank activity items into a single live feed

export interface PlanLike {
  id: string;
  price: string; // e.g. "$29"
  credits: number; // monthly credit allowance
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** "$29" → 29 · "$149" → 149 · "$0" → 0 (strip symbols and commas). */
export function parsePriceDollars(price: string): number {
  const n = Number.parseFloat(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Dollar value of a single credit on a plan (price ÷ monthly allowance). */
export function creditValueDollars(plan: PlanLike): number {
  if (plan.credits <= 0) return 0;
  return round2(parsePriceDollars(plan.price) / plan.credits);
}

export interface RevenueMetrics {
  mrr: number; // monthly recurring revenue — the plan price
  perCredit: number; // $ value of one credit
  spentThisMonth: number; // credits burned this calendar month
  estimated: number; // spend this month × credit value
}

export function revenueMetrics(plan: PlanLike, spentThisMonth: number): RevenueMetrics {
  const perCredit = creditValueDollars(plan);
  return {
    mrr: parsePriceDollars(plan.price),
    perCredit,
    spentThisMonth,
    estimated: round2(spentThisMonth * perCredit),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatDollars(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Provider health                                                     */
/* ------------------------------------------------------------------ */

export interface HealthLike {
  healthy: boolean;
  state: string; // "closed" | "half_open" | "open"
}

export interface HealthSummary {
  total: number;
  healthy: number;
  degraded: number; // half_open — one failure from tripping
  down: number; // open — rejecting calls until cooldown
  uptimePct: number;
}

/** Aggregate breaker states into one health summary + uptime percentage. */
export function healthSummary(health: HealthLike[]): HealthSummary {
  let healthy = 0;
  let degraded = 0;
  let down = 0;
  for (const h of health) {
    if (h.state === "open") down += 1;
    else if (h.state === "half_open") degraded += 1;
    else healthy += 1;
  }
  const total = health.length;
  // Half-open counts as 50% availability — it is probing, not serving.
  const uptimePct =
    total > 0 ? Math.round(((healthy + degraded * 0.5) / total) * 100) : 100;
  return { total, healthy, degraded, down, uptimePct };
}

/* ------------------------------------------------------------------ */
/* Queue pressure                                                      */
/* ------------------------------------------------------------------ */

export interface QueueStatsLike {
  pending: number;
  processing: number;
  retrying: number;
  dead: number;
}

/**
 * How loaded the worker pool is, 0..1. Compares queued-but-not-running
 * work (pending + retrying) against available capacity — a burst of
 * backpressured jobs pushes the needle toward 1.
 */
export function queuePressure(stats: QueueStatsLike, concurrency = 4): number {
  const active = stats.pending + stats.retrying;
  const cap = Math.max(1, concurrency);
  return Math.min(1, active / (active + cap));
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export function storageUtilizationPct(bytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.round((bytes / totalBytes) * 100));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

export interface FeedItemLike {
  id: string;
  source: string; // gateway | sdk | queue
  at: number;
  status: string;
  title: string;
  sub?: string;
  credits?: number;
}

/**
 * Merge heterogeneous activity streams into one feed, sorted newest
 * first and capped at `limit`. Deterministic on equal timestamps.
 */
export function mergeFeed(items: FeedItemLike[], limit = 10): FeedItemLike[] {
  return [...items]
    .sort((a, b) => b.at - a.at || a.source.localeCompare(b.source) || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, limit));
}
