import { describe, expect, it } from "vitest";
import { bucketFor, retryAfterSeconds } from "./rateLimit";

describe("rate limiter window helpers", () => {
  const WINDOW = 10_000; // 10s window

  it("assigns timestamps to fixed buckets", () => {
    expect(bucketFor(0, WINDOW)).toBe(0);
    expect(bucketFor(9_999, WINDOW)).toBe(0);
    expect(bucketFor(10_000, WINDOW)).toBe(1);
    expect(bucketFor(29_999, WINDOW)).toBe(2);
  });

  it("reports seconds until the window rolls over", () => {
    const t = 1_000_000_000; // exactly at a window boundary
    // 1s into a 10s window → 9s remain
    expect(retryAfterSeconds(t + 1_000, WINDOW)).toBe(9);
    // right before rollover → 1s
    expect(retryAfterSeconds(t + 9_000, WINDOW)).toBe(1);
    // at a fresh rollover → full window
    expect(retryAfterSeconds(t + 10_000, WINDOW)).toBe(10);
  });

  it("never reports zero or negative retry times", () => {
    for (let i = 0; i < 100; i++) {
      expect(retryAfterSeconds(i * 1013, WINDOW)).toBeGreaterThanOrEqual(1);
    }
  });
});
