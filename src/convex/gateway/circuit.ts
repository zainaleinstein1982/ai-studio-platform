// STEP 04 · Circuit breaker — pure state machine (no Convex imports).
//
//   closed ──(failureThreshold failures)──▶ open
//   open   ──(cooldown elapsed, next call)──▶ half_open
//   half_open ──(failure)──▶ open
//   half_open ──(success)──▶ closed
//   closed ──(success)──▶ failures reset

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitConfig {
  /** Consecutive failures before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a trial. */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = {
  failureThreshold: 3,
  cooldownMs: 15_000,
};

export interface Circuit {
  state: CircuitState;
  failures: number;
  successCount: number;
  openedAt?: number;
  updatedAt: number;
}

export function initialCircuit(now: number): Circuit {
  return { state: "closed", failures: 0, successCount: 0, updatedAt: now };
}

/**
 * Whether a call may proceed. When OPEN and the cooldown has elapsed the
 * breaker transitions to HALF_OPEN and lets a single trial through.
 */
export function shouldAllow(
  circuit: Circuit,
  now: number,
  config: CircuitConfig = DEFAULT_CIRCUIT_CONFIG,
): { allow: boolean; state: CircuitState; reason?: string } {
  if (circuit.state === "closed") return { allow: true, state: "closed" };
  if (circuit.state === "half_open") return { allow: true, state: "half_open" };
  const elapsed = now - (circuit.openedAt ?? now);
  if (elapsed >= config.cooldownMs) {
    return { allow: true, state: "half_open", reason: "trial" };
  }
  const retryInSec = Math.ceil((config.cooldownMs - elapsed) / 1000);
  return {
    allow: false,
    state: "open",
    reason: `circuit open — retry in ~${retryInSec}s`,
  };
}

/**
 * Resolve the circuit state just before a call is attempted: an OPEN circuit
 * whose cooldown has elapsed becomes HALF_OPEN (one trial allowed). Returns
 * the circuit to persist plus whether the call may proceed.
 */
export function prepareCall(
  circuit: Circuit,
  now: number,
  config: CircuitConfig = DEFAULT_CIRCUIT_CONFIG,
): { circuit: Circuit; allow: boolean; reason?: string } {
  const check = shouldAllow(circuit, now, config);
  if (!check.allow) {
    return { circuit, allow: false, reason: check.reason };
  }
  if (check.state === "half_open" && circuit.state === "open") {
    return { circuit: { ...circuit, state: "half_open" }, allow: true };
  }
  return { circuit, allow: true };
}

/** Record a provider failure; may flip closed → open or half_open → open. */
export function recordFailure(
  circuit: Circuit,
  now: number,
  config: CircuitConfig = DEFAULT_CIRCUIT_CONFIG,
): Circuit {
  if (circuit.state === "closed") {
    const failures = circuit.failures + 1;
    if (failures >= config.failureThreshold) {
      return {
        state: "open",
        failures,
        successCount: circuit.successCount,
        openedAt: now,
        updatedAt: now,
      };
    }
    return { ...circuit, failures, updatedAt: now };
  }
  if (circuit.state === "half_open") {
    return {
      state: "open",
      failures: 1,
      successCount: circuit.successCount,
      openedAt: now,
      updatedAt: now,
    };
  }
  // already open — leave it; cooldown governs recovery
  return { ...circuit, failures: circuit.failures + 1, updatedAt: now };
}

/** Record a provider success; half_open → closed, failures reset. */
export function recordSuccess(circuit: Circuit, now: number): Circuit {
  if (circuit.state === "half_open") {
    return { state: "closed", failures: 0, successCount: 0, updatedAt: now };
  }
  return { ...circuit, failures: 0, successCount: circuit.successCount + 1, updatedAt: now };
}
