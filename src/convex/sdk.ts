// STEP 05 · Provider SDK — Convex surface.
//
// Persists SDK jobs in the providerJobs table, drives the lifecycle with the
// scheduler (queued → processing → completed), and exposes the six-operation
// contract: authenticate · generate · status · cancel · download · webhook.
// All the decision logic lives in ./providers/sdk.ts (pure + unit-tested);
// this file is a thin persistence/scheduling wrapper.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import {
  SDK_PROVIDERS,
  sdkProviderById,
  authenticate,
  generateJob,
  advanceJob,
  cancelJob,
  downloadJob,
  applyWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./providers/sdk";
import type { Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const providers = query({
  args: {},
  handler: async () => {
    return SDK_PROVIDERS;
  },
});

/* ------------------------------------------------------------------ */
/* 1 · Authenticate                                                    */
/* ------------------------------------------------------------------ */

export const authenticateCredential = mutation({
  args: { provider: v.string(), credential: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return authenticate(args.provider, args.credential);
  },
});

/* ------------------------------------------------------------------ */
/* 2 · Generate                                                        */
/* ------------------------------------------------------------------ */

export const generate = mutation({
  args: {
    provider: v.string(),
    model: v.string(),
    prompt: v.string(),
    imageName: v.optional(v.string()),
    credential: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const provider = sdkProviderById(args.provider);
    if (!provider) throw new Error(`Unknown provider "${args.provider}"`);

    const generated = generateJob({
      provider,
      model: args.model,
      prompt: args.prompt,
      imageName: args.imageName,
      now: Date.now(),
      credential: args.credential,
    });
    if (!generated.ok || !generated.job) {
      throw new Error(generated.error ?? "Generation failed");
    }
    const job = generated.job;

    const jobId = await ctx.db.insert("providerJobs", {
      userId: user._id,
      provider: provider.id,
      model: job.model,
      prompt: job.prompt,
      imageName: job.imageName,
      status: job.status,
      durationMs: job.durationMs,
      attempts: job.attempts,
      createdAt: job.createdAt,
    });

    await ctx.scheduler.runAfter(600, api.sdk.advance, { jobId });
    return { jobId, status: job.status, durationMs: job.durationMs };
  },
});

/** Scheduled worker — advance the job lifecycle and keep ticking until terminal. */
export const advance = mutation({
  args: { jobId: v.id("providerJobs") },
  handler: async (ctx, { jobId }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) return;
    const next = advanceJob(
      {
        id: doc._id,
        provider: doc.provider,
        model: doc.model,
        prompt: doc.prompt,
        imageName: doc.imageName,
        status: doc.status,
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
        durationMs: doc.durationMs,
        outputText: doc.outputText,
        outputUrl: doc.outputUrl,
        error: doc.error,
        attempts: doc.attempts ?? 1,
      },
      Date.now(),
    );
    await ctx.db.patch(jobId, {
      status: next.status,
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      outputText: next.outputText,
      outputUrl: next.outputUrl,
      error: next.error,
      attempts: next.attempts,
    });
    if (next.status === "queued" || next.status === "processing") {
      await ctx.scheduler.runAfter(900, api.sdk.advance, { jobId });
    }
  },
});

/* ------------------------------------------------------------------ */
/* 4 · Cancel                                                          */
/* ------------------------------------------------------------------ */

export const cancel = mutation({
  args: { jobId: v.id("providerJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.userId !== user._id) throw new Error("Job not found");
    const next = cancelJob(
      {
        id: doc._id,
        provider: doc.provider,
        model: doc.model,
        prompt: doc.prompt,
        imageName: doc.imageName,
        status: doc.status,
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
        durationMs: doc.durationMs,
        outputText: doc.outputText,
        outputUrl: doc.outputUrl,
        error: doc.error,
        attempts: doc.attempts ?? 1,
      },
      Date.now(),
    );
    await ctx.db.patch(jobId, {
      status: next.status,
      completedAt: next.completedAt,
    });
    return { jobId, status: next.status };
  },
});

/* ------------------------------------------------------------------ */
/* 3 · Status · 5 · Download                                           */
/* ------------------------------------------------------------------ */

export const status = query({
  args: { jobId: v.id("providerJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.userId !== user._id) return null;
    return doc;
  },
});

export const download = query({
  args: { jobId: v.id("providerJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { ok: false, error: "Not authenticated" };
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.userId !== user._id) return { ok: false, error: "Job not found" };
    return downloadJob({
      id: doc._id,
      provider: doc.provider,
      model: doc.model,
      prompt: doc.prompt,
      imageName: doc.imageName,
      status: doc.status,
      createdAt: doc.createdAt,
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
      durationMs: doc.durationMs,
      outputText: doc.outputText,
      outputUrl: doc.outputUrl,
      error: doc.error,
      attempts: doc.attempts ?? 1,
    });
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("providerJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

/* ------------------------------------------------------------------ */
/* 6 · Webhook                                                         */
/* ------------------------------------------------------------------ */

export const webhookSecret = query({
  args: { provider: v.string() },
  handler: async (ctx, { provider }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id).eq("provider", provider))
      .first();
  },
});

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const generateWebhookSecret = mutation({
  args: { provider: v.string() },
  handler: async (ctx, { provider }) => {
    const user = await requireUser(ctx);
    if (!sdkProviderById(provider)) throw new Error(`Unknown provider "${provider}"`);

    const secret = `whsec_${randomHex(16)}`;
    const existing = await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id).eq("provider", provider))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { secret, secretPrefix: `whsec_${secret.slice(6, 10)}…` });
    } else {
      await ctx.db.insert("providerWebhookSecrets", {
        userId: user._id,
        provider,
        secret,
        secretPrefix: `whsec_${secret.slice(6, 10)}…`,
        createdAt: Date.now(),
      });
    }
    return { secret };
  },
});

/**
 * Deliver (simulate) a webhook for a job. The console signs the payload with
 * the provider secret in the browser, sends the signature over, and the
 * server verifies it before reconciling the job — the same path a real
 * inbound webhook takes.
 */
export const deliverWebhook = mutation({
  args: {
    jobId: v.id("providerJobs"),
    event: v.string(),
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { jobId, event, payload, signature }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(jobId);
    if (!doc || doc.userId !== user._id) throw new Error("Job not found");

    const secretDoc = await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", doc.provider),
      )
      .first();
    if (!secretDoc) {
      throw new Error(`No webhook secret for ${doc.provider} — generate one first`);
    }

    const valid = await verifyWebhookSignature(secretDoc.secret, payload, signature);
    if (!valid) throw new Error("Invalid webhook signature");

    const next = applyWebhookEvent(
      {
        id: doc._id,
        provider: doc.provider,
        model: doc.model,
        prompt: doc.prompt,
        imageName: doc.imageName,
        status: doc.status,
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
        durationMs: doc.durationMs,
        outputText: doc.outputText,
        outputUrl: doc.outputUrl,
        error: doc.error,
        attempts: doc.attempts ?? 1,
      },
      event,
      Date.now(),
    );
    await ctx.db.patch(jobId, {
      status: next.status,
      completedAt: next.completedAt,
      outputText: next.outputText,
      outputUrl: next.outputUrl,
      error: next.error,
    });
    return { jobId, status: next.status, verified: true };
  },
});

/** Sign helper exposed so the console can prepare a payload (server-side variant). */
export const signPayload = mutation({
  args: { provider: v.string(), payload: v.string() },
  handler: async (ctx, { provider, payload }) => {
    const user = await requireUser(ctx);
    const secretDoc = await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id).eq("provider", provider))
      .first();
    if (!secretDoc) throw new Error("No webhook secret — generate one first");
    return { signature: await signWebhookPayload(secretDoc.secret, payload) };
  },
});

/* ------------------------------------------------------------------ */
/* Internal helpers for the HTTP webhook route                         */
/* ------------------------------------------------------------------ */

/** Find a job by id regardless of caller (used by the HTTP webhook route). */
export const getJobPublic = query({
  args: { jobId: v.id("providerJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

/** Verify + apply an inbound webhook for a job owned by the secret's user. */
export const verifyAndApplyWebhook = mutation({
  args: {
    jobId: v.id("providerJobs"),
    event: v.string(),
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { jobId, event, payload, signature }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) throw new Error("Job not found");
    const secretDoc = await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", doc.userId).eq("provider", doc.provider),
      )
      .first();
    if (!secretDoc) throw new Error("No webhook secret configured for this provider");
    const valid = await verifyWebhookSignature(secretDoc.secret, payload, signature);
    if (!valid) throw new Error("Invalid webhook signature");
    const next = applyWebhookEvent(
      {
        id: doc._id,
        provider: doc.provider,
        model: doc.model,
        prompt: doc.prompt,
        imageName: doc.imageName,
        status: doc.status,
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
        durationMs: doc.durationMs,
        outputText: doc.outputText,
        outputUrl: doc.outputUrl,
        error: doc.error,
        attempts: doc.attempts ?? 1,
      },
      event,
      Date.now(),
    );
    await ctx.db.patch(jobId, {
      status: next.status,
      completedAt: next.completedAt,
      outputText: next.outputText,
      outputUrl: next.outputUrl,
      error: next.error,
    });
    return { jobId, status: next.status, verified: true };
  },
});

export type { Id };
export type MutationCtxType = MutationCtx;
