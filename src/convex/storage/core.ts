// STEP 09 · Storage service — pure core.
//
// MinIO / S3-compatible object storage abstraction for every artifact the
// platform produces: 3D meshes (GLB · FBX · OBJ), video clips + posters,
// preview renders, and uploaded images. The buckets live behind
// "s3://atelier-assets/<bucket>/<key>" paths produced by earlier modules;
// this service layers on top of them:
//
//   bucket registry (S3-compatible) → signed URLs (HMAC) →
//   per-kind cache (image · video · GLB · preview) → CDN-ready headers
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/storage.ts), in the browser (the console tab), and in
// unit tests. In production the signed URLs would be issued by a MinIO or
// S3 gateway (PresignedGetObject); here signing is HMAC-SHA256 over the
// object key + expiry, verified by the same pure functions.

/* ------------------------------------------------------------------ */
/* Bucket registry (S3-compatible)                                     */
/* ------------------------------------------------------------------ */

export const ASSET_HOST = "atelier-assets";
export const CDN_HOST = "cdn.atelier.dev";

const DAY = 86_400_000;

export type CacheKind = "image" | "video" | "glb" | "preview" | "other";

export interface BucketDef {
  name: string;
  label: string;
  description: string;
  cdnPath: string;
  defaultKind: CacheKind;
}

/** Every S3-compatible bucket the platform writes into. */
export const BUCKET_DEFS: Record<string, BucketDef> = {
  "3d": {
    name: "3d",
    label: "3D meshes",
    description: "Text → 3D exports · GLB · FBX · OBJ",
    cdnPath: `${CDN_HOST}/3d`,
    defaultKind: "glb",
  },
  image3d: {
    name: "image3d",
    label: "Image → 3D",
    description: "Reconstructions · previews · cutouts · enhanced",
    cdnPath: `${CDN_HOST}/image3d`,
    defaultKind: "glb",
  },
  video: {
    name: "video",
    label: "Video",
    description: "MP4 clips · poster frames",
    cdnPath: `${CDN_HOST}/video`,
    defaultKind: "video",
  },
  images: {
    name: "images",
    label: "Images",
    description: "Uploads · cutouts · enhanced stills",
    cdnPath: `${CDN_HOST}/images`,
    defaultKind: "image",
  },
  sdk: {
    name: "sdk",
    label: "SDK artifacts",
    description: "Provider SDK outputs",
    cdnPath: `${CDN_HOST}/sdk`,
    defaultKind: "other",
  },
  requests: {
    name: "requests",
    label: "Request ledger",
    description: "Gateway request payloads",
    cdnPath: `${CDN_HOST}/requests`,
    defaultKind: "other",
  },
};

export function bucketDef(name: string): BucketDef | undefined {
  return BUCKET_DEFS[name];
}

/* ------------------------------------------------------------------ */
/* Parse · classify                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedObject {
  ok: boolean;
  error?: string;
  url?: string;
  bucket?: string;
  key?: string;
}

export function parseS3Url(raw: string | undefined): ParsedObject {
  const url = (raw ?? "").trim();
  const m = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return { ok: false, error: `"${url}" is not an s3://… path` };
  const [, host, path] = m;
  if (host !== ASSET_HOST) {
    return { ok: false, error: `Unknown asset host "${host}" — expected ${ASSET_HOST}` };
  }
  const [bucket, ...rest] = path.split("/");
  if (!bucket || !rest.length) return { ok: false, error: "Object key is missing a path" };
  return { ok: true, url, bucket, key: rest.join("/") };
}

/** Map an object to the cache tier it belongs in: image · video · GLB · preview. */
export function cacheKindFor(raw: string | undefined): CacheKind {
  const p = parseS3Url(raw);
  if (!p.ok || !p.key) return "other";
  const key = p.key.toLowerCase();
  if (/(preview|poster|thumb)/.test(key)) return "preview";
  if (key.endsWith(".glb") || key.endsWith(".fbx") || key.endsWith(".obj")) return "glb";
  if (key.endsWith(".mp4") || key.endsWith(".webm") || key.endsWith(".mov")) return "video";
  if (/\.(png|jpe?g|webp|gif)$/.test(key)) return "image";
  return "other";
}

/** CDN-ready delivery URL for an object. */
export function cdnUrlFor(raw: string | undefined): string {
  const p = parseS3Url(raw);
  if (!p.ok || !p.bucket || !p.key) return "";
  return `https://${CDN_HOST}/${p.bucket}/${p.key}`;
}

/* ------------------------------------------------------------------ */
/* Cache policy · headers (CDN ready)                                  */
/* ------------------------------------------------------------------ */

export interface CachePolicy {
  ttlMs: number;
  cacheControl: string;
  cdn: "public" | "private";
}

export const CACHE_POLICY: Record<CacheKind, CachePolicy> = {
  image: { ttlMs: 7 * DAY, cacheControl: "public, max-age=604800, immutable", cdn: "public" },
  preview: { ttlMs: 7 * DAY, cacheControl: "public, max-age=604800, immutable", cdn: "public" },
  video: { ttlMs: 30 * DAY, cacheControl: "public, max-age=2592000, immutable", cdn: "public" },
  glb: { ttlMs: 30 * DAY, cacheControl: "public, max-age=2592000, immutable", cdn: "public" },
  other: { ttlMs: DAY, cacheControl: "private, max-age=0", cdn: "private" },
};

export function cachePolicyFor(raw: string | undefined): CachePolicy {
  return CACHE_POLICY[cacheKindFor(raw)];
}

/** FNV-1a 32-bit — deterministic fingerprint (sync, no crypto). */
export function fnvHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Response headers an edge/CDN would serve for this object. */
export function cdnHeadersFor(raw: string | undefined): Record<string, string> {
  const policy = cachePolicyFor(raw);
  return {
    "Cache-Control": policy.cacheControl,
    "CDN-Cache-Control": policy.cacheControl,
    ETag: `"${fnvHex(raw ?? "")}"`,
    "Accept-Ranges": "bytes",
  };
}

/** Every registered bucket is served from the CDN edge. */
export function cdnReadyFor(raw: string | undefined): { ready: boolean; cdnPath: string; note: string } {
  const p = parseS3Url(raw);
  if (!p.ok || !p.bucket) {
    return { ready: false, cdnPath: "", note: "not a valid object path" };
  }
  const def = bucketDef(p.bucket);
  return {
    ready: true,
    cdnPath: def ? `https://${def.cdnPath}` : `https://${CDN_HOST}/${p.bucket}`,
    note: def ? `${def.label} · edge-served` : "edge-served",
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic simulated size                                        */
/* ------------------------------------------------------------------ */

/** Simulated object size (bytes) — deterministic per object path. */
export function simulatedSizeBytes(raw: string | undefined): number {
  const kind = cacheKindFor(raw);
  const seed = parseInt(fnvHex(raw ?? ""), 16) % 6;
  const base: Record<CacheKind, number> = {
    image: 320_000,
    preview: 96_000,
    video: 4_800_000,
    glb: 1_400_000,
    other: 64_000,
  };
  return Math.round(base[kind] * (0.7 + seed / 10));
}

/* ------------------------------------------------------------------ */
/* Signed URLs (HMAC-SHA256)                                           */
/* ------------------------------------------------------------------ */

export const MIN_EXPIRY_SEC = 60;
export const MAX_EXPIRY_SEC = 86_400; // 24 h

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return `sha256=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface SignedUrlResult {
  ok: boolean;
  error?: string;
  url?: string; // canonical CDN url
  signedUrl?: string;
  expiresAt?: number;
  bucket?: string;
  key?: string;
  kind?: CacheKind;
}

/** Issue a presigned CDN URL: canonical url + expiry + HMAC signature. */
export async function signObjectUrl(
  raw: string,
  secret: string,
  expiresInSec: number,
  now: number,
): Promise<SignedUrlResult> {
  const p = parseS3Url(raw);
  if (!p.ok || !p.bucket || !p.key) return { ok: false, error: p.error };
  const expiresAt = now + Math.min(Math.max(Math.round(expiresInSec), MIN_EXPIRY_SEC), MAX_EXPIRY_SEC);
  const message = `${p.bucket}/${p.key}|${expiresAt}`;
  const signature = await hmacSha256(secret, message);
  return {
    ok: true,
    url: `https://${CDN_HOST}/${p.bucket}/${p.key}`,
    signedUrl: `https://${CDN_HOST}/${p.bucket}/${p.key}?X-Atelier-Expires=${expiresAt}&X-Atelier-Signature=${signature}`,
    expiresAt,
    bucket: p.bucket,
    key: p.key,
    kind: cacheKindFor(raw),
  };
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  expiresAt?: number;
}

/** Verify a signed URL: signature matches and expiry has not passed. */
export async function verifySignedUrl(
  raw: string,
  secret: string,
  now: number,
): Promise<VerifyResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid signed URL" };
  }
  const expiresAt = Number(url.searchParams.get("X-Atelier-Expires"));
  const signature = url.searchParams.get("X-Atelier-Signature") ?? "";
  if (!Number.isFinite(expiresAt) || !signature) {
    return { ok: false, error: "Signed URL is missing expiry or signature" };
  }
  if (now > expiresAt) return { ok: false, error: "Signed URL has expired" };

  const path = url.pathname.replace(/^\//, "");
  const message = `${path}|${expiresAt}`;
  const expected = await hmacSha256(secret, message);
  if (expected.length !== signature.length) return { ok: false, error: "Signature mismatch" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, error: "Signature mismatch" };
  return { ok: true, expiresAt };
}

/* ------------------------------------------------------------------ */
/* Cache entries · eviction                                            */
/* ------------------------------------------------------------------ */

export interface CacheEntry {
  key: string; // "<bucket>/<key>"
  url: string;
  bucket: string;
  kind: CacheKind;
  sizeBytes: number;
  hits: number;
  createdAt: number;
  lastAccessAt?: number;
  expiresAt: number;
  evicted: boolean;
}

export interface NewEntryResult {
  ok: boolean;
  error?: string;
  entry?: CacheEntry;
}

/** Create a cache entry with the TTL for the object's cache tier. */
export function newCacheEntry(raw: string, now: number): NewEntryResult {
  const p = parseS3Url(raw);
  if (!p.ok || !p.bucket || !p.key) return { ok: false, error: p.error };
  const kind = cacheKindFor(raw);
  const entry: CacheEntry = {
    key: `${p.bucket}/${p.key}`,
    url: raw.trim(),
    bucket: p.bucket,
    kind,
    sizeBytes: simulatedSizeBytes(raw),
    hits: 1,
    createdAt: now,
    lastAccessAt: now,
    expiresAt: now + CACHE_POLICY[kind].ttlMs,
    evicted: false,
  };
  return { ok: true, entry };
}

export interface EvictionResult {
  remaining: CacheEntry[];
  evicted: string[];
}

/** Drop expired entries (and already-evicted tombstones). */
export function evictExpired(entries: CacheEntry[], now: number): EvictionResult {
  const evicted: string[] = [];
  const remaining = entries.filter((e) => {
    if (e.evicted) {
      if (!evicted.includes(e.key)) evicted.push(e.key);
      return false;
    }
    if (e.expiresAt <= now) {
      evicted.push(e.key);
      return false;
    }
    return true;
  });
  return { remaining, evicted };
}

/** If over capacity, evict least-recently-used entries. */
export function lruEvict(entries: CacheEntry[], maxCount: number): EvictionResult {
  if (entries.length <= maxCount) return { remaining: entries, evicted: [] };
  const sorted = [...entries].sort(
    (a, b) => (a.lastAccessAt ?? a.createdAt) - (b.lastAccessAt ?? b.createdAt),
  );
  const evicted = sorted.slice(0, entries.length - maxCount);
  const keys = new Set(evicted.map((e) => e.key));
  return {
    remaining: entries.filter((e) => !keys.has(e.key)),
    evicted: evicted.map((e) => e.key),
  };
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

export interface ObjectStat {
  url: string;
  bucket: string;
  key: string;
  kind: CacheKind;
  sizeBytes: number;
  cacheControl: string;
  cdnUrl: string;
}

/** Normalized view of a stored object for the console + API. */
export function toObjectStat(
  url: string,
  bucket: string,
  key: string,
  sizeBytes: number,
): ObjectStat {
  return {
    url,
    bucket,
    key,
    kind: cacheKindFor(url),
    sizeBytes,
    cacheControl: CACHE_POLICY[cacheKindFor(url)].cacheControl,
    cdnUrl: cdnUrlFor(url),
  };
}
