// Table-backed rate limiter (Convex 1.42 lacks ctx.rateLimit).
// Pure helpers are exported separately for unit testing.
import type { MutationCtx } from "./_generated/server";

export interface RateLimitOptions {
  name: string;
  key: string;
  limit: number; // max calls per window
  windowMs: number; // window length
}

/** The fixed window bucket index for a given timestamp. */
export function bucketFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

/** Seconds until the current window rolls over (for the error message). */
export function retryAfterSeconds(now: number, windowMs: number): number {
  const bucketStart = bucketFor(now, windowMs) * windowMs;
  return Math.max(1, Math.ceil((bucketStart + windowMs - now) / 1000));
}

/**
 * Throws a RateLimitError when `name:key` exceeds `limit` calls within
 * `windowMs`. Storage key includes the bucket, so windows self-expire.
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  { name, key, limit, windowMs }: RateLimitOptions,
): Promise<void> {
  const now = Date.now();
  const bucket = bucketFor(now, windowMs);
  const storageKey = `${name}:${bucket}:${key}`;

  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", storageKey))
    .first();

  if (existing && existing.count >= limit) {
    const err = new Error(
      `Rate limit exceeded for ${name} — try again in ${retryAfterSeconds(now, windowMs)}s.`,
    ) as Error & { status?: number };
    err.status = 429;
    throw err;
  }

  if (existing) {
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
  } else {
    await ctx.db.insert("rateLimits", {
      key: storageKey,
      count: 1,
      createdAt: now,
    });
  }
}
