// AI Gateway Router — accept, queue, route, and bill every request.
//
// Lifecycle (mirrors the AI Platform workflow):
//   send (queued) ──scheduler──▶ process (processing) ──scheduler──▶ complete
//   Each hop is simulated by the platform's worker queue; in production the
//   scheduler step would be a Celery-style worker draining a Redis queue.
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import {
  GATEWAY_KINDS,
  KIND_META,
  PROVIDER_MODELS,
  type GatewayKind,
  simulateResponse,
} from "./catalog";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import { enforceRateLimit } from "./rateLimit";

/* ------------------------------------------------------------------ */
/* Gateway router — entry point                                        */
/* ------------------------------------------------------------------ */

export const send = mutation({
  args: {
    kind: v.string(),
    provider: v.string(),
    model: v.string(),
    prompt: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    imageName: v.optional(v.string()),
    apiKeyId: v.optional(v.id("apiKeys")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // STEP 02 · Permission middleware + rate limit (20 calls / 10s per user).
    await enforceRateLimit(ctx, {
      name: "gateway-send",
      key: user._id,
      limit: 20,
      windowMs: 10_000,
    });

    if (!GATEWAY_KINDS.includes(args.kind as GatewayKind)) {
      throw new Error("Unknown request kind");
    }
    const kind = args.kind as GatewayKind;

    const group = PROVIDER_MODELS[kind].find((g) => g.provider === args.provider);
    if (!group || !group.models.includes(args.model)) {
      throw new Error(`Unsupported provider/model for ${KIND_META[kind].label}`);
    }
    if (!args.prompt.trim()) throw new Error("Prompt cannot be empty");

    const cost = KIND_META[kind].credits;
    if ((user.credits ?? 0) < cost) {
      throw new Error(
        `Insufficient credits — ${KIND_META[kind].label} costs ${cost} credits. Top up on the Billing page.`,
      );
    }

    // Optional: route the request through one of the user's API keys.
    if (args.apiKeyId) {
      const key = await ctx.db.get(args.apiKeyId);
      if (!key || key.userId !== user._id || key.revokedAt) {
        throw new Error("Invalid API key");
      }
      await ctx.runMutation(api.apiKeys.touch, { id: key._id });
    }

    let imageUrl: string | undefined;
    if (args.imageStorageId) {
      imageUrl = (await ctx.storage.getUrl(args.imageStorageId)) ?? undefined;
    }

    const requestId = await ctx.db.insert("gatewayRequests", {
      userId: user._id,
      apiKeyId: args.apiKeyId,
      kind,
      provider: args.provider,
      model: args.model,
      prompt: args.prompt,
      imageUrl,
      imageName: args.imageName,
      status: "queued",
      credits: cost,
      createdAt: Date.now(),
    });

    // Enqueue — the worker (scheduler) picks this up shortly.
    await ctx.scheduler.runAfter(1500, api.gateway.process, { requestId });
    return { requestId };
  },
});

/* ------------------------------------------------------------------ */
/* Worker hops (queue → provider → storage)                            */
/* ------------------------------------------------------------------ */

/** Worker hop 1 — mark the request as processing (drained from queue). */
export const markProcessing = mutation({
  args: { requestId: v.id("gatewayRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "queued") return;
    await ctx.db.patch(requestId, { status: "processing", startedAt: Date.now() });
  },
});

/** Worker hop 2 — call the provider, then hand off to completion. */
export const process = action({
  args: { requestId: v.id("gatewayRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.runQuery(api.gateway.getById, { requestId });
    if (!request || request.status !== "queued") return;

    await ctx.runMutation(api.gateway.markProcessing, { requestId });

    // Simulated provider round trip — the modelled latency becomes the wait
    // before the final scheduler hop.
    const sim = simulateResponse({
      kind: request.kind as GatewayKind,
      provider: request.provider,
      model: request.model,
      prompt: request.prompt,
      imageName: request.imageName ?? undefined,
    });

    await ctx.scheduler.runAfter(
      sim.latencyMs,
      api.gateway.complete,
      { requestId, responseText: sim.text, latencyMs: sim.latencyMs },
    );
  },
});

/** Worker hop 3 — persist the result, then charge billing. */
export const complete = mutation({
  args: {
    requestId: v.id("gatewayRequests"),
    responseText: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, { requestId, responseText, latencyMs }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "queued" && request.status !== "processing") {
      return;
    }
    await ctx.db.patch(requestId, {
      status: "completed",
      responseText,
      latencyMs,
      completedAt: Date.now(),
    });

    const user = await ctx.db.get(request.userId);
    if (user) {
      await ctx.db.patch(user._id, {
        credits: Math.max(0, (user.credits ?? 0) - request.credits),
      });
    }
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export const getById = query({
  args: { requestId: v.id("gatewayRequests") },
  handler: async (ctx, { requestId }) => {
    return await ctx.db.get(requestId);
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("gatewayRequests")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const requests = await ctx.db
      .query("gatewayRequests")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(300);

    const completed = requests.filter((r) => r.status === "completed");
    const failed = requests.filter((r) => r.status === "failed");
    const creditsUsed = completed.reduce((sum, r) => sum + r.credits, 0);
    const avgLatency = completed.length
      ? Math.round(completed.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / completed.length)
      : 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const requestsToday = requests.filter((r) => r.createdAt >= startOfToday.getTime()).length;

    const byProvider: Record<string, number> = {};
    for (const r of completed) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.credits;
    }

    const byDay: { label: string; credits: number; requests: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(startOfToday);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86_400_000;
      const dayRequests = requests.filter(
        (r) => r.createdAt >= dayStart.getTime() && r.createdAt < dayEnd,
      );
      byDay.push({
        label: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
        credits: dayRequests.reduce((sum, r) => sum + r.credits, 0),
        requests: dayRequests.length,
      });
    }

    return {
      credits: user.credits ?? 0,
      plan: user.plan ?? "starter",
      totalRequests: requests.length,
      completedRequests: completed.length,
      failedRequests: failed.length,
      inFlight: requests.filter(
        (r) => r.status === "queued" || r.status === "processing",
      ).length,
      creditsUsed,
      avgLatency,
      requestsToday,
      byProvider: Object.entries(byProvider)
        .map(([provider, credits]) => ({ provider, credits }))
        .sort((a, b) => b.credits - a.credits),
      byDay,
    };
  },
});
