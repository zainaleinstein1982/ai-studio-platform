// STEP 10 · Queue system — Convex surface.
//
// Redis/Celery-style priority queue: enqueue (priority + delay) → scheduler
// tick → worker claim (concurrency pool) → simulated processing → retry
// with exponential backoff → completed | dead letter queue.
// Decision logic lives in ./queue/core.ts (pure + unit-tested); this file
// persists jobs per user, drives the scheduler worker, and exposes the
// console API. In production the scheduler tick maps to a Celery beat
// schedule and the workers to Celery worker processes consuming a Redis
// priority list.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import {
  DEFAULT_QUEUE_CONFIG,
  advanceJob,
  claimNext,
  enqueueJob,
  queueStats,
  requeueJob,
  simulateOutcome,
  type QueueJob,
  type QueuePriority,
} from "./queue/core";
import type { Doc, Id } from "./_generated/dataModel";

type QueueJobDoc = Doc<"queueJobs">;

export const QUEUE_IDS = ["gateway", "text3d", "image3d", "video", "sdk", "storage"] as const;
export const QUEUE_LABEL: Record<string, string> = {
  gateway: "Gateway",
  text3d: "Text → 3D",
  image3d: "Image → 3D",
  video: "Video",
  sdk: "SDK",
  storage: "Storage",
};

function toCoreJob(doc: QueueJobDoc): QueueJob {
  return {
    id: String(doc._id),
    queue: doc.queue,
    priority: doc.priority as QueuePriority,
    status: doc.status,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    payload: doc.payload,
    createdAt: doc.createdAt,
    dueAt: doc.dueAt,
    claimedAt: doc.claimedAt,
    completedAt: doc.completedAt,
    lastError: doc.lastError,
    backoffMs: doc.backoffMs,
    forceFailure: doc.forceFailure,
  };
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Persist a claimed job and schedule its simulated processing. */
async function claimAndSchedule(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number,
): Promise<{ claimed: number; wakeMs: number | null }> {
  const active = await ctx.db
    .query("queueJobs")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect();
  const pool = active.filter(
    (j) => j.status === "queued" || j.status === "failed" || j.status === "processing",
  );
  const inFlight = pool.filter((j) => j.status === "processing").length;

  const { claimed, remaining } = claimNext(pool.map(toCoreJob), now, DEFAULT_QUEUE_CONFIG, inFlight);

  for (const c of claimed) {
    const docId = c.id as Id<"queueJobs">;
    await ctx.db.patch(docId, { status: "processing", claimedAt: now });
    const outcome = simulateOutcome(c);
    await ctx.scheduler.runAfter(outcome.durationMs, api.queue.process, { jobId: docId });
  }

  const stillActive = remaining.filter((j) => j.status === "queued" || j.status === "failed");
  let wakeMs: number | null = null;
  if (claimed.length > 0 || stillActive.length > 0) {
    const nextDue = stillActive.length > 0 ? Math.min(...stillActive.map((j) => j.dueAt)) : now;
    // Poll at a sane cadence; never spin faster than 150ms.
    wakeMs = Math.min(1500, Math.max(150, nextDue - now));
  }
  return { claimed: claimed.length, wakeMs };
}

/* ------------------------------------------------------------------ */
/* Enqueue · scheduler tick                                            */
/* ------------------------------------------------------------------ */

export const enqueue = mutation({
  args: {
    queue: v.string(),
    priority: v.union(v.literal("high"), v.literal("normal"), v.literal("low")),
    payload: v.string(),
    delayMs: v.optional(v.number()),
    forceFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const job = enqueueJob({
      id: `job_${hexId(5)}`,
      queue: QUEUE_LABEL[args.queue] ? args.queue : "gateway",
      priority: args.priority,
      payload: args.payload,
      createdAt: now,
      delayMs: args.delayMs,
      forceFailure: args.forceFailure,
    });
    const jobId = await ctx.db.insert("queueJobs", {
      userId: user._id,
      queue: job.queue,
      priority: job.priority,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      payload: job.payload,
      createdAt: job.createdAt,
      dueAt: job.dueAt,
      backoffMs: job.backoffMs,
      forceFailure: job.forceFailure,
    });
    await ctx.scheduler.runAfter(400, api.queue.tick, { userId: user._id });
    return { jobId, dueAt: job.dueAt };
  },
});

/**
 * Scheduler worker — claims due jobs up to the concurrency pool and keeps
 * itself alive while work remains. Runs as a scheduled function, so the
 * user id is passed explicitly.
 */
export const tick = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const { wakeMs } = await claimAndSchedule(ctx, userId, now);
    if (wakeMs !== null) {
      await ctx.scheduler.runAfter(wakeMs, api.queue.tick, { userId });
    }
  },
});

/** Resolve one claimed job: simulate the work, then complete / retry / dead-letter. */
export const process = mutation({
  args: { jobId: v.id("queueJobs") },
  handler: async (ctx, { jobId }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.status !== "processing") {
      return { ok: false, reason: "job is not processing" };
    }
    const core = toCoreJob(doc);
    const outcome = simulateOutcome(core);
    const next = advanceJob(core, Date.now(), outcome.ok, DEFAULT_QUEUE_CONFIG, outcome.error);
    await ctx.db.patch(jobId, {
      status: next.status,
      attempts: next.attempts,
      dueAt: next.dueAt,
      backoffMs: next.backoffMs,
      lastError: next.lastError,
      completedAt: next.completedAt,
    });
    return { ok: true, status: next.status, attempts: next.attempts };
  },
});

/* ------------------------------------------------------------------ */
/* Retry · DLQ                                                         */
/* ------------------------------------------------------------------ */

/** Requeue a dead (or failed) job from the dead letter queue. */
export const retry = mutation({
  args: { jobId: v.id("queueJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.userId !== user._id) throw new Error("Job not found");
    if (doc.status !== "dead" && doc.status !== "failed") {
      throw new Error(`Job is ${doc.status} — only dead or failed jobs can be requeued`);
    }
    const next = requeueJob(toCoreJob(doc), Date.now(), DEFAULT_QUEUE_CONFIG);
    await ctx.db.patch(jobId, {
      status: next.status,
      attempts: next.attempts,
      dueAt: next.dueAt,
      claimedAt: next.claimedAt,
      completedAt: next.completedAt,
      backoffMs: next.backoffMs,
      lastError: next.lastError,
    });
    await ctx.scheduler.runAfter(400, api.queue.tick, { userId: user._id });
    return { jobId, status: next.status };
  },
});

/** Purge the dead letter queue for the current user. */
export const purgeDead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const dead = await ctx.db
      .query("queueJobs")
      .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "dead"))
      .collect();
    for (const j of dead) {
      await ctx.db.delete(j._id);
    }
    return { purged: dead.length };
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const jobs = await ctx.db
      .query("queueJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .collect();
    const now = Date.now();
    const stats = queueStats(jobs.map(toCoreJob), now);

    const byQueue: Record<string, ReturnType<typeof queueStats>> = {};
    for (const q of QUEUE_IDS) {
      const inQueue = jobs.filter((j) => j.queue === q).map(toCoreJob);
      byQueue[q] = queueStats(inQueue, now);
    }

    return {
      stats,
      byQueue,
      config: DEFAULT_QUEUE_CONFIG,
      workers: Array.from({ length: DEFAULT_QUEUE_CONFIG.concurrency }, (_, i) => ({
        id: i + 1,
        busy: i < stats.processing,
      })),
      queues: QUEUE_IDS.map((q) => ({ id: q, label: QUEUE_LABEL[q] })),
    };
  },
});

export const list = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit = 40 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    if (status) {
      return await ctx.db
        .query("queueJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", user._id).eq("status", status as never),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("queueJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});
