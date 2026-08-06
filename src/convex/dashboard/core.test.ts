// STEP 11 · Dashboard core — unit tests for the pure derived metrics.
import { describe, expect, it } from "vitest";
import {
  creditValueDollars,
  formatBytes,
  formatDollars,
  healthSummary,
  mergeFeed,
  parsePriceDollars,
  queuePressure,
  revenueMetrics,
  storageUtilizationPct,
  type FeedItemLike,
  type PlanLike,
} from "./core";

const PRO: PlanLike = { id: "pro", price: "$29", credits: 2000 };
const STARTER: PlanLike = { id: "starter", price: "$0", credits: 100 };
const SCALE: PlanLike = { id: "scale", price: "$149", credits: 20000 };

describe("parsePriceDollars", () => {
  it("parses a dollar price string", () => {
    expect(parsePriceDollars("$29")).toBe(29);
    expect(parsePriceDollars("$149")).toBe(149);
    expect(parsePriceDollars("$0")).toBe(0);
    expect(parsePriceDollars("")).toBe(0);
    expect(parsePriceDollars("garbage")).toBe(0);
  });
});

describe("creditValueDollars", () => {
  it("derives per-credit value from price and monthly allowance", () => {
    expect(creditValueDollars(PRO)).toBe(0.01);
    expect(creditValueDollars(SCALE)).toBe(0.01);
    expect(creditValueDollars(STARTER)).toBe(0);
  });
});

describe("revenueMetrics", () => {
  it("reports MRR, spend and the estimated dollar figure", () => {
    const m = revenueMetrics(PRO, 500);
    expect(m.mrr).toBe(29);
    expect(m.perCredit).toBe(0.01);
    expect(m.spentThisMonth).toBe(500);
    expect(m.estimated).toBe(5);
  });

  it("rounds estimates to cents from the displayed per-credit value", () => {
    // perCredit 29/3000 rounds to $0.01, and the estimate uses that
    // displayed value: 333 × 0.01 = $3.33.
    const m = revenueMetrics({ id: "x", price: "$29", credits: 3000 }, 333);
    expect(m.perCredit).toBe(0.01);
    expect(m.estimated).toBe(3.33);
  });

  it("is zero for free plans", () => {
    expect(revenueMetrics(STARTER, 100).estimated).toBe(0);
  });
});

describe("formatDollars", () => {
  it("formats small and large values", () => {
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(29)).toBe("$29");
    expect(formatDollars(5)).toBe("$5");
    expect(formatDollars(1250)).toBe("$1.3k");
    expect(formatDollars(-3)).toBe("$0");
  });
});

describe("healthSummary", () => {
  it("counts healthy / degraded / down and derives uptime", () => {
    const summary = healthSummary([
      { healthy: true, state: "closed" },
      { healthy: true, state: "closed" },
      { healthy: false, state: "half_open" },
      { healthy: false, state: "open" },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.healthy).toBe(2);
    expect(summary.degraded).toBe(1);
    expect(summary.down).toBe(1);
    // (2 + 0.5) / 4 → 62.5 → 63
    expect(summary.uptimePct).toBe(63);
  });

  it("treats an empty list as fully healthy", () => {
    expect(healthSummary([])).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      down: 0,
      uptimePct: 100,
    });
  });
});

describe("queuePressure", () => {
  it("is 0 with no queued work", () => {
    expect(queuePressure({ pending: 0, processing: 0, retrying: 0, dead: 0 })).toBe(0);
  });

  it("rises as backpressured jobs accumulate", () => {
    expect(queuePressure({ pending: 4, processing: 4, retrying: 0, dead: 0 }, 4)).toBe(0.5);
    expect(queuePressure({ pending: 12, processing: 4, retrying: 4, dead: 0 }, 4)).toBe(0.8);
  });

  it("saturates toward 1 under heavy backpressure", () => {
    const p = queuePressure({ pending: 100, processing: 4, retrying: 100, dead: 0 }, 4);
    expect(p).toBeGreaterThan(0.98);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("never divides by zero", () => {
    expect(queuePressure({ pending: 0, processing: 0, retrying: 0, dead: 0 }, 0)).toBe(0);
  });
});

describe("storageUtilizationPct", () => {
  it("returns a clamped percentage", () => {
    expect(storageUtilizationPct(0, 0)).toBe(0);
    expect(storageUtilizationPct(5, 100)).toBe(5);
    expect(storageUtilizationPct(200, 100)).toBe(100);
  });
});

describe("formatBytes", () => {
  it("formats byte sizes in human units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(-4)).toBe("0 B");
  });
});

describe("mergeFeed", () => {
  const base: FeedItemLike[] = [
    { id: "a", source: "gateway", at: 100, status: "completed", title: "A" },
    { id: "b", source: "sdk", at: 300, status: "processing", title: "B" },
    { id: "c", source: "queue", at: 200, status: "queued", title: "C" },
  ];

  it("sorts newest first and caps at the limit", () => {
    const merged = mergeFeed(base, 2);
    expect(merged.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("handles empty input", () => {
    expect(mergeFeed([], 10)).toEqual([]);
  });

  it("breaks ties deterministically (source asc, then id desc)", () => {
    const tied: FeedItemLike[] = [
      { id: "x", source: "sdk", at: 5, status: "completed", title: "X" },
      { id: "y", source: "gateway", at: 5, status: "completed", title: "Y" },
    ];
    expect(mergeFeed(tied).map((i) => i.id)).toEqual(["y", "x"]);
  });
});
