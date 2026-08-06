// STEP 03 · API Key Platform — generate, rotate, revoke, policy, webhooks.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import {
  generateSecret,
  generateWebhookSecret,
  secretPrefix,
  sha256Hex,
  webhookSecretPrefix,
} from "./keygen";
import {
  isKeyActive,
  normalizeScopes,
  parseLimit,
} from "./keyPolicy";
import { enforceRateLimit } from "./rateLimit";
import { ACTIONS, logAudit } from "./audit";
import type { Id } from "./_generated/dataModel";
import type { GatewayKind } from "./catalog";

/** Validate an optional timestamp (expiry) against now. */
function parseExpiry(value: number | undefined, now: number): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value) || value <= now) return undefined;
  return Math.floor(value);
}

async function requireOwnedKey(ctx: QueryCtx, id: Id<"apiKeys">) {
  const user = await requireUser(ctx);
  const key = await ctx.db.get(id);
  if (!key || key.userId !== user._id) throw new Error("Key not found");
  return { user, key };
}

/** Per-key usage derived from the request ledger (also used by the gateway). */
export async function computeKeyUsage(ctx: QueryCtx, apiKeyId: Id<"apiKeys">, now: number) {
  const requests = await ctx.db
    .query("gatewayRequests")
    .withIndex("by_apiKey_created", (q) => q.eq("apiKeyId", apiKeyId))
    .order("desc")
    .take(1000);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let dailyUsed = 0;
  let monthlyUsed = 0;
  let quotaUsed = 0;
  let totalRequests = 0;
  let completedRequests = 0;
  let creditsTotal = 0;

  const byDay: Record<string, { count: number; credits: number }> = {};
  for (const r of requests) {
    totalRequests += 1;
    if (r.createdAt >= startOfToday.getTime()) dailyUsed += 1;
    if (r.createdAt >= startOfMonth.getTime()) monthlyUsed += 1;
    if (r.status === "completed") {
      completedRequests += 1;
      quotaUsed += r.credits;
      creditsTotal += r.credits;
    }
    const dayKey = new Date(r.createdAt).toDateString();
    const bucket = (byDay[dayKey] ??= { count: 0, credits: 0 });
    bucket.count += 1;
    if (r.status === "completed") bucket.credits += r.credits;
  }

  // last 7 days, oldest → newest
  const days: { label: string; count: number; credits: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const bucket = byDay[d.toDateString()];
    days.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      count: bucket?.count ?? 0,
      credits: bucket?.credits ?? 0,
    });
  }

  return {
    totalRequests,
    completedRequests,
    creditsTotal,
    dailyUsed,
    monthlyUsed,
    quotaUsed,
    byDay: days,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    return keys.map((k) => ({
      id: k._id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      dailyLimit: k.dailyLimit,
      monthlyLimit: k.monthlyLimit,
      quota: k.quota,
      expiresAt: k.expiresAt,
      webhookSet: Boolean(k.webhookSecretHash),
      webhookPrefix: k.webhookSecretPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  },
});

/** Look up a key by its secret hash (used by the reverse-proxy HTTP API). */
export const findByHash = query({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (!key) return null;
    return { id: key._id };
  },
});

/** Full key + live usage statistics (owner only). */
export const detail = query({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const { key } = await requireOwnedKey(ctx, id);
    const usage = await computeKeyUsage(ctx, id, Date.now());
    return {
      key: {
        id: key._id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        dailyLimit: key.dailyLimit,
        monthlyLimit: key.monthlyLimit,
        quota: key.quota,
        expiresAt: key.expiresAt,
        webhookSet: Boolean(key.webhookSecretHash),
        webhookPrefix: key.webhookSecretPrefix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      },
      usage,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    dailyLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    quota: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();

    await enforceRateLimit(ctx, {
      name: "api-key-create",
      key: user._id,
      limit: 5,
      windowMs: 60_000,
    });

    const secret = generateSecret();
    const keyHash = await sha256Hex(secret);

    const id = await ctx.db.insert("apiKeys", {
      userId: user._id,
      name: args.name?.trim() ? args.name.trim().slice(0, 60) : "Default key",
      prefix: secretPrefix(secret),
      keyHash,
      scopes: normalizeScopes(args.scopes),
      dailyLimit: parseLimit(args.dailyLimit),
      monthlyLimit: parseLimit(args.monthlyLimit),
      quota: parseLimit(args.quota),
      expiresAt: parseExpiry(args.expiresAt, now),
      createdAt: now,
    });

    await logAudit(ctx, user._id, {
      action: ACTIONS.KEY_CREATED,
      targetType: "apiKey",
      targetId: id,
      detail: args.name?.trim() || "Default key",
    });

    // The full secret is returned exactly once.
    return { id, secret };
  },
});

/** Edit a key's name, scopes, or limits (owner only). */
export const update = mutation({
  args: {
    id: v.id("apiKeys"),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    dailyLimit: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    quota: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    clearExpiry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, key } = await requireOwnedKey(ctx, args.id);
    if (key.revokedAt) throw new Error("Cannot update a revoked key");

    const now = Date.now();
    const patch: Record<string, string | number | string[] | undefined> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim().slice(0, 60);
    if (args.scopes !== undefined) patch.scopes = normalizeScopes(args.scopes);
    if (args.dailyLimit !== undefined) patch.dailyLimit = parseLimit(args.dailyLimit);
    if (args.monthlyLimit !== undefined) patch.monthlyLimit = parseLimit(args.monthlyLimit);
    if (args.quota !== undefined) patch.quota = parseLimit(args.quota);
    if (args.clearExpiry) {
      patch.expiresAt = undefined;
    } else if (args.expiresAt !== undefined) {
      patch.expiresAt = parseExpiry(args.expiresAt, now);
    }
    await ctx.db.patch(key._id, patch);

    await logAudit(ctx, user._id, {
      action: ACTIONS.KEY_UPDATED,
      targetType: "apiKey",
      targetId: key._id,
      detail: "policy updated",
    });
  },
});

/** Rotate: the old secret dies, a fresh key inherits the same policy. */
export const rotate = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const { user, key } = await requireOwnedKey(ctx, id);
    if (key.revokedAt) throw new Error("Cannot rotate a revoked key");

    await enforceRateLimit(ctx, {
      name: "api-key-rotate",
      key: user._id,
      limit: 10,
      windowMs: 60_000,
    });

    await ctx.db.patch(key._id, { revokedAt: Date.now() });

    const secret = generateSecret();
    const newId = await ctx.db.insert("apiKeys", {
      userId: user._id,
      name: `${key.name} (rotated)`,
      prefix: secretPrefix(secret),
      keyHash: await sha256Hex(secret),
      scopes: key.scopes,
      dailyLimit: key.dailyLimit,
      monthlyLimit: key.monthlyLimit,
      quota: key.quota,
      expiresAt: key.expiresAt,
      createdAt: Date.now(),
    });

    await logAudit(ctx, user._id, {
      action: ACTIONS.KEY_ROTATED,
      targetType: "apiKey",
      targetId: newId,
      detail: `replaced ${key.prefix}`,
    });

    return { newId, secret };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const { user, key } = await requireOwnedKey(ctx, id);
    if (key.revokedAt) return;
    await ctx.db.patch(key._id, { revokedAt: Date.now() });

    await logAudit(ctx, user._id, {
      action: ACTIONS.KEY_REVOKED,
      targetType: "apiKey",
      targetId: key._id,
      detail: key.name,
    });
  },
});

/** Generate (or regenerate) a webhook signing secret — shown once. */
export const regenerateWebhookSecret = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const { user, key } = await requireOwnedKey(ctx, id);
    if (key.revokedAt) throw new Error("Cannot configure webhooks on a revoked key");

    const secret = generateWebhookSecret();
    await ctx.db.patch(key._id, {
      webhookSecretHash: await sha256Hex(secret),
      webhookSecretPrefix: webhookSecretPrefix(secret),
    });

    await logAudit(ctx, user._id, {
      action: ACTIONS.WEBHOOK_REGENERATED,
      targetType: "apiKey",
      targetId: key._id,
      detail: key.name,
    });

    return { secret };
  },
});

/** Called by the gateway when a request is routed through a key. */
export const touch = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const key = await ctx.db.get(id);
    if (!key || key.revokedAt) return;
    await ctx.db.patch(id, { lastUsedAt: Date.now() });
  },
});

/* ------------------------------------------------------------------ */
/* Gateway-facing policy check                                         */
/* ------------------------------------------------------------------ */

export type GatewayKeyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Enforce a key's full policy for one gateway call: lifecycle, scope,
 * daily / monthly / quota limits. Returns ok or a reason to reject.
 */
export async function checkGatewayKey(
  ctx: QueryCtx,
  key: {
    _id: Id<"apiKeys">;
    revokedAt?: number;
    expiresAt?: number;
    scopes?: string[];
    dailyLimit?: number;
    monthlyLimit?: number;
    quota?: number;
  },
  kind: GatewayKind,
  now: number,
): Promise<GatewayKeyCheck> {
  if (!isKeyActive(key, now)) {
    return { ok: false, reason: "This API key is revoked or expired" };
  }
  if (key.scopes && key.scopes.length > 0 && !key.scopes.includes(kind)) {
    return { ok: false, reason: `This API key does not grant the "${kind}" scope` };
  }
  const usage = await computeKeyUsage(ctx, key._id, now);
  if (key.dailyLimit != null && usage.dailyUsed >= key.dailyLimit) {
    return { ok: false, reason: `Daily request limit reached (${usage.dailyUsed}/${key.dailyLimit})` };
  }
  if (key.monthlyLimit != null && usage.monthlyUsed >= key.monthlyLimit) {
    return { ok: false, reason: `Monthly request limit reached (${usage.monthlyUsed}/${key.monthlyLimit})` };
  }
  if (key.quota != null && usage.quotaUsed >= key.quota) {
    return { ok: false, reason: `Credit quota exhausted (${usage.quotaUsed}/${key.quota})` };
  }
  return { ok: true };
}
