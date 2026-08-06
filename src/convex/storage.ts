// STEP 09 · Storage service — Convex surface.
//
// MinIO / S3-compatible object registry + per-kind caches (image · video ·
// glb · preview) + HMAC-signed CDN URLs. Decision logic lives in
// ./storage/core.ts (pure + unit-tested); this file persists objects and
// cache entries per user, ingests artifacts produced by every earlier
// module (SDK · text→3D · image→3D · text→video · image→video), and
// exposes the console + HTTP APIs.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import { sha256Hex } from "./keygen";
import {
  BUCKET_DEFS,
  CACHE_POLICY,
  CDN_HOST,
  cacheKindFor,
  cdnHeadersFor,
  parseS3Url,
  signObjectUrl,
  simulatedSizeBytes,
  newCacheEntry,
  evictExpired,
  toObjectStat,
  type CacheEntry,
  type CacheKind,
} from "./storage/core";
import type { Doc, Id } from "./_generated/dataModel";

type CacheDoc = Doc<"storageCache">;

/** Per-user signing secret, derived deterministically (never stored). */
async function signingSecret(userId: Id<"users">): Promise<string> {
  return sha256Hex(`${userId}::atelier-cdn-signing-v1`);
}

/* ------------------------------------------------------------------ */
/* Register objects                                                    */
/* ------------------------------------------------------------------ */

export const registerObject = mutation({
  args: { url: v.string(), source: v.optional(v.string()) },
  handler: async (ctx, { url, source = "manual" }) => {
    const user = await requireUser(ctx);
    const parsed = parseS3Url(url);
    if (!parsed.ok || !parsed.bucket || !parsed.key) {
      throw new Error(parsed.error ?? "Invalid object path");
    }
    const existing = await ctx.db
      .query("storageObjects")
      .withIndex("by_user_url", (q) => q.eq("userId", user._id).eq("url", url.trim()))
      .first();
    if (existing) return existing;

    const id = await ctx.db.insert("storageObjects", {
      userId: user._id,
      url: url.trim(),
      bucket: parsed.bucket,
      key: parsed.key,
      kind: cacheKindFor(url),
      sizeBytes: simulatedSizeBytes(url),
      source,
      createdAt: Date.now(),
    });
    const doc = await ctx.db.get(id);
    return doc;
  },
});

/** Scan every module's tasks and index their artifact URLs (idempotent). */
export const registerArtifacts = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const urls: { url: string; source: string }[] = [];

    const jobs = await ctx.db
      .query("providerJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    for (const j of jobs) {
      if (j.outputUrl) urls.push({ url: j.outputUrl, source: "sdk" });
    }

    const t3d = await ctx.db
      .query("text3dTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    for (const t of t3d) {
      if (t.glbUrl) urls.push({ url: t.glbUrl, source: "text3d" });
      if (t.fbxUrl) urls.push({ url: t.fbxUrl, source: "text3d" });
      if (t.objUrl) urls.push({ url: t.objUrl, source: "text3d" });
    }

    const i3d = await ctx.db
      .query("image3dTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    for (const t of i3d) {
      if (t.previewUrl) urls.push({ url: t.previewUrl, source: "image3d" });
      if (t.glbUrl) urls.push({ url: t.glbUrl, source: "image3d" });
      if (t.fbxUrl) urls.push({ url: t.fbxUrl, source: "image3d" });
      if (t.objUrl) urls.push({ url: t.objUrl, source: "image3d" });
    }

    const tvid = await ctx.db
      .query("textVideoTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    for (const t of tvid) {
      if (t.outputUrl) urls.push({ url: t.outputUrl, source: "textVideo" });
      if (t.previewUrl) urls.push({ url: t.previewUrl, source: "textVideo" });
    }

    const ivid = await ctx.db
      .query("imageVideoTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    for (const t of ivid) {
      if (t.outputUrl) urls.push({ url: t.outputUrl, source: "imageVideo" });
      if (t.previewUrl) urls.push({ url: t.previewUrl, source: "imageVideo" });
    }

    let added = 0;
    for (const { url, source } of urls) {
      const parsed = parseS3Url(url);
      if (!parsed.ok || !parsed.bucket || !parsed.key) continue;
      const existing = await ctx.db
        .query("storageObjects")
        .withIndex("by_user_url", (q) => q.eq("userId", user._id).eq("url", url))
        .first();
      if (existing) continue;
      await ctx.db.insert("storageObjects", {
        userId: user._id,
        url,
        bucket: parsed.bucket,
        key: parsed.key,
        kind: cacheKindFor(url),
        sizeBytes: simulatedSizeBytes(url),
        source,
        createdAt: Date.now(),
      });
      added += 1;
    }
    return { scanned: urls.length, added };
  },
});

/* ------------------------------------------------------------------ */
/* Signed URLs                                                         */
/* ------------------------------------------------------------------ */

export const generateSignedUrl = mutation({
  args: { url: v.string(), expiresInSec: v.optional(v.number()) },
  handler: async (ctx, { url, expiresInSec = 3600 }) => {
    const user = await requireUser(ctx);
    const parsed = parseS3Url(url);
    if (!parsed.ok || !parsed.bucket || !parsed.key) {
      throw new Error(parsed.error ?? "Invalid object path");
    }
    // Auto-register so the ledger always reflects what was signed.
    const existing = await ctx.db
      .query("storageObjects")
      .withIndex("by_user_url", (q) => q.eq("userId", user._id).eq("url", url.trim()))
      .first();
    if (!existing) {
      await ctx.db.insert("storageObjects", {
        userId: user._id,
        url: url.trim(),
        bucket: parsed.bucket,
        key: parsed.key,
        kind: cacheKindFor(url),
        sizeBytes: simulatedSizeBytes(url),
        source: "manual",
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { accessedAt: Date.now() });
    }

    const now = Date.now();
    const secret = await signingSecret(user._id);
    const signed = await signObjectUrl(url, secret, expiresInSec, now);
    if (!signed.ok || !signed.signedUrl) {
      throw new Error(signed.error ?? "Signing failed");
    }
    return {
      ok: true,
      url: signed.url,
      signedUrl: signed.signedUrl,
      expiresAt: signed.expiresAt,
      bucket: signed.bucket,
      key: signed.key,
      kind: signed.kind,
      headers: cdnHeadersFor(url),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Cache operations                                                    */
/* ------------------------------------------------------------------ */

export const warmCache = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const user = await requireUser(ctx);
    const parsed = parseS3Url(url);
    if (!parsed.ok || !parsed.bucket || !parsed.key) {
      throw new Error(parsed.error ?? "Invalid object path");
    }
    const key = `${parsed.bucket}/${parsed.key}`;
    const now = Date.now();
    const existing = await ctx.db
      .query("storageCache")
      .withIndex("by_user_key", (q) => q.eq("userId", user._id).eq("key", key))
      .first();
    if (existing && !existing.evicted) {
      await ctx.db.patch(existing._id, {
        hits: existing.hits + 1,
        lastAccessAt: now,
        expiresAt: now + CACHE_POLICY[cacheKindFor(url)].ttlMs,
      });
      return (await ctx.db.get(existing._id)) as CacheDoc;
    }
    const made = newCacheEntry(url, now);
    if (!made.ok || !made.entry) throw new Error(made.error ?? "Cache warm failed");
    const id = await ctx.db.insert("storageCache", {
      userId: user._id,
      key: made.entry.key,
      url: made.entry.url,
      bucket: made.entry.bucket,
      kind: made.entry.kind,
      sizeBytes: made.entry.sizeBytes,
      hits: made.entry.hits,
      lastAccessAt: made.entry.lastAccessAt,
      expiresAt: made.entry.expiresAt,
      createdAt: made.entry.createdAt,
      evicted: false,
    });
    return (await ctx.db.get(id)) as CacheDoc;
  },
});

export const evictCache = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const user = await requireUser(ctx);
    const parsed = parseS3Url(url);
    if (!parsed.ok || !parsed.bucket || !parsed.key) return { evicted: 0 };
    const key = `${parsed.bucket}/${parsed.key}`;
    const existing = await ctx.db
      .query("storageCache")
      .withIndex("by_user_key", (q) => q.eq("userId", user._id).eq("key", key))
      .first();
    if (!existing) return { evicted: 0 };
    await ctx.db.patch(existing._id, { evicted: true });
    return { evicted: 1 };
  },
});

export const evictExpiredCache = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const entries = await ctx.db
      .query("storageCache")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .collect();
    // The pure evictor only reads evicted/expiresAt/key — the rest is irrelevant here.
    const slim = entries.map((e) => ({
      _id: e._id,
      evicted: e.evicted,
      expiresAt: e.expiresAt,
      key: e.key,
    }));
    const { evicted } = evictExpired(slim as unknown as CacheEntry[], Date.now());
    let patched = 0;
    for (const e of slim) {
      if (!e.evicted && evicted.includes(e.key)) {
        await ctx.db.patch(e._id, { evicted: true });
        patched += 1;
      }
    }
    return { evicted: patched };
  },
});

export const recordAccess = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const obj = await ctx.db
      .query("storageObjects")
      .withIndex("by_user_url", (q) => q.eq("userId", user._id).eq("url", url.trim()))
      .first();
    if (obj) await ctx.db.patch(obj._id, { accessedAt: now });

    const parsed = parseS3Url(url);
    if (parsed.ok && parsed.bucket && parsed.key) {
      const key = `${parsed.bucket}/${parsed.key}`;
      const cache = await ctx.db
        .query("storageCache")
        .withIndex("by_user_key", (q) => q.eq("userId", user._id).eq("key", key))
        .first();
      if (cache && !cache.evicted) {
        await ctx.db.patch(cache._id, { hits: cache.hits + 1, lastAccessAt: now });
      }
    }
    return { ok: true };
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const [objects, cache] = await Promise.all([
      ctx.db
        .query("storageObjects")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .collect(),
      ctx.db
        .query("storageCache")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .collect(),
    ]);

    const byBucket = new Map<string, { count: number; bytes: number }>();
    let totalBytes = 0;
    for (const o of objects) {
      const b = byBucket.get(o.bucket) ?? { count: 0, bytes: 0 };
      b.count += 1;
      b.bytes += o.sizeBytes;
      byBucket.set(o.bucket, b);
      totalBytes += o.sizeBytes;
    }

    const byKind = new Map<CacheKind, { count: number; hits: number; bytes: number; evicted: number }>();
    for (const c of cache) {
      const k = (c.kind ?? "other") as CacheKind;
      const cur = byKind.get(k) ?? { count: 0, hits: 0, bytes: 0, evicted: 0 };
      cur.count += 1;
      cur.hits += c.hits;
      cur.bytes += c.sizeBytes;
      if (c.evicted) cur.evicted += 1;
      byKind.set(k, cur);
    }

    const buckets = Object.values(BUCKET_DEFS).map((def) => {
      const stats = byBucket.get(def.name) ?? { count: 0, bytes: 0 };
      const policy = CACHE_POLICY[def.defaultKind];
      return {
        name: def.name,
        label: def.label,
        description: def.description,
        cdnPath: `https://${def.cdnPath}`,
        kind: def.defaultKind,
        ttlMs: policy.ttlMs,
        cacheControl: policy.cacheControl,
        count: stats.count,
        bytes: stats.bytes,
      };
    });

    const cacheStats = Object.fromEntries(
      [...byKind.entries()].map(([kind, s]) => [kind, s]),
    );

    return {
      totalObjects: objects.length,
      totalBytes,
      cacheEntries: cache.length,
      cacheHits: cache.reduce((sum, c) => sum + c.hits, 0),
      evicted: cache.filter((c) => c.evicted).length,
      buckets,
      cacheStats,
      cdn: { ready: true, host: CDN_HOST },
      objects,
      cache,
    };
  },
});

export const listObjects = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 40 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const docs = await ctx.db
      .query("storageObjects")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
    return docs.map((o) =>
      toObjectStat(o.url, o.bucket, o.key, o.sizeBytes),
    );
  },
});

export const listCache = query({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, { kind }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    if (kind) {
      return await ctx.db
        .query("storageCache")
        .withIndex("by_user_kind", (q) => q.eq("userId", user._id).eq("kind", kind))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("storageCache")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
  },
});

/** Bucket + cache policy config for the console panels. */
export const cdnConfig = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      host: CDN_HOST,
      buckets: Object.values(BUCKET_DEFS).map((def) => ({
        name: def.name,
        label: def.label,
        description: def.description,
        cdnPath: `https://${def.cdnPath}`,
        kind: def.defaultKind,
        ttlMs: CACHE_POLICY[def.defaultKind].ttlMs,
        cacheControl: CACHE_POLICY[def.defaultKind].cacheControl,
      })),
    };
  },
});

export { CACHE_POLICY, type CacheKind };
