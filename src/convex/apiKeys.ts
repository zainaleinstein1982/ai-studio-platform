// API Key Platform — issue, list, and revoke gateway keys.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { generateSecret, secretPrefix, sha256Hex } from "./keygen";
import { enforceRateLimit } from "./rateLimit";

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

    // Permission middleware: limit key issuance per user.
    await enforceRateLimit(ctx, {
      name: "api-key-create",
      key: user._id,
      limit: 5,
      windowMs: 60_000,
    });

    const secret = generateSecret();
    const keyHash = await sha256Hex(secret);
    const prefix = secretPrefix(secret);

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
