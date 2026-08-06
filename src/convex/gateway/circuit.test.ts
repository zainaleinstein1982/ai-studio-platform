import { describe, expect, it } from "vitest";
import {
  DEFAULT_CIRCUIT_CONFIG,
  initialCircuit,
  prepareCall,
  recordFailure,
  recordSuccess,
  shouldAllow,
} from "./circuit";

const NOW = 1_750_000_000_000;

/** Trip the breaker: exactly `failureThreshold` failures at time `t`. */
function tripped(t: number) {
  let c = initialCircuit(t);
  for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.failureThreshold; i++) {
    c = recordFailure(c, t);
  }
  return c;
}

describe("circuit breaker", () => {
  it("starts closed and allows calls", () => {
    const c = initialCircuit(NOW);
    expect(c.state).toBe("closed");
    expect(shouldAllow(c, NOW).allow).toBe(true);
  });

  it("opens after the failure threshold", () => {
    let c = initialCircuit(NOW);
    c = recordFailure(c, NOW);
    expect(c.state).toBe("closed");
    c = recordFailure(c, NOW);
    expect(c.state).toBe("closed");
    c = recordFailure(c, NOW);
    expect(c.state).toBe("open");
    expect(c.openedAt).toBe(NOW);
    expect(shouldAllow(c, NOW).allow).toBe(false);
  });

  it("blocks while open and reports retry time", () => {
    const c = tripped(NOW);
    const res = shouldAllow(c, NOW + 1_000);
    expect(res.allow).toBe(false);
    expect(res.state).toBe("open");
    if (!res.allow) expect(res.reason).toContain("retry in ~14s");
  });

  it("transitions to half-open and allows a trial after cooldown", () => {
    const c = tripped(NOW);
    const trial = shouldAllow(c, NOW + DEFAULT_CIRCUIT_CONFIG.cooldownMs);
    expect(trial.allow).toBe(true);
    expect(trial.state).toBe("half_open");
  });

  it("closes again after a half-open success", () => {
    const c = tripped(NOW);
    const afterCooldown = NOW + DEFAULT_CIRCUIT_CONFIG.cooldownMs;
    // the trial call flips open → half_open before it succeeds
    const prepared = prepareCall(c, afterCooldown);
    expect(prepared.allow).toBe(true);
    expect(prepared.circuit.state).toBe("half_open");
    const closed = recordSuccess(prepared.circuit, afterCooldown);
    expect(closed.state).toBe("closed");
    expect(closed.failures).toBe(0);
    expect(shouldAllow(closed, afterCooldown).allow).toBe(true);
  });

  it("reopens immediately on a half-open failure", () => {
    const c = tripped(NOW);
    const afterCooldown = NOW + DEFAULT_CIRCUIT_CONFIG.cooldownMs;
    const prepared = prepareCall(c, afterCooldown);
    const reopened = recordFailure(prepared.circuit, afterCooldown);
    expect(reopened.state).toBe("open");
    expect(reopened.openedAt).toBe(afterCooldown);
  });

  it("prepareCall blocks while the cooldown is still active", () => {
    const c = tripped(NOW);
    const blocked = prepareCall(c, NOW + 5_000);
    expect(blocked.allow).toBe(false);
    expect(blocked.circuit.state).toBe("open");
    if (!blocked.allow) expect(blocked.reason).toContain("retry");
  });

  it("resets failure counts on closed-state success", () => {
    let c = initialCircuit(NOW);
    c = recordFailure(c, NOW);
    c = recordSuccess(c, NOW + 1);
    expect(c.state).toBe("closed");
    expect(c.failures).toBe(0);
    expect(c.successCount).toBe(1);
  });
});
