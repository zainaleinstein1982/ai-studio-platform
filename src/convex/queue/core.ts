// STEP 10 · Queue system — pure core.
//
// Redis/Celery-style task queue for the whole platform:
//
//   enqueue (priority + delay) → scheduler → worker claim (concurrency) →
//   retry with exponential backoff → completed | dead letter queue
//
// Priorities are strict (high → normal → low), FIFO within a priority, and
// delayed jobs become visible only once their due time passes. A shared
// worker pool of `concurrency` slots claims due jobs; jobs that exhaust
// `maxAttempts` move to the dead letter queue and can be requeued manually.
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/queue.ts), in the browser (the console tab), and in
// unit tests. In production Redis would back the priority list and Celery
// would run the workers; here the mechanics are pure functions over plain
// job data.

export type QueuePriority = "high" | "normal" | "low";

export const PRIORITY_RANK: Record<QueuePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export type QueueStatus = "queued" | "processing" | "completed" | "failed" | "dead";

export interface QueueConfig {
  /** Worker pool size — how many jobs may run at once. */
  concurrency: number;
  /** Max processing attempts before a job moves to the dead letter queue. */
  maxAttempts: number;
  /** Exponential backoff base (ms). */
  baseBackoffMs: number;
  /** Exponential backoff ceiling (ms). */
  maxBackoffMs: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  concurrency: 4,
  maxAttempts: 3,
  baseBackoffMs: 1_200,
  maxBackoffMs: 60_000,
};

export interface QueueJob {
  id: string;
  queue: string; // "gateway" | "text3d" | "image3d" | "video" | "sdk" | "storage"
  priority: QueuePriority;
  status: QueueStatus;
  attempts: number; // failed attempts so far
  maxAttempts: number;
  payload: string;
  createdAt: number;
  dueAt: number; // visible to workers at this time (delay / retry backoff)
  claimedAt?: number;
  completedAt?: number;
  lastError?: string;
  backoffMs: number; // current backoff for the next retry
  forceFailure?: boolean; // dev tool: always fail → exercises the DLQ
}

export function priorityRank(p: QueuePriority): number {
  return PRIORITY_RANK[p];
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

export interface EnqueueInput {
  id: string;
  queue: string;
  priority: QueuePriority;
  payload: string;
  createdAt: number;
  delayMs?: number;
  maxAttempts?: number;
  forceFailure?: boolean;
}

/** Create a queued job; `delayMs` pushes its due time into the future. */
export function enqueueJob(input: EnqueueInput): QueueJob {
  return {
    id: input.id,
    queue: input.queue,
    priority: input.priority,
    status: "queued",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_QUEUE_CONFIG.maxAttempts,
    payload: input.payload,
    createdAt: input.createdAt,
    dueAt: input.createdAt + Math.max(0, input.delayMs ?? 0),
    backoffMs: 0,
    forceFailure: input.forceFailure,
  };
}

/* ------------------------------------------------------------------ */
/* Worker claim (concurrency + priority + delay)                       */
/* ------------------------------------------------------------------ */

export interface ClaimResult {
  claimed: QueueJob[]; // now processing
  remaining: QueueJob[];
}

/**
 * Claim due jobs up to the free worker slots. Ordering is strict priority
 * (high → normal → low), then FIFO within a priority. Delayed jobs
 * (dueAt in the future) are never claimed.
 */
export function claimNext(
  jobs: QueueJob[],
  now: number,
  config: QueueConfig,
  inFlight: number,
): ClaimResult {
  const slots = Math.max(0, config.concurrency - inFlight);
  if (slots === 0) return { claimed: [], remaining: jobs };

  const eligible = jobs
    .filter((j) => (j.status === "queued" || j.status === "failed") && j.dueAt <= now)
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt - b.createdAt,
    );

  const claimed = eligible.slice(0, slots).map((j) => ({
    ...j,
    status: "processing" as const,
    claimedAt: now,
  }));
  const claimedIds = new Set(claimed.map((j) => j.id));
  return {
    claimed,
    remaining: jobs.filter((j) => !claimedIds.has(j.id)),
  };
}

/* ------------------------------------------------------------------ */
/* Retry · DLQ                                                         */
/* ------------------------------------------------------------------ */

/** Exponential backoff, capped at the configured ceiling. */
export function nextBackoff(currentMs: number, config: QueueConfig): number {
  if (currentMs <= 0) return config.baseBackoffMs; // first retry: base
  return Math.min(currentMs * 2, config.maxBackoffMs);
}

/**
 * Resolve a claimed job: success → completed; failure → either requeued
 * with exponential backoff (failed) or moved to the dead letter queue once
 * maxAttempts are exhausted.
 */
export function advanceJob(
  job: QueueJob,
  now: number,
  ok: boolean,
  config: QueueConfig,
  error?: string,
): QueueJob {
  if (job.status !== "processing") return job;
  if (ok) {
    return { ...job, status: "completed", completedAt: now, lastError: undefined };
  }
  const attempts = job.attempts + 1;
  if (attempts >= job.maxAttempts) {
    return {
      ...job,
      status: "dead",
      attempts,
      completedAt: now,
      lastError: error ?? "max retries exceeded",
    };
  }
  const backoffMs = nextBackoff(job.backoffMs, config);
  return {
    ...job,
    status: "failed",
    attempts,
    dueAt: now + backoffMs,
    backoffMs,
    lastError: error ?? "attempt failed",
  };
}

/** Manually requeue a dead/failed job: fresh attempts, visible immediately. */
export function requeueJob(job: QueueJob, now: number, config: QueueConfig): QueueJob {
  return {
    ...job,
    status: "queued",
    attempts: 0,
    dueAt: now,
    claimedAt: undefined,
    completedAt: undefined,
    backoffMs: 0,
    lastError: undefined,
    maxAttempts: job.maxAttempts || config.maxAttempts,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic simulated processing                                  */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit — stable seed for deterministic outcomes. */
export function fnvHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Outcome {
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Deterministic simulated worker execution. `forceFailure` always fails so
 * the retry → DLQ lifecycle can be demonstrated on demand.
 */
export function simulateOutcome(job: QueueJob): Outcome {
  const seed = fnvHash(`${job.id}|${job.payload}`);
  const durationMs = 900 + (seed % 2_400);
  if (job.forceFailure) {
    return { ok: false, durationMs, error: "simulated failure (force_failure=true)" };
  }
  if (seed % 100 < 84) return { ok: true, durationMs };
  return { ok: false, durationMs, error: "provider unavailable (simulated outage)" };
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

export interface QueueStats {
  queued: number;
  delayed: number; // queued/failed with dueAt in the future
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  inFlight: number;
  avgWaitMs: number | null; // mean queued→completed wall time
  successRate: number | null; // completed / (completed + dead)
}

export function queueStats(jobs: QueueJob[], now: number): QueueStats {
  let queued = 0;
  let delayed = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  let dead = 0;
  const waitTimes: number[] = [];

  for (const j of jobs) {
    switch (j.status) {
      case "queued":
        queued += 1;
        if (j.dueAt > now) delayed += 1;
        break;
      case "failed":
        failed += 1;
        if (j.dueAt > now) delayed += 1;
        break;
      case "processing":
        processing += 1;
        break;
      case "completed":
        completed += 1;
        if (j.completedAt) waitTimes.push(j.completedAt - j.createdAt);
        break;
      case "dead":
        dead += 1;
        break;
    }
  }

  const avgWaitMs =
    waitTimes.length > 0
      ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
      : null;
  const settled = completed + dead;
  const successRate = settled > 0 ? Math.round((completed / settled) * 100) : null;

  return { queued, delayed, processing, completed, failed, dead, inFlight: processing, avgWaitMs, successRate };
}
