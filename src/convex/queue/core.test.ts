// STEP 10 · Queue system — unit tests.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_CONFIG,
  advanceJob,
  claimNext,
  enqueueJob,
  fnvHash,
  nextBackoff,
  priorityRank,
  queueStats,
  requeueJob,
  simulateOutcome,
  type QueueConfig,
  type QueueJob,
} from "./core";

const NOW = 2_000_000;
const CFG: QueueConfig = DEFAULT_QUEUE_CONFIG;

let seq = 0;
function job(over: Partial<QueueJob> = {}): QueueJob {
  seq += 1;
  return {
    id: `job_${seq}`,
    queue: "gateway",
    priority: "normal",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    payload: "render a clip",
    createdAt: NOW,
    dueAt: NOW,
    backoffMs: 0,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

describe("enqueueJob", () => {
  it("creates a queued job, due immediately by default", () => {
    const j = enqueueJob({ id: "j1", queue: "video", priority: "high", payload: "dolly", createdAt: NOW });
    expect(j.status).toBe("queued");
    expect(j.attempts).toBe(0);
    expect(j.maxAttempts).toBe(3);
    expect(j.dueAt).toBe(NOW);
  });

  it("honours a delay via dueAt", () => {
    const j = enqueueJob({ id: "j1", queue: "video", priority: "normal", payload: "x", createdAt: NOW, delayMs: 5000 });
    expect(j.dueAt).toBe(NOW + 5000);
  });

  it("honours forceFailure and maxAttempts", () => {
    const j = enqueueJob({ id: "j1", queue: "sdk", priority: "low", payload: "x", createdAt: NOW, maxAttempts: 5, forceFailure: true });
    expect(j.maxAttempts).toBe(5);
    expect(j.forceFailure).toBe(true);
  });
});

describe("priorityRank", () => {
  it("orders high before normal before low", () => {
    expect(priorityRank("high")).toBeLessThan(priorityRank("normal"));
    expect(priorityRank("normal")).toBeLessThan(priorityRank("low"));
  });
});

/* ------------------------------------------------------------------ */
/* Worker claim                                                        */
/* ------------------------------------------------------------------ */

describe("claimNext (priority · FIFO · delay · concurrency)", () => {
  it("claims in strict priority order", () => {
    const jobs = [
      job({ id: "a", priority: "normal", createdAt: NOW }),
      job({ id: "b", priority: "high", createdAt: NOW + 1 }),
      job({ id: "c", priority: "low", createdAt: NOW + 2 }),
    ];
    const { claimed } = claimNext(jobs, NOW, CFG, 0);
    expect(claimed.map((j) => j.id)).toEqual(["b", "a", "c"]);
  });

  it("is FIFO within a priority", () => {
    const jobs = [
      job({ id: "a", priority: "high", createdAt: NOW }),
      job({ id: "b", priority: "high", createdAt: NOW + 10 }),
    ];
    const { claimed } = claimNext(jobs, NOW, CFG, 0);
    expect(claimed.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("never claims delayed jobs", () => {
    const jobs = [job({ id: "a", dueAt: NOW + 999 })];
    const { claimed } = claimNext(jobs, NOW, CFG, 0);
    expect(claimed).toEqual([]);
  });

  it("marks claimed jobs processing with a lease", () => {
    const { claimed } = claimNext([job({ id: "a" })], NOW, CFG, 0);
    expect(claimed[0].status).toBe("processing");
    expect(claimed[0].claimedAt).toBe(NOW);
  });

  it("respects the concurrency pool", () => {
    const jobs = [
      job({ id: "a", createdAt: NOW }),
      job({ id: "b", createdAt: NOW + 1 }),
      job({ id: "c", createdAt: NOW + 2 }),
    ];
    const { claimed, remaining } = claimNext(jobs, NOW, { ...CFG, concurrency: 2 }, 0);
    expect(claimed.length).toBe(2);
    expect(remaining.length).toBe(1);
  });

  it("subtracts in-flight jobs from the pool", () => {
    const jobs = [job({ id: "a" }), job({ id: "b" })];
    const { claimed } = claimNext(jobs, NOW, { ...CFG, concurrency: 2 }, 1);
    expect(claimed.length).toBe(1);
  });

  it("reclaims failed jobs once their backoff passes", () => {
    const retry = job({ id: "a", status: "failed", dueAt: NOW, backoffMs: 1200 });
    const { claimed } = claimNext([retry], NOW, CFG, 0);
    expect(claimed.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Retry · DLQ                                                          */
/* ------------------------------------------------------------------ */

describe("nextBackoff", () => {
  it("doubles exponentially and caps", () => {
    expect(nextBackoff(0, CFG)).toBe(1200);
    expect(nextBackoff(1200, CFG)).toBe(2400);
    expect(nextBackoff(2400, CFG)).toBe(4800);
    expect(nextBackoff(60_000, CFG)).toBe(60_000);
  });
});

describe("advanceJob", () => {
  it("completes a successful job", () => {
    const next = advanceJob(job({ id: "a", status: "processing" }), NOW + 100, true, CFG);
    expect(next.status).toBe("completed");
    expect(next.completedAt).toBe(NOW + 100);
  });

  it("requeues a failed job with backoff", () => {
    const next = advanceJob(job({ id: "a", status: "processing" }), NOW + 100, false, CFG, "boom");
    expect(next.status).toBe("failed");
    expect(next.attempts).toBe(1);
    expect(next.dueAt).toBe(NOW + 100 + 1200);
    expect(next.lastError).toBe("boom");
  });

  it("sends the job to the dead letter queue after maxAttempts", () => {
    const j = job({ id: "a", status: "processing", attempts: 2, maxAttempts: 3 });
    const next = advanceJob(j, NOW + 100, false, CFG, "still failing");
    expect(next.status).toBe("dead");
    expect(next.attempts).toBe(3);
    expect(next.lastError).toContain("still failing");
  });

  it("ignores non-processing jobs", () => {
    const j = job({ id: "a", status: "completed" });
    expect(advanceJob(j, NOW, false, CFG)).toBe(j);
  });
});

describe("requeueJob", () => {
  it("resets a dead job back to queued with fresh attempts", () => {
    const dead = job({ id: "a", status: "dead", attempts: 3, lastError: "x", completedAt: NOW });
    const next = requeueJob(dead, NOW + 1000, CFG);
    expect(next.status).toBe("queued");
    expect(next.attempts).toBe(0);
    expect(next.dueAt).toBe(NOW + 1000);
    expect(next.lastError).toBeUndefined();
    expect(next.maxAttempts).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* Deterministic outcome                                               */
/* ------------------------------------------------------------------ */

describe("simulateOutcome", () => {
  it("is deterministic per job", () => {
    const j = job({ id: "a", payload: "render" });
    expect(simulateOutcome(j)).toEqual(simulateOutcome(j));
  });

  it("force-fails on demand", () => {
    const j = job({ id: "a", forceFailure: true });
    const out = simulateOutcome(j);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("force_failure");
  });

  it("mostly succeeds otherwise", () => {
    let okCount = 0;
    for (let i = 0; i < 200; i++) {
      const j = job({ id: `j${i}`, payload: `payload ${i}` });
      if (simulateOutcome(j).ok) okCount += 1;
    }
    expect(okCount).toBeGreaterThan(140); // ~84%
  });

  it("produces a positive duration", () => {
    expect(simulateOutcome(job({ id: "a" })).durationMs).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */

describe("queueStats", () => {
  it("counts by status and flags delayed jobs", () => {
    const jobs = [
      job({ id: "a", status: "queued", dueAt: NOW + 5000 }),
      job({ id: "b", status: "queued", dueAt: NOW }),
      job({ id: "c", status: "processing" }),
      job({ id: "d", status: "completed", createdAt: NOW, completedAt: NOW + 1000 }),
      job({ id: "e", status: "failed", dueAt: NOW + 1200 }),
      job({ id: "f", status: "dead" }),
    ];
    const s = queueStats(jobs, NOW);
    expect(s.queued).toBe(2);
    expect(s.delayed).toBe(2); // a + e
    expect(s.processing).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.dead).toBe(1);
    expect(s.inFlight).toBe(1);
    expect(s.avgWaitMs).toBe(1000);
    expect(s.successRate).toBe(50);
  });

  it("handles empty pools", () => {
    const s = queueStats([], NOW);
    expect(s).toMatchObject({ queued: 0, processing: 0, completed: 0, dead: 0, avgWaitMs: null, successRate: null });
  });
});

describe("fnvHash", () => {
  it("is deterministic and distinct", () => {
    expect(fnvHash("abc")).toBe(fnvHash("abc"));
    expect(fnvHash("abc")).not.toBe(fnvHash("abd"));
  });
});
