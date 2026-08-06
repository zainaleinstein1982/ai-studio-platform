// API Key Platform — issue, list, and revoke gateway keys.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

const KEY_PREFIX = "apk_live_";

/** sha-256 hex digest — the full secret is never stored, only its hash. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSecret(): string {
  return `${KEY_PREFIX}${randomHex(24)}`;
}

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
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  },
});

export const create = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");

    const secret = generateSecret();
    const keyHash = await sha256Hex(secret);
    const prefix = `${secret.slice(0, 16)}…`;

    const id = await ctx.db.insert("apiKeys", {
      userId: user._id,
      name: name?.trim() ? name.trim() : "Default key",
      prefix,
      keyHash,
      createdAt: Date.now(),
    });

    // The full secret is returned exactly once.
    return { id, secret };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, { id }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const key = await ctx.db.get(id);
    if (!key || key.userId !== user._id) throw new Error("Key not found");
    if (key.revokedAt) return;
    await ctx.db.patch(id, { revokedAt: Date.now() });
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
