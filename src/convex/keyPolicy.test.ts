import { describe, expect, it } from "vitest";
import {
  KEY_SCOPES,
  checkLimits,
  isKeyActive,
  keyInactiveReason,
  normalizeScopes,
  parseLimit,
  scopeAllows,
} from "./keyPolicy";
import { GATEWAY_KINDS, KIND_META } from "./catalog";

const NOW = 1_750_000_000_000;

describe("normalizeScopes", () => {
  it("defaults to every route when nothing is given", () => {
    expect(normalizeScopes(undefined)).toEqual([...GATEWAY_KINDS]);
    expect(normalizeScopes([])).toEqual([...GATEWAY_KINDS]);
  });

  it("dedupes and drops unknown routes", () => {
    expect(normalizeScopes(["text", "text", "nope", "vision"])).toEqual(["text", "vision"]);
  });

  it("covers every route with a label", () => {
    expect(KEY_SCOPES.length).toBe(GATEWAY_KINDS.length);
    for (const s of KEY_SCOPES) {
      expect(KIND_META[s].label.length).toBeGreaterThan(0);
    }
  });
});

describe("scopeAllows", () => {
  it("allows everything when scopes are missing (legacy keys)", () => {
    expect(scopeAllows(undefined, "text")).toBe(true);
    expect(scopeAllows([], "imageToVideo")).toBe(true);
  });

  it("grants access only to granted scopes", () => {
    expect(scopeAllows(["text", "vision"], "text")).toBe(true);
    expect(scopeAllows(["text", "vision"], "vision")).toBe(true);
    expect(scopeAllows(["text", "vision"], "textToVideo")).toBe(false);
  });
});

describe("isKeyActive / keyInactiveReason", () => {
  it("is active when neither revoked nor expired", () => {
    expect(isKeyActive({}, NOW)).toBe(true);
    expect(isKeyActive({ expiresAt: NOW + 1000 }, NOW)).toBe(true);
  });

  it("rejects revoked keys regardless of expiry", () => {
    expect(isKeyActive({ revokedAt: NOW - 1 }, NOW)).toBe(false);
    expect(keyInactiveReason({ revokedAt: NOW - 1 }, NOW)).toContain("revoked");
  });

  it("rejects expired keys", () => {
    expect(isKeyActive({ expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(keyInactiveReason({ expiresAt: NOW - 1 }, NOW)).toContain("expired");
  });

  it("allows a key that expires exactly now? no — expiry is exclusive", () => {
    expect(isKeyActive({ expiresAt: NOW }, NOW)).toBe(false);
  });
});

describe("checkLimits", () => {
  it("passes when no limits are set", () => {
    expect(checkLimits({ dailyUsed: 100, monthlyUsed: 100, quotaUsed: 100 }, {}).ok).toBe(true);
  });

  it("blocks when usage reaches the limit", () => {
    const daily = checkLimits({ dailyUsed: 5, monthlyUsed: 0, quotaUsed: 0 }, { dailyLimit: 5 });
    expect(daily).toEqual({ ok: false, reason: expect.stringContaining("Daily") });

    const monthly = checkLimits({ dailyUsed: 0, monthlyUsed: 3, quotaUsed: 0 }, { monthlyLimit: 3 });
    expect(monthly).toEqual({ ok: false, reason: expect.stringContaining("Monthly") });

    const quota = checkLimits({ dailyUsed: 0, monthlyUsed: 0, quotaUsed: 10 }, { quota: 10 });
    expect(quota).toEqual({ ok: false, reason: expect.stringContaining("quota") });
  });

  it("allows usage just under the limit", () => {
    expect(checkLimits({ dailyUsed: 4, monthlyUsed: 0, quotaUsed: 9 }, { dailyLimit: 5, quota: 10 }).ok).toBe(true);
  });

  it("reports the first failing limit", () => {
    const res = checkLimits(
      { dailyUsed: 9, monthlyUsed: 9, quotaUsed: 9 },
      { dailyLimit: 5, monthlyLimit: 5, quota: 5 },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Daily");
  });
});

describe("parseLimit", () => {
  it("parses positive integers and rejects the rest", () => {
    expect(parseLimit(10)).toBe(10);
    expect(parseLimit(0)).toBeUndefined();
    expect(parseLimit(-5)).toBeUndefined();
    expect(parseLimit(undefined)).toBeUndefined();
    expect(parseLimit(null)).toBeUndefined();
    expect(parseLimit(2.9)).toBe(2);
  });
});
