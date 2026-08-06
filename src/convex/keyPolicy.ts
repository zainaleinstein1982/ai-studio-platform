// STEP 03 · Pure API key policy helpers (no Convex imports — unit-tested).
import { GATEWAY_KINDS, KIND_META, type GatewayKind } from "./catalog";

/* ------------------------------------------------------------------ */
/* Scopes                                                              */
/* ------------------------------------------------------------------ */

export type KeyScope = GatewayKind;

/** Every route a key can be granted access to. */
export const KEY_SCOPES: KeyScope[] = [...GATEWAY_KINDS];

/**
 * Normalize a user-supplied scope list: dedupe, keep only known routes,
 * and default to ALL routes when nothing is given.
 */
export function normalizeScopes(input: string[] | undefined): KeyScope[] {
  if (!input || input.length === 0) return [...KEY_SCOPES];
  const unique = new Set<KeyScope>();
  for (const s of input) {
    if (GATEWAY_KINDS.includes(s as KeyScope)) unique.add(s as KeyScope);
  }
  return [...unique];
}

/** Whether a key (whose scopes may be undefined = all routes) may call `kind`. */
export function scopeAllows(scopes: string[] | undefined, kind: GatewayKind): boolean {
  if (!scopes || scopes.length === 0) return true;
  return scopes.includes(kind);
}

/** Human label for a scope, e.g. "text" → "Text AI". */
export function scopeLabel(scope: string): string {
  return KIND_META[scope as GatewayKind]?.label ?? scope;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

export interface KeyLifecycleFields {
  revokedAt?: number;
  expiresAt?: number;
}

/** A key is usable when it is neither revoked nor past its expiry. */
export function isKeyActive(key: KeyLifecycleFields, now: number): boolean {
  if (key.revokedAt) return false;
  if (key.expiresAt && key.expiresAt <= now) return false;
  return true;
}

/** Human-friendly reason when a key cannot be used. */
export function keyInactiveReason(key: KeyLifecycleFields, now: number): string | null {
  if (key.revokedAt) return "This API key has been revoked";
  if (key.expiresAt && key.expiresAt <= now) return "This API key has expired";
  return null;
}

/* ------------------------------------------------------------------ */
/* Quotas & limits                                                     */
/* ------------------------------------------------------------------ */

export interface LimitFields {
  dailyLimit?: number;
  monthlyLimit?: number;
  quota?: number; // lifetime credit budget
}

export interface LimitUsage {
  dailyUsed: number; // requests today
  monthlyUsed: number; // requests this calendar month
  quotaUsed: number; // credits spent (completed)
}

export type LimitCheck = { ok: true } | { ok: false; reason: string };

/** Enforce daily / monthly / credit-quota limits against recorded usage. */
export function checkLimits(
  usage: LimitUsage,
  limits: LimitFields,
): LimitCheck {
  if (limits.dailyLimit != null && usage.dailyUsed >= limits.dailyLimit) {
    return {
      ok: false,
      reason: `Daily request limit reached (${usage.dailyUsed}/${limits.dailyLimit})`,
    };
  }
  if (limits.monthlyLimit != null && usage.monthlyUsed >= limits.monthlyLimit) {
    return {
      ok: false,
      reason: `Monthly request limit reached (${usage.monthlyUsed}/${limits.monthlyLimit})`,
    };
  }
  if (limits.quota != null && usage.quotaUsed >= limits.quota) {
    return {
      ok: false,
      reason: `Credit quota exhausted (${usage.quotaUsed}/${limits.quota})`,
    };
  }
  return { ok: true };
}

/** Parse a user-supplied numeric limit; undefined for empty/invalid values. */
export function parseLimit(value: number | undefined | null): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
