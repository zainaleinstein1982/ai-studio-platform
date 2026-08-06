// AI Gateway Router — STEP 04 architecture.
//
//   ingress ─▶ validation ─▶ auth & key policy ─▶ circuit breaker
//      ─▶ queue (scheduler) ─▶ worker: provider attempt (retry · timeout)
//      ─▶ streaming chunks ─▶ storage ─▶ history & billing
//
// The queue and background tasks run on the Convex scheduler; the provider
// layer is abstracted in ./gateway/providers.ts so real upstreams can be
// swapped in for the simulated adapters.
import { v } from "convex/values";
import { action, mutation, query, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { KIND_META, type GatewayKind } from "./catalog";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import { enforceRateLimit } from "./rateLimit";
import { checkGatewayKey } from "./apiKeys";
import { validateRequest } from "./gateway/validation";
import { adapterFor, prepareProviderCall, providerHealthList, recordProviderOutcome } from "./gateway/providers";
import { withTimeout } from "./gateway/retry";
import type { Id } from "./_generated/dataModel";

const MAX_ATTEMPTS = 2; // 1 initial + 1 retry

interface RequestEvent {
  stage: string;
  at: number;
  detail?: string;
}

async function appendEvent(
  ctx: MutationCtx,
  requestId: Id<"gatewayRequests">,
  events: RequestEvent[] | undefined,
  stage: string,
  detail?: string,
): Promise<RequestEvent[]> {
  const next = [...(events ?? []), { stage, at: Date.now(), detail }];
  await ctx.db.patch(requestId, { events: next });
  return next;
}

/* ------------------------------------------------------------------ */
/* Enqueue (shared by the console mutation and the HTTP proxy)         */
/* ------------------------------------------------------------------ */

interface EnqueueInput {
  userId: Id<"users">;
  apiKeyId?: Id<"apiKeys">;
  kind: GatewayKind;
  provider: string;
  model: string;
  prompt: string;
  imageUrl?: string;
  imageName?: string;
  stream?: boolean;
  simulateFailure?: boolean;
  cost: number;
}

async function enqueueRequest(ctx: MutationCtx, input: EnqueueInput): Promise<Id<"gatewayRequests">> {
  const now = Date.now();
  const requestId = await ctx.db.insert("gatewayRequests", {
    userId: input.userId,
    apiKeyId: input.apiKeyId,
    kind: input.kind,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    imageName: input.imageName,
    status: "queued",
    credits: input.cost,
    stream: input.stream,
    simulateFailure: input.simulateFailure,
    attempts: 0,
    events: [
      { stage: "accepted", at: now },
      { stage: "queued", at: now },
    ],
    createdAt: now,
  });
  // Task queue: the worker picks this up shortly.
  await ctx.scheduler.runAfter(1200, api.gateway.process, { requestId });
  return requestId;
}

/* ------------------------------------------------------------------ */
/* Ingress                                                            */
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
    stream: v.optional(v.boolean()),
    simulateFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    await enforceRateLimit(ctx, {
      name: "gateway-send",
      key: user._id,
      limit: 20,
      windowMs: 10_000,
    });

    // STEP 04 · Request validation.
    const valid = validateRequest({
      kind: args.kind,
      provider: args.provider,
      model: args.model,
      prompt: args.prompt,
      hasImage: Boolean(args.imageStorageId),
    });
    if (!valid.ok) throw new Error(valid.reason);
    const kind = args.kind as GatewayKind;

    // STEP 04 · Circuit breaker before routing.
    const breaker = await prepareProviderCall(ctx, args.provider, Date.now());
    if (!breaker.allow) {
      throw new Error(`Provider ${args.provider} is unavailable: ${breaker.reason}`);
    }

    const cost = KIND_META[kind].credits;
    if ((user.credits ?? 0) < cost) {
      throw new Error(
        `Insufficient credits — ${KIND_META[kind].label} costs ${cost} credits. Top up on the Billing page.`,
      );
    }

    // STEP 03 · key policy when routing through a key.
    if (args.apiKeyId) {
      const key = await ctx.db.get(args.apiKeyId);
      if (!key || key.userId !== user._id) throw new Error("Invalid API key");
      const check = await checkGatewayKey(ctx, key, kind, Date.now());
      if (!check.ok) throw new Error(check.reason);
      await ctx.runMutation(api.apiKeys.touch, { id: key._id });
    }

    let imageUrl: string | undefined;
    if (args.imageStorageId) {
      imageUrl = (await ctx.storage.getUrl(args.imageStorageId)) ?? undefined;
    }

    const requestId = await enqueueRequest(ctx, {
      userId: user._id,
      apiKeyId: args.apiKeyId,
      kind,
      provider: args.provider,
      model: args.model,
      prompt: args.prompt,
      imageUrl,
      imageName: args.imageName,
      stream: args.stream,
      simulateFailure: args.simulateFailure,
      cost,
    });
    return { requestId };
  },
});

/** Reverse-proxy path: enqueue a request authenticated by an API key. */
export const sendViaKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
    kind: v.string(),
    provider: v.string(),
    model: v.string(),
    prompt: v.string(),
    imageName: v.optional(v.string()),
    stream: v.optional(v.boolean()),
    simulateFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.revokedAt) throw new Error("Invalid API key");

    const valid = validateRequest({
      kind: args.kind,
      provider: args.provider,
      model: args.model,
      prompt: args.prompt,
      hasImage: Boolean(args.imageName),
    });
    if (!valid.ok) throw new Error(valid.reason);
    const kind = args.kind as GatewayKind;

    const breaker = await prepareProviderCall(ctx, args.provider, Date.now());
    if (!breaker.allow) {
      throw new Error(`Provider ${args.provider} is unavailable: ${breaker.reason}`);
    }

    const user = await ctx.db.get(key.userId);
    const cost = KIND_META[kind].credits;
    if (!user || (user.credits ?? 0) < cost) {
      throw new Error(`Insufficient credits for ${KIND_META[kind].label}`);
    }

    const check = await checkGatewayKey(ctx, key, kind, Date.now());
    if (!check.ok) throw new Error(check.reason);

    await ctx.runMutation(api.apiKeys.touch, { id: key._id });

    const requestId = await enqueueRequest(ctx, {
      userId: key.userId,
      apiKeyId: key._id,
      kind,
      provider: args.provider,
      model: args.model,
      prompt: args.prompt,
      imageName: args.imageName,
      stream: args.stream,
      simulateFailure: args.simulateFailure,
      cost,
    });
    return { requestId };
  },
});

/* ------------------------------------------------------------------ */
/* Worker (background tasks on the scheduler)                          */
/* ------------------------------------------------------------------ */

/** Worker pick-up — queued → processing. */
export const markProcessing = mutation({
  args: { requestId: v.id("gatewayRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "queued") return;
    await ctx.db.patch(requestId, {
      status: "processing",
      startedAt: Date.now(),
      events: [...(request.events ?? []), { stage: "dequeued", at: Date.now(), detail: "worker picked up" }],
    });
  },
});

/** Background task — route the provider attempt through the pipeline. */
export const process = action({
  args: { requestId: v.id("gatewayRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.runQuery(api.gateway.getById, { requestId });
    if (!request || request.status !== "queued") return;
    await ctx.runMutation(api.gateway.markProcessing, { requestId });
    await ctx.scheduler.runAfter(700, api.gateway.attempt, {
      requestId,
      attemptNumber: 1,
    });
  },
});

/** One provider attempt — with retry, timeout, and breaker accounting. */
export const attempt = mutation({
  args: {
    requestId: v.id("gatewayRequests"),
    attemptNumber: v.number(),
  },
  handler: async (ctx, { requestId, attemptNumber }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "processing") return;
    const now = Date.now();

    const adapter = adapterFor(request.provider);
    if (!adapter) {
      await appendEvent(ctx, requestId, request.events, "failed", `unknown provider ${request.provider}`);
      await ctx.db.patch(requestId, {
        status: "failed",
        error: `Unknown provider ${request.provider}`,
        attempts: attemptNumber,
        completedAt: now,
      });
      return;
    }

    try {
      // Provider abstraction: call through the adapter, bounded by timeout.
      const result = await withTimeout(
        adapter.call({
          kind: request.kind as GatewayKind,
          model: request.model,
          prompt: request.prompt,
          imageName: request.imageName ?? undefined,
        }),
        adapter.timeoutMs,
      );

      // Dev tool: force an outage on every attempt to exercise retry + breaker.
      if (request.simulateFailure) {
        throw new Error("Simulated provider outage");
      }

      await recordProviderOutcome(ctx, request.provider, true, now);
      await ctx.db.patch(requestId, {
        attempts: attemptNumber,
        events: [...(request.events ?? []), { stage: "attempt", at: now, detail: `ok on attempt ${attemptNumber} · ${adapter.label}` }],
      });

      if (request.stream) {
        // Streaming: deliver the payload in chunks, then complete.
        const text = result.text;
        const size = text.length;
        const cut = (f: number) => text.slice(0, Math.floor(size * f));
        const lat = Math.max(300, Math.floor(result.latencyMs * 0.2));
        await ctx.scheduler.runAfter(lat, api.gateway.appendChunk, { requestId, partialText: cut(0.3) });
        await ctx.scheduler.runAfter(lat * 2, api.gateway.appendChunk, { requestId, partialText: cut(0.6) });
        await ctx.scheduler.runAfter(lat * 3, api.gateway.appendChunk, { requestId, partialText: cut(0.85) });
        await ctx.scheduler.runAfter(lat * 4, api.gateway.complete, {
          requestId,
          responseText: text,
          latencyMs: result.latencyMs,
        });
      } else {
        await ctx.scheduler.runAfter(
          Math.max(400, Math.floor(result.latencyMs * 0.8)),
          api.gateway.complete,
          { requestId, responseText: result.text, latencyMs: result.latencyMs },
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Provider call failed";
      await recordProviderOutcome(ctx, request.provider, false, now);

      if (attemptNumber < MAX_ATTEMPTS) {
        // Retry with backoff — the queue reschedules the worker.
        await ctx.db.patch(requestId, {
          attempts: attemptNumber,
          events: [
            ...(request.events ?? []),
            { stage: "attempt", at: now, detail: `attempt ${attemptNumber} failed: ${msg}` },
            { stage: "retry", at: now, detail: `retrying in ~1.2s (${attemptNumber}/${MAX_ATTEMPTS})` },
          ],
        });
        await ctx.scheduler.runAfter(1200, api.gateway.attempt, {
          requestId,
          attemptNumber: attemptNumber + 1,
        });
      } else {
        await ctx.db.patch(requestId, {
          status: "failed",
          error: msg,
          attempts: attemptNumber,
          completedAt: now,
          events: [
            ...(request.events ?? []),
            { stage: "attempt", at: now, detail: `attempt ${attemptNumber} failed: ${msg}` },
            { stage: "failed", at: now, detail: msg },
          ],
        });
      }
    }
  },
});

/** Streaming delivery — appends partial text without completing. */
export const appendChunk = mutation({
  args: {
    requestId: v.id("gatewayRequests"),
    partialText: v.string(),
  },
  handler: async (ctx, { requestId, partialText }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "processing") return;
    await ctx.db.patch(requestId, {
      responseText: partialText,
      events: [
        ...(request.events ?? []),
        { stage: "chunk", at: Date.now(), detail: `streamed ${partialText.length} chars` },
      ],
    });
  },
});

/** Final hop — persist the response and charge billing. */
export const complete = mutation({
  args: {
    requestId: v.id("gatewayRequests"),
    responseText: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, { requestId, responseText, latencyMs }) => {
    const request = await ctx.db.get(requestId);
    if (!request || (request.status !== "queued" && request.status !== "processing")) {
      return;
    }
    await ctx.db.patch(requestId, {
      status: "completed",
      responseText,
      latencyMs,
      completedAt: Date.now(),
      events: [...(request.events ?? []), { stage: "completed", at: Date.now(), detail: `${latencyMs}ms · ${request.credits} credit${request.credits > 1 ? "s" : ""}` }],
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

/** A request is visible to a key's owner (HTTP poll endpoint). */
export const getRequestForKey = query({
  args: { keyId: v.id("apiKeys"), requestId: v.id("gatewayRequests") },
  handler: async (ctx, { keyId, requestId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) return null;
    const request = await ctx.db.get(requestId);
    if (!request || request.userId !== key.userId) return null;
    return request;
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

/** STEP 04 · live provider health for the console panel. */
export const providerHealth = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await providerHealthList(ctx);
  },
});
