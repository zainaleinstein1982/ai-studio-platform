// STEP 04 · Provider abstraction layer.
//
// Every upstream (OpenAI, Anthropic, Google, Meshy, Tripo, Runway, Kling,
// Luma) is wrapped in a ProviderAdapter so the router treats them uniformly:
//   supports(kind) · models · timeoutMs · call(input)
// The router picks an adapter via the Provider Manager (adapterFor) and the
// circuit breaker state per provider is persisted in the circuitState table.
import { PROVIDER_MODELS, simulateResponse, type GatewayKind } from "../catalog";
import {
  DEFAULT_CIRCUIT_CONFIG,
  initialCircuit,
  prepareCall,
  recordFailure,
  recordSuccess,
  type Circuit,
} from "./circuit";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* Adapter contract                                                    */
/* ------------------------------------------------------------------ */

export interface ProviderCallInput {
  kind: GatewayKind;
  model: string;
  prompt: string;
  imageName?: string;
}

export interface ProviderCallResult {
  text: string;
  latencyMs: number;
}

export interface ProviderAdapter {
  id: string;
  label: string;
  timeoutMs: number;
  models: string[];
  supports(kind: GatewayKind): boolean;
  /** The simulated upstream call. Real deployments swap this for HTTP. */
  call(input: ProviderCallInput): Promise<ProviderCallResult>;
}

/** Per-provider timeouts (ms) — the upstream contract, enforced by withTimeout. */
const PROVIDER_TIMEOUT_MS: Record<string, number> = {
  openai: 45_000,
  anthropic: 45_000,
  google: 60_000,
  meshy: 90_000,
  tripo: 90_000,
  runway: 120_000,
  kling: 120_000,
  luma: 120_000,
};

/* ------------------------------------------------------------------ */
/* Registry (Provider Manager)                                         */
/* ------------------------------------------------------------------ */

const registry = new Map<string, ProviderAdapter>();

for (const group of Object.values(PROVIDER_MODELS).flat()) {
  if (registry.has(group.provider)) continue;
  const adapter: ProviderAdapter = {
    id: group.provider,
    label: group.providerLabel,
    timeoutMs: PROVIDER_TIMEOUT_MS[group.provider] ?? 60_000,
    models: [...new Set(group.models)],
    supports: (kind) =>
      (PROVIDER_MODELS[kind] ?? []).some((g) => g.provider === group.provider),
    async call({ kind, model, prompt, imageName }) {
      const sim = simulateResponse({ kind, provider: group.provider, model, prompt, imageName });
      return { text: sim.text, latencyMs: sim.latencyMs };
    },
  };
  registry.set(group.provider, adapter);
}

export function adapterFor(provider: string): ProviderAdapter | null {
  return registry.get(provider) ?? null;
}

export function allAdapters(): ProviderAdapter[] {
  return [...registry.values()];
}

/* ------------------------------------------------------------------ */
/* Circuit state persistence                                           */
/* ------------------------------------------------------------------ */

export async function getCircuit(ctx: QueryCtx, provider: string): Promise<Circuit> {
  const doc = await ctx.db
    .query("circuitState")
    .withIndex("by_provider", (q) => q.eq("provider", provider))
    .first();
  if (!doc) return initialCircuit(Date.now());
  return {
    state: doc.state,
    failures: doc.failures,
    successCount: doc.successCount,
    openedAt: doc.openedAt,
    updatedAt: doc.updatedAt,
  };
}

async function saveCircuit(ctx: MutationCtx, provider: string, circuit: Circuit) {
  const existing = await ctx.db
    .query("circuitState")
    .withIndex("by_provider", (q) => q.eq("provider", provider))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      state: circuit.state,
      failures: circuit.failures,
      successCount: circuit.successCount,
      openedAt: circuit.openedAt,
      updatedAt: circuit.updatedAt,
    });
  } else {
    await ctx.db.insert("circuitState", {
      provider,
      state: circuit.state,
      failures: circuit.failures,
      successCount: circuit.successCount,
      openedAt: circuit.openedAt,
      updatedAt: circuit.updatedAt,
    });
  }
}

/** True when the provider may be called; also returns the circuit to persist. */
export async function prepareProviderCall(
  ctx: QueryCtx,
  provider: string,
  now: number,
): Promise<{ allow: boolean; reason?: string }> {
  const circuit = await getCircuit(ctx, provider);
  const prepared = prepareCall(circuit, now, DEFAULT_CIRCUIT_CONFIG);
  if (!prepared.allow) {
    return { allow: false, reason: `${provider}: ${prepared.reason}` };
  }
  return { allow: true };
}

/** Record an upstream outcome against the provider's breaker. */
export async function recordProviderOutcome(
  ctx: MutationCtx,
  provider: string,
  ok: boolean,
  now: number,
): Promise<void> {
  const circuit = await getCircuit(ctx, provider);
  // For a call that was allowed, the persisted state already reflects the
  // open → half_open trial transition (prepareProviderCall was consulted at
  // send time); recording applies the outcome on top.
  const next = ok ? recordSuccess(circuit, now) : recordFailure(circuit, now, DEFAULT_CIRCUIT_CONFIG);
  await saveCircuit(ctx, provider, next);
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export interface ProviderHealth {
  provider: string;
  label: string;
  state: Circuit["state"];
  failures: number;
  successCount: number;
  healthy: boolean;
  retryInSec: number | null;
  timeoutMs: number;
}

/** Aggregate breaker health for every provider (for the console panel). */
export async function providerHealthList(ctx: QueryCtx): Promise<ProviderHealth[]> {
  const now = Date.now();
  const out: ProviderHealth[] = [];
  for (const adapter of allAdapters()) {
    const circuit = await getCircuit(ctx, adapter.id);
    const check = prepareCall(circuit, now, DEFAULT_CIRCUIT_CONFIG);
    out.push({
      provider: adapter.id,
      label: adapter.label,
      state: circuit.state,
      failures: circuit.failures,
      successCount: circuit.successCount,
      healthy: check.allow,
      retryInSec: check.allow
        ? null
        : Math.max(1, Math.ceil(((circuit.openedAt ?? now) + DEFAULT_CIRCUIT_CONFIG.cooldownMs - now) / 1000)),
      timeoutMs: adapter.timeoutMs,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CircuitStateDoc = Doc<"circuitState">;
export type { Id };
