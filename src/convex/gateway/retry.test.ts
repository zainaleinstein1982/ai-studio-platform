import { describe, expect, it } from "vitest";
import { withRetry, withTimeout } from "./retry";

describe("withRetry", () => {
  it("returns the value on the first attempt", async () => {
    const { value, attempts } = await withRetry(async () => "ok", {
      attempts: 3,
      baseDelayMs: 1,
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("retries until success and reports the attempt count", async () => {
    let calls = 0;
    const { value, attempts } = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    }, { attempts: 4, baseDelayMs: 1 });
    expect(value).toBe("recovered");
    expect(attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("throws after exhausting all attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error("always fails");
      }, { attempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("always fails");
    expect(calls).toBe(2);
  });

  it("honors the shouldRetry predicate for non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error("permanent");
      }, {
        attempts: 3,
        baseDelayMs: 1,
        shouldRetry: (e) => (e as Error).message !== "permanent",
      }),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
  });
});

describe("withTimeout", () => {
  it("resolves with the underlying value", async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
  });

  it("rejects with a timeout error when the promise is slow", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    await expect(withTimeout(slow, 10)).rejects.toThrow("timeout after 10ms");
  });
});
