// STEP 09 · Storage service — unit tests.
import { describe, expect, it } from "vitest";
import {
  ASSET_HOST,
  CACHE_POLICY,
  CDN_HOST,
  bucketDef,
  cacheKindFor,
  cachePolicyFor,
  cdnHeadersFor,
  cdnReadyFor,
  cdnUrlFor,
  evictExpired,
  fnvHex,
  lruEvict,
  newCacheEntry,
  parseS3Url,
  signObjectUrl,
  simulatedSizeBytes,
  verifySignedUrl,
  type CacheEntry,
} from "./core";

const NOW = 1_700_000_000_000;
const SECRET = "test-cdn-signing-secret";

const GLB = "s3://atelier-assets/3d/3d_abc.glb";
const FBX = "s3://atelier-assets/3d/3d_abc.fbx";
const VIDEO = "s3://atelier-assets/video/vid_123/clip.mp4";
const POSTER = "s3://atelier-assets/video/vid_123/poster.jpg";
const IMG = "s3://atelier-assets/images/vase-cutout.png";
const PREVIEW = "s3://atelier-assets/image3d/i3d_x/preview.png";
const BAD = "https://example.com/not-s3";

/* ------------------------------------------------------------------ */
/* Parse · classify                                                     */
/* ------------------------------------------------------------------ */

describe("parseS3Url", () => {
  it("parses bucket + key from a valid s3 path", () => {
    const p = parseS3Url(GLB);
    expect(p.ok).toBe(true);
    expect(p.bucket).toBe("3d");
    expect(p.key).toBe("3d_abc.glb");
  });

  it("keeps nested keys", () => {
    const p = parseS3Url(VIDEO);
    expect(p.ok).toBe(true);
    expect(p.bucket).toBe("video");
    expect(p.key).toBe("vid_123/clip.mp4");
  });

  it("rejects non-s3 and unknown-host paths", () => {
    expect(parseS3Url(BAD).ok).toBe(false);
    expect(parseS3Url("s3://other-bucket/x.glb").ok).toBe(false);
    expect(parseS3Url(undefined).ok).toBe(false);
    expect(parseS3Url("s3://atelier-assets/3d").ok).toBe(false);
  });
});

describe("cacheKindFor", () => {
  it("classifies objects into the four cache tiers", () => {
    expect(cacheKindFor(GLB)).toBe("glb");
    expect(cacheKindFor(FBX)).toBe("glb");
    expect(cacheKindFor(VIDEO)).toBe("video");
    expect(cacheKindFor(IMG)).toBe("image");
    expect(cacheKindFor(PREVIEW)).toBe("preview");
    expect(cacheKindFor(POSTER)).toBe("preview");
    expect(cacheKindFor("s3://atelier-assets/requests/req_x.json")).toBe("other");
  });
});

describe("cdnUrlFor · cdnReadyFor", () => {
  it("maps an object to its CDN url", () => {
    expect(cdnUrlFor(GLB)).toBe(`https://${CDN_HOST}/3d/3d_abc.glb`);
  });

  it("reports every registered bucket as CDN ready", () => {
    const ready = cdnReadyFor(GLB);
    expect(ready.ready).toBe(true);
    expect(ready.cdnPath).toContain("/3d");
    expect(cdnReadyFor(BAD).ready).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sizes · headers                                                      */
/* ------------------------------------------------------------------ */

describe("simulatedSizeBytes", () => {
  it("is deterministic per object", () => {
    expect(simulatedSizeBytes(GLB)).toBe(simulatedSizeBytes(GLB));
    expect(simulatedSizeBytes(VIDEO)).toBeGreaterThan(simulatedSizeBytes(IMG));
  });
});

describe("cdnHeadersFor", () => {
  it("emits CDN-ready cache headers per tier", () => {
    const h = cdnHeadersFor(GLB);
    expect(h["Cache-Control"]).toContain("max-age=2592000");
    expect(h["CDN-Cache-Control"]).toBe(h["Cache-Control"]);
    expect(h.ETag).toMatch(/^"[0-9a-f]{8}"$/);
    expect(h["Accept-Ranges"]).toBe("bytes");
  });
});

describe("cachePolicyFor", () => {
  it("binds TTLs to the four cache tiers", () => {
    expect(CACHE_POLICY.image.ttlMs).toBeLessThan(CACHE_POLICY.video.ttlMs);
    expect(cachePolicyFor(GLB).cdn).toBe("public");
    expect(cachePolicyFor(IMG).cacheControl).toContain("immutable");
  });
});

/* ------------------------------------------------------------------ */
/* Signed URLs                                                          */
/* ------------------------------------------------------------------ */

describe("signObjectUrl · verifySignedUrl", () => {
  it("issues a signed CDN url with an expiry", async () => {
    const res = await signObjectUrl(GLB, SECRET, 3600, NOW);
    expect(res.ok).toBe(true);
    expect(res.signedUrl).toContain(`https://${CDN_HOST}/3d/3d_abc.glb`);
    expect(res.signedUrl).toContain("X-Atelier-Expires=");
    expect(res.signedUrl).toContain("X-Atelier-Signature=sha256=");
    expect(res.expiresAt).toBe(NOW + 3600);
    expect(res.kind).toBe("glb");
  });

  it("verifies a freshly signed url", async () => {
    const res = await signObjectUrl(GLB, SECRET, 600, NOW);
    const v = await verifySignedUrl(res.signedUrl!, SECRET, NOW + 300);
    expect(v.ok).toBe(true);
  });

  it("rejects expired urls", async () => {
    const res = await signObjectUrl(GLB, SECRET, 60, NOW);
    const v = await verifySignedUrl(res.signedUrl!, SECRET, NOW + 120);
    expect(v.ok).toBe(false);
    expect(v.error).toContain("expired");
  });

  it("rejects tampered signatures", async () => {
    const res = await signObjectUrl(GLB, SECRET, 600, NOW);
    const tampered = res.signedUrl!.replace("3d_abc.glb", "3d_abc.glbX");
    const v = await verifySignedUrl(tampered, SECRET, NOW + 100);
    expect(v.ok).toBe(false);
  });

  it("clamps the expiry window", async () => {
    const res = await signObjectUrl(GLB, SECRET, 1, NOW);
    expect(res.expiresAt).toBe(NOW + 60); // min 60s
    const max = await signObjectUrl(GLB, SECRET, 999_999, NOW);
    expect(max.expiresAt).toBe(NOW + 86_400); // max 24h
  });

  it("rejects invalid object paths", async () => {
    const res = await signObjectUrl(BAD, SECRET, 600, NOW);
    expect(res.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Cache entries · eviction                                            */
/* ------------------------------------------------------------------ */

function entry(over: Partial<CacheEntry> = {}): CacheEntry {
  return {
    key: "3d/3d_abc.glb",
    url: GLB,
    bucket: "3d",
    kind: "glb",
    sizeBytes: 1_400_000,
    hits: 3,
    createdAt: NOW - 1000,
    lastAccessAt: NOW - 500,
    expiresAt: NOW + 10_000,
    evicted: false,
    ...over,
  };
}

describe("newCacheEntry", () => {
  it("creates an entry with the tier TTL", () => {
    const res = newCacheEntry(GLB, NOW);
    expect(res.ok).toBe(true);
    expect(res.entry?.kind).toBe("glb");
    expect(res.entry?.expiresAt).toBe(NOW + CACHE_POLICY.glb.ttlMs);
    expect(res.entry?.hits).toBe(1);
  });

  it("rejects invalid paths", () => {
    expect(newCacheEntry(BAD, NOW).ok).toBe(false);
  });
});

describe("evictExpired", () => {
  it("removes expired entries", () => {
    const { remaining, evicted } = evictExpired(
      [entry(), entry({ key: "video/v.mp4", expiresAt: NOW - 1 })],
      NOW,
    );
    expect(remaining.length).toBe(1);
    expect(evicted).toEqual(["video/v.mp4"]);
  });

  it("drops evicted tombstones", () => {
    const { remaining, evicted } = evictExpired(
      [entry({ evicted: true }), entry({ key: "video/v.mp4" })],
      NOW,
    );
    expect(remaining.length).toBe(1);
    expect(evicted).toEqual(["3d/3d_abc.glb"]);
  });
});

describe("lruEvict", () => {
  it("keeps entries under capacity", () => {
    const { remaining, evicted } = lruEvict([entry()], 5);
    expect(remaining.length).toBe(1);
    expect(evicted).toEqual([]);
  });

  it("evicts least-recently-used entries over capacity", () => {
    const oldest = entry({ key: "3d/old.glb", lastAccessAt: NOW - 9000 });
    const newest = entry({ key: "3d/new.glb", lastAccessAt: NOW - 100 });
    const { remaining, evicted } = lruEvict([oldest, newest], 1);
    expect(evicted).toEqual(["3d/old.glb"]);
    expect(remaining.map((e) => e.key)).toEqual(["3d/new.glb"]);
  });
});

/* ------------------------------------------------------------------ */
/* Bucket registry                                                      */
/* ------------------------------------------------------------------ */

describe("bucketDef", () => {
  it("knows every bucket the platform writes into", () => {
    for (const name of ["3d", "image3d", "video", "images", "sdk", "requests"]) {
      expect(bucketDef(name)?.label.length).toBeGreaterThan(0);
    }
    expect(bucketDef("nope")).toBeUndefined();
  });

  it("references the configured asset host", () => {
    expect(ASSET_HOST).toBe("atelier-assets");
    expect(fnvHex(GLB)).toHaveLength(8);
  });
});
