// STEP 07 · Image → 3D module — Convex surface.
//
// Workflow: upload → background removal → enhancement → vision caption →
// prompt optimization → generate 3D → preview → storage → download → webhook.
// Decision logic lives in ./threeD/imagePipeline.ts (pure + unit-tested);
// this file persists tasks, drives polling on the scheduler, and exposes
// the console + HTTP APIs.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import {
  submitImageTask,
  advanceImageTask,
  downloadImageTask,
  buildImageOutputUrls,
  retryImageTask,
  applyImage3dWebhook,
  type Text3dProviderId,
  type Image3dTask,
  type UploadedImage,
} from "./threeD/imagePipeline";
import { verifyWebhookSignature } from "./providers/sdk";
import type { Doc, Id } from "./_generated/dataModel";

type Image3dTaskDoc = Doc<"image3dTasks">;

function toPipelineTask(doc: Image3dTaskDoc): Image3dTask {
  return {
    id: doc._id,
    provider: doc.provider as Text3dProviderId,
    model: doc.model,
    imageName: doc.imageName,
    imageUrl: doc.imageUrl,
    width: doc.width,
    height: doc.height,
    caption: doc.caption,
    optimizedPrompt: doc.optimizedPrompt,
    status: doc.status,
    createdAt: doc.createdAt,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    durationMs: doc.durationMs,
    attempts: doc.attempts,
    error: doc.error,
    previewUrl: doc.previewUrl,
    outputs: doc.glbUrl
      ? { glb: doc.glbUrl, fbx: doc.fbxUrl ?? "", obj: doc.objUrl ?? "" }
      : undefined,
  };
}

function patchFromTask(ctx: MutationCtx, id: Id<"image3dTasks">, task: Image3dTask) {
  return ctx.db.patch(id, {
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
    attempts: task.attempts,
    previewUrl: task.previewUrl,
    glbUrl: task.outputs?.glb,
    fbxUrl: task.outputs?.fbx,
    objUrl: task.outputs?.obj,
  });
}

interface ImageInput {
  imageName: string;
  imageUrl: string;
  width: number;
  height: number;
  avgColor: string;
  brightness: number;
  preferredProvider?: string;
  preferredModel?: string;
}

/** Shared enqueue: validates the image, inserts the row, schedules the worker. */
async function enqueueImageTask(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: ImageInput,
) {
  const image: UploadedImage = {
    name: input.imageName,
    dataUrl: input.imageUrl,
    width: input.width,
    height: input.height,
    avgColor: input.avgColor,
    brightness: input.brightness,
  };
  const submitted = submitImageTask({ image, now: Date.now() });
  if (!submitted.ok || !submitted.task) {
    throw new Error(submitted.error ?? "Submission failed");
  }
  const t = submitted.task;
  const taskId = await ctx.db.insert("image3dTasks", {
    userId,
    provider: t.provider,
    model: t.model,
    imageName: t.imageName,
    imageUrl: t.imageUrl,
    width: t.width,
    height: t.height,
    caption: t.caption,
    optimizedPrompt: t.optimizedPrompt,
    status: t.status,
    durationMs: t.durationMs,
    attempts: t.attempts,
    createdAt: t.createdAt,
  });
  await ctx.scheduler.runAfter(600, api.imageTo3d.advance, { taskId });
  return { taskId, task: t };
}

const imageArgs = {
  imageName: v.string(),
  imageUrl: v.string(), // data:image/…;base64,…
  width: v.number(),
  height: v.number(),
  avgColor: v.string(), // "#rrggbb" from the client canvas
  brightness: v.number(), // 0..1
  preferredProvider: v.optional(v.string()),
  preferredModel: v.optional(v.string()),
};

/* ------------------------------------------------------------------ */
/* Submit (console path)                                               */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: imageArgs,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { taskId, task } = await enqueueImageTask(ctx, user._id, args);
    return {
      taskId,
      status: task.status,
      provider: task.provider,
      model: task.model,
      caption: task.caption,
      optimizedPrompt: task.optimizedPrompt,
    };
  },
});

/** HTTP proxy path — submit authenticated by an API key. */
export const createViaKey = mutation({
  args: { ...imageArgs, keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const { keyId, ...input } = args;
    const key = await ctx.db.get(keyId);
    if (!key || key.revokedAt) throw new Error("Invalid API key");
    const { taskId, task } = await enqueueImageTask(ctx, key.userId, input);
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
  args: { taskId: v.id("image3dTasks") },
  handler: async (ctx, { taskId }) => {
    const doc = await ctx.db.get(taskId);
    if (!doc) return;
    const next = advanceImageTask(toPipelineTask(doc), Date.now());
    await patchFromTask(ctx, taskId, next);
    if (next.status === "queued" || next.status === "processing") {
      await ctx.scheduler.runAfter(900, api.imageTo3d.advance, { taskId });
    }
  },
});

/* ------------------------------------------------------------------ */
/* Retry · Cancel                                                      */
/* ------------------------------------------------------------------ */

export const retry = mutation({
  args: { taskId: v.id("image3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) throw new Error("Task not found");
    const result = retryImageTask(toPipelineTask(doc), Date.now());
    if (!result.ok || !result.task) throw new Error(result.error ?? "Retry failed");
    await patchFromTask(ctx, taskId, result.task);
    await ctx.scheduler.runAfter(600, api.imageTo3d.advance, { taskId });
    return { taskId, status: result.task.status, attempts: result.task.attempts };
  },
});

export const cancel = mutation({
  args: { taskId: v.id("image3dTasks") },
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
  args: { taskId: v.id("image3dTasks") },
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
      .query("image3dTasks")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});

export const download = query({
  args: { taskId: v.id("image3dTasks") },
  handler: async (ctx, { taskId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { ok: false, error: "Not authenticated" };
    const doc = await ctx.db.get(taskId);
    if (!doc || doc.userId !== user._id) return { ok: false, error: "Task not found" };
    return downloadImageTask(toPipelineTask(doc));
  },
});

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

/** Simulate delivery: the console signs with the provider secret; server verifies. */
export const deliverWebhook = mutation({
  args: {
    taskId: v.id("image3dTasks"),
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

    const next = applyImage3dWebhook(toPipelineTask(doc), event, Date.now());
    await patchFromTask(ctx, taskId, next);
    return { taskId, status: next.status, verified: true };
  },
});

/** Inbound HTTP webhook path — verified against the task owner's secret. */
export const verifyAndApplyWebhook = mutation({
  args: {
    taskId: v.id("image3dTasks"),
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

    const next = applyImage3dWebhook(toPipelineTask(doc), event, Date.now());
    await patchFromTask(ctx, taskId, next);
    return { taskId, status: next.status, verified: true };
  },
});

/** Public helpers for the HTTP proxy. */
export const getPublic = query({
  args: { taskId: v.id("image3dTasks") },
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
      imageName: doc.imageName,
      width: doc.width,
      height: doc.height,
      caption: doc.caption,
      optimizedPrompt: doc.optimizedPrompt,
      attempts: doc.attempts,
      error: doc.error ?? null,
      previewUrl: doc.previewUrl ?? null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt ?? null,
      outputs: urls,
    };
  },
});

export { buildImageOutputUrls };
