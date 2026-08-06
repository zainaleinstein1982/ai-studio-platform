// STEP 11 · Dashboard — Mission Control surface.
//
// One reactive query that aggregates every module into a single cockpit
// payload: gateway stats · provider health · task queue · storage · API
// keys · team/users · revenue · live in-flight counts per pipeline · a
// merged activity feed. Derived KPI math lives in ./dashboard/core.ts
// (pure + unit-tested); this file only gathers and shapes data.
import { FunctionReturnType } from "convex/server";
import { query } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { KIND_META, PROVIDER_LABEL, planById } from "./catalog";
import { QUEUE_LABEL } from "./queue";
import { mergeFeed, revenueMetrics, type FeedItemLike } from "./dashboard/core";
import type { Id } from "./_generated/dataModel";

type LiveTable =
  | "providerJobs"
  | "text3dTasks"
  | "image3dTasks"
  | "textVideoTasks"
  | "imageVideoTasks";

// Explicit view type — keeps the aggregated query's return type from
// being circularly inferred through its own ctx.runQuery calls.
type GatewayStats = NonNullable<FunctionReturnType<typeof api.gateway.stats>>;
type HealthItem = FunctionReturnType<typeof api.gateway.providerHealth>[number];
type QueueView = NonNullable<FunctionReturnType<typeof api.queue.overview>>;
type StorageView = NonNullable<FunctionReturnType<typeof api.storage.overview>>;
type KeySummaryItem = FunctionReturnType<typeof api.apiKeys.list>[number];

interface MissionControlView {
  now: number;
  plan: string;
  credits: number;
  stats: GatewayStats | null;
  health: HealthItem[];
  queue: {
    stats: QueueView["stats"];
    workers: QueueView["workers"];
    queues: QueueView["queues"];
    byQueue: { id: string; label: string; stats: QueueView["stats"] }[];
  } | null;
  storage: {
    totalObjects: number;
    totalBytes: number;
    cacheEntries: number;
    cacheHits: number;
    evicted: number;
    cdnReady: boolean;
    buckets: { name: string; label: string; count: number; bytes: number; ttlMs: number }[];
  } | null;
  keys: { total: number; active: number; revoked: number };
  team: { count: number; platform: number | null };
  revenue: ReturnType<typeof revenueMetrics>;
  live: { gateway: number; sdk: number; text3d: number; image3d: number; video: number; total: number };
  feed: FeedItemLike[];
}

export const missionControl = query({
  args: {},
  handler: async (ctx): Promise<MissionControlView | null> => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const now = Date.now();

    const stats: GatewayStats | null = await ctx.runQuery(api.gateway.stats);
    const health: HealthItem[] = await ctx.runQuery(api.gateway.providerHealth);
    const queue: QueueView | null = await ctx.runQuery(api.queue.overview);
    const storage: StorageView | null = await ctx.runQuery(api.storage.overview);
    const keys: KeySummaryItem[] = await ctx.runQuery(api.apiKeys.list);

    /* ---- revenue: plan MRR + credits burned this calendar month ---- */
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const recentRequests = await ctx.db
      .query("gatewayRequests")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(500);
    const spentThisMonth = recentRequests
      .filter((r) => r.status === "completed" && r.createdAt >= startOfMonth.getTime())
      .reduce((sum, r) => sum + r.credits, 0);
    const plan = planById(user.plan ?? "starter") ?? planById("starter")!;
    const revenue = revenueMetrics(plan, spentThisMonth);

    /* ---- API keys summary ---- */
    const keyList = keys ?? [];
    const activeKeys = keyList.filter((k) => !k.revokedAt);
    const keySummary = {
      total: keyList.length,
      active: activeKeys.length,
      revoked: keyList.length - activeKeys.length,
    };

    /* ---- team members + (admin only) platform users ---- */
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const memberIds = new Set<string>([user._id]);
    for (const m of memberships) {
      const roster = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org", (q) => q.eq("orgId", m.orgId))
        .collect();
      for (const r of roster) memberIds.add(r.userId);
    }
    const platformUsers =
      user.role === "admin" ? (await ctx.db.query("users").take(500)).length : null;

    /* ---- live in-flight tasks per pipeline ---- */
    async function activeCount(table: LiveTable, userId: Id<"users">): Promise<number> {
      const docs = await ctx.db
        .query(table)
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .order("desc")
        .take(100);
      return docs.filter(
        (d) => d.status === "queued" || d.status === "processing",
      ).length;
    }
    const [sdkLive, t3dLive, i3dLive, tvLive, ivLive] = await Promise.all([
      activeCount("providerJobs", user._id),
      activeCount("text3dTasks", user._id),
      activeCount("image3dTasks", user._id),
      activeCount("textVideoTasks", user._id),
      activeCount("imageVideoTasks", user._id),
    ]);
    const gatewayLive = stats?.inFlight ?? 0;

    /* ---- merged activity feed ---- */
    const [reqs, jobs, jobsInQueue] = await Promise.all([
      ctx.db
        .query("gatewayRequests")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(8),
      ctx.db
        .query("providerJobs")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(4),
      ctx.db
        .query("queueJobs")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(4),
    ]);
    const feed: FeedItemLike[] = [
      ...reqs.map((r) => ({
        id: r._id,
        source: "gateway",
        at: r.createdAt,
        status: r.status,
        title: `${KIND_META[r.kind].label} · ${PROVIDER_LABEL[r.provider] ?? r.provider}/${r.model}`,
        sub: r.prompt.slice(0, 64),
        credits: r.credits,
      })),
      ...jobs.map((j) => ({
        id: j._id,
        source: "sdk",
        at: j.createdAt,
        status: j.status,
        title: `${PROVIDER_LABEL[j.provider] ?? j.provider} · ${j.model}`,
        sub: j.prompt.slice(0, 64),
      })),
      ...jobsInQueue.map((q) => ({
        id: q._id,
        source: "queue",
        at: q.createdAt,
        status: q.status,
        title: `${QUEUE_LABEL[q.queue] ?? q.queue} queue`,
        sub: q.payload.slice(0, 64),
      })),
    ];

    return {
      now,
      plan: user.plan ?? "starter",
      credits: user.credits ?? 0,
      stats,
      health: health ?? [],
      queue: queue
        ? {
            stats: queue.stats,
            workers: queue.workers,
            queues: queue.queues,
            byQueue: queue.queues.map((q) => ({
              id: q.id,
              label: q.label,
              stats: queue.byQueue[q.id] ?? {
                queued: 0,
                delayed: 0,
                processing: 0,
                completed: 0,
                failed: 0,
                dead: 0,
                inFlight: 0,
                avgWaitMs: null,
                successRate: null,
              },
            })),
          }
        : null,
      storage: storage
        ? {
            totalObjects: storage.totalObjects,
            totalBytes: storage.totalBytes,
            cacheEntries: storage.cacheEntries,
            cacheHits: storage.cacheHits,
            evicted: storage.evicted,
            cdnReady: storage.cdn.ready,
            buckets: storage.buckets.map((b) => ({
              name: b.name,
              label: b.label,
              count: b.count,
              bytes: b.bytes,
              ttlMs: b.ttlMs,
            })),
          }
        : null,
      keys: keySummary,
      team: { count: memberIds.size, platform: platformUsers },
      revenue,
      live: {
        gateway: gatewayLive,
        sdk: sdkLive,
        text3d: t3dLive,
        image3d: i3dLive,
        video: tvLive + ivLive,
        total: gatewayLive + sdkLive + t3dLive + i3dLive + tvLive + ivLive,
      },
      feed: mergeFeed(feed, 12),
    };
  },
});
