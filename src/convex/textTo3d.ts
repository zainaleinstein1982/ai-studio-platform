// STEP 06 · Text → 3D module — Convex surface.
//
// Workflow: receive → validate → optimize → router → submit → poll →
// download (GLB · FBX · OBJ) → history → retry → webhook → storage.
// Decision logic lives in ./threeD/pipeline.ts (pure + unit-tested);
// this file persists tasks, drives polling on the scheduler, and exposes
// the console + HTTP APIs.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import {
  TEXT3D_PROVIDER_IDS,
  submitTask,
  advanceTask,
  downloadTask,
  buildOutputUrls,
  retryTask,
  applyText3dWebhook,
  type Text3dProviderId,
  type Text3dTask,
} from "./threeD/pipeline";
import { verifyWebhookSignature } from "./providers/sdk";
import type { Doc, Id } from "./_generated/dataModel";

type Text3dTaskDoc = Doc<"text3dTasks">;

function toPipelineTask(doc: Text3dTaskDoc): Text3dTask {
  return {
    id: doc._id,
    provider: doc.provider as Text3dProviderId,
    model: doc.model,
    prompt: doc.prompt,
    optimizedPrompt: doc.optimizedPrompt,
    status: doc.status,
    createdAt: doc.createdAt,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    durationMs: doc.durationMs,
    attempts: doc.attempts,
    error: doc.error,
    outputs: doc.glbUrl
      ? { glb: doc.glbUrl, fbx: doc.fbxUrl ?? "", obj: doc.objUrl ?? "" }
      : undefined,
  };
}

function patchFromTask(ctx: MutationCtx, id: Id<"text3dTasks">, task: Text3dTask) {
  return ctx.db.patch(id, {
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
    attempts: task.attempts,
    glbUrl: task.outputs?.glb,
    fbxUrl: task.outputs?.fbx,
    objUrl: task.outputs?.obj,
  });
}

/** Shared enqueue: inserts the task row and schedules the polling worker. */
async function enqueueTask(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: { prompt: string; preferredProvider?: string; preferredModel?: string },
) {
  const submitted = submitTask({ ...input, now: Date.now() });
  if (!submitted.ok || !submitted.task) {
    throw new Error(submitted.error ?? "Submission failed");
  }
  const t = submitted.task;
  const taskId = await ctx.db.insert("text3dTasks", {
    userId,
    provider: t.provider,
    model: t.model,
    prompt: t.prompt,
    optimizedPrompt: t.optimizedPrompt,
    status: t.status,
    durationMs: t.durationMs,
    attempts: t.attempts,
    createdAt: t.createdAt,
  });
  await ctx.scheduler.runAfter(600, api.textTo3d.advance, { taskId });
  return { taskId, task: t };
}

/* ------------------------------------------------------------------ */
/* Submit (console path)                                               */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    prompt: v.string(),
    preferredProvider: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { taskId, task } = await enqueueTask(ctx, user._id, args);
    return {
      taskId,
      status: task.status,
      provider: task.provider,
      model: task.model,
      optimizedPrompt: task.optimizedPrompt,
    };
  },
});

/** HTTP proxy path — submit authenticated by an API key. */
export const createViaKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
    prompt: v.string(),
    preferredProvider: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.revokedAt) throw new Error("Invalid API key");
    const { taskId, task } = await enqueueTask(ctx, key.userId, args);
    return {
      taskId,
      status: task.status,
      provider: task.provider,
      model: task.model,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Polling (scheduled worker)                                          */
/* ------------------------------------------------------------------ */

export const advance = mutation({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const doc = await ctx.db.get(taskId);
    if (!doc) return;
    const next = advanceTask(toPipelineTask(doc), Date.now());
    await patchFromTask(ctx, taskId, next);
    if (next.status === "queued" || next.status === "processing") {
      await ctx.scheduler.runAfter(900, api.textTo3d.advance, { taskId });
    }
  },
});

/* ------------------------------------------------------------------ */
/* Retry · Cancel                                                      */
/* ------------------------------------------------------------------ */

export const retry = mutation({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) throw new Error("Task not found");
    const result = retryTask(toPipelineTask(doc), Date.now());
    if (!result.ok || !result.task) throw new Error(result.error ?? "Retry failed");
    await patchFromTask(ctx, taskId, result.task);
    await ctx.scheduler.runAfter(600, api.textTo3d.advance, { taskId });
    return { taskId, status: result.task.status, attempts: result.task.attempts };
  },
});

export const cancel = mutation({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) throw new Error("Task not found");
    if (doc.status === "queued" || doc.status === "processing") {
      await ctx.db.patch(taskId, { status: "cancelled", completedAt: Date.now() });
    }
    return { taskId, status: (await ctx.db.get(taskId))?.status };
  },
});

/* ------------------------------------------------------------------ */
/* Queries — status, download, history                                 */
/* ------------------------------------------------------------------ */

export const get = query({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) return null;
    return doc;
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("text3dTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

export const download = query({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { ok: false, error: "Not authenticated" };
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) return { ok: false, error: "Task not found" };
    return downloadTask(toPipelineTask(doc));
  },
});

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

/** Simulate delivery: the console signs with the provider secret; server verifies. */
export const deliverWebhook = mutation({
  args: {
    taskId: v.id("text3dTasks"),
    event: v.string(),
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { taskId, event, payload, signature }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) throw new Error("Task not found");

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

    const next = applyText3dWebhook(toPipelineTask(doc), event, Date.now());
    await patchFromTask(ctx, taskId, next);
    return { taskId, status: next.status, verified: true };
  },
});

/** Inbound HTTP webhook path — verified against the task owner's secret. */
export const verifyAndApplyWebhook = mutation({
  args: {
    taskId: v.id("text3dTasks"),
    event: v.string(),
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { taskId, event, payload, signature }) => {
    const doc = await ctx.db.get(taskId);
    if (!doc) throw new Error("Task not found");
    const secretDoc = await ctx.db
      .query("providerWebhookSecrets")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", doc.userId).eq("provider", doc.provider),
      )
      .first();
    if (!secretDoc) throw new Error("No webhook secret configured for this provider");

    const valid = await verifyWebhookSignature(secretDoc.secret, payload, signature);
    if (!valid) throw new Error("Invalid webhook signature");

    const next = applyText3dWebhook(toPipelineTask(doc), event, Date.now());
    await patchFromTask(ctx, taskId, next);
    return { taskId, status: next.status, verified: true };
  },
});

/** Public helpers for the HTTP proxy. */
export const getPublic = query({
  args: { taskId: v.id("text3dTasks") },
  handler: async (ctx, { taskId }) => {
    const doc = await ctx.db.get(taskId);
    if (!doc) return null;
    const urls = doc.glbUrl
      ? { glb: doc.glbUrl, fbx: doc.fbxUrl ?? "", obj: doc.objUrl ?? "" }
      : null;
    return {
      id: doc._id,
      status: doc.status,
      provider: doc.provider,
      model: doc.model,
      prompt: doc.prompt,
      optimizedPrompt: doc.optimizedPrompt,
      attempts: doc.attempts,
      error: doc.error ?? null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt ?? null,
      outputs: urls,
    };
  },
});

export { TEXT3D_PROVIDER_IDS, buildOutputUrls };
