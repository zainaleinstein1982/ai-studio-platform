// STEP 08 · Video module — pure pipeline core (text → video).
//
// The full workflow, as pure functions over plain data:
//
//   receive → validate → optimize → router → queue → progress →
//   streaming → preview → history → download → webhook
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/textToVideo.ts), in the browser (the console tab), and in
// unit tests. In production the "generate" step would submit a render job to
// the Runway / Luma / Pika REST APIs and poll for progress; here the lifecycle
// is simulated deterministically, with render progress reported as frames
// streamed out of the encoder.

import { sdkProviderById, type SdkProvider } from "../providers/sdk";

/* ------------------------------------------------------------------ */
/* Provider set (video upstreams from the Provider SDK)                */
/* ------------------------------------------------------------------ */

export const VIDEO_PROVIDER_IDS = ["runway", "luma", "pika"] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDER_IDS)[number];

export interface RoutedProvider {
  provider: VideoProviderId;
  model: string;
  label: string;
}

function specOf(id: VideoProviderId): SdkProvider {
  const s = sdkProviderById(id);
  if (!s) throw new Error(`Unknown video provider ${id}`);
  return s;
}

/* ------------------------------------------------------------------ */
/* 1 · Receive · 2 · Validate                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  clean?: string;
}

export const MAX_MOTION_PROMPT_LENGTH = 2_000;

/** Motion prompts describe what moves; they are longer than object prompts. */
export function validateMotionPrompt(raw: string | undefined): ValidationResult {
  const prompt = (raw ?? "").trim();
  if (!prompt) return { ok: false, reason: "Motion prompt is empty — describe the movement to generate." };
  if (prompt.length < 6) {
    return { ok: false, reason: "Motion prompt is too short — describe the camera and subject movement." };
  }
  if (prompt.length > MAX_MOTION_PROMPT_LENGTH) {
    return { ok: false, reason: `Motion prompt exceeds ${MAX_MOTION_PROMPT_LENGTH} characters.` };
  }
  return { ok: true, clean: prompt };
}

/* ------------------------------------------------------------------ */
/* 3 · Optimize motion prompt                                          */
/* ------------------------------------------------------------------ */

/** Deterministic prompt enrichment tuned per video provider. */
const OPTIMIZERS: Record<VideoProviderId, (p: string) => string> = {
  runway: (p) =>
    `${p.trim()} — cinematic, photoreal; 24 fps; shallow depth of field; slow drifting camera; natural motion blur;`,
  luma: (p) =>
    `${p.trim()} — dreamlike, surreal fluid motion; seamless morphing; soft volumetric light; continuous flow;`,
  pika: (p) =>
    `${p.trim()} — bold stylized motion; punchy loops; playful effects; high contrast; saturated palette;`,
};

export function optimizeMotionPrompt(prompt: string, provider: VideoProviderId): string {
  const base = prompt.trim().replace(/[.!?\s]+$/, "");
  return OPTIMIZERS[provider](base).replace(/\s{2,}/g, " ");
}

/* ------------------------------------------------------------------ */
/* 4 · Provider router                                                 */
/* ------------------------------------------------------------------ */

export interface RouteInput {
  prompt: string;
  preferredProvider?: string;
  preferredModel?: string;
}

/** Pick a video provider + model. Keyword hints prefer a style; otherwise round-robin by seed. */
export function routeVideoProvider(input: RouteInput): RoutedProvider {
  const p = input.prompt.toLowerCase();

  // explicit preference wins (still validated)
  if (input.preferredProvider && VIDEO_PROVIDER_IDS.includes(input.preferredProvider as never)) {
    const id = input.preferredProvider as VideoProviderId;
    const spec = specOf(id);
    return {
      provider: id,
      model: input.preferredModel && spec.models.includes(input.preferredModel)
        ? input.preferredModel
        : spec.defaultModel,
      label: spec.label,
    };
  }

  // keyword hints
  let id: VideoProviderId = "runway";
  if (/cinemat|dolly|drone|film|document|truck|pan|zoom|tracking|aerial/i.test(p)) id = "runway";
  else if (/dream|surreal|morph|fluid|abstract|flow|fade|ethereal|warp/i.test(p)) id = "luma";
  else if (/sticker|gif|loop|memphis|pop|effect|playful|saturated|glitch/i.test(p)) id = "pika";

  const spec = specOf(id);
  return { provider: id, model: spec.defaultModel, label: spec.label };
}

/* ------------------------------------------------------------------ */
/* Task model                                                          */
/* ------------------------------------------------------------------ */

export type VideoTaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface VideoTask {
  id: string;
  provider: VideoProviderId;
  model: string;
  prompt: string;
  optimizedPrompt: string;
  status: VideoTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  attempts: number;
  error?: string;
  // video specifics
  progress: number; // 0–100 render progress
  framesRendered: number;
  totalFrames: number;
  fps: number;
  seconds: number;
  streaming: boolean; // chunks delivered as frames render
  previewUrl?: string; // poster frame
  outputUrl?: string; // mp4 clip
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** FNV-1a 32-bit — stable seed for deterministic simulation. */
function seedOf(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Render profile · duration                                           */
/* ------------------------------------------------------------------ */

export interface RenderProfile {
  fps: number;
  seconds: number;
  totalFrames: number;
}

/** Deterministic clip profile: 24 fps, 4–10 seconds. */
export function renderProfile(seedStr: string): RenderProfile {
  const fps = 24;
  const seconds = 4 + (seedOf(seedStr) % 7); // 4–10 s
  return { fps, seconds, totalFrames: seconds * fps };
}

/**
 * Deterministic simulated render duration. Video takes minutes in
 * production; the simulator compresses the lifecycle so the whole
 * pipeline is watchable end-to-end (≈ 12–25 s).
 */
export function simulatedDuration(provider: VideoProviderId, seedStr: string): number {
  const base = sdkProviderById(provider)?.durationMs ?? 40_000;
  const seed = seedOf(seedStr);
  return Math.round(base * (0.3 + (seed % 4) / 10)); // 0.3–0.6 × base
}

/* ------------------------------------------------------------------ */
/* 5 · Submit task                                                     */
/* ------------------------------------------------------------------ */

export interface SubmitInput {
  prompt: string;
  preferredProvider?: string;
  preferredModel?: string;
  now: number;
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  task?: VideoTask;
}

/** Receive → validate → optimize → route → create the queued render task. */
export function submitVideoTask(input: SubmitInput): SubmitResult {
  const validated = validateMotionPrompt(input.prompt);
  if (!validated.ok || !validated.clean) {
    return { ok: false, error: validated.reason };
  }
  const routed = routeVideoProvider({
    prompt: validated.clean,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });
  const optimized = optimizeMotionPrompt(validated.clean, routed.provider);
  const profile = renderProfile(validated.clean);
  return {
    ok: true,
    task: {
      id: `vid_${hexId(5)}`,
      provider: routed.provider,
      model: routed.model,
      prompt: validated.clean,
      optimizedPrompt: optimized,
      status: "queued",
      createdAt: input.now,
      durationMs: simulatedDuration(routed.provider, validated.clean),
      attempts: 1,
      progress: 0,
      framesRendered: 0,
      totalFrames: profile.totalFrames,
      fps: profile.fps,
      seconds: profile.seconds,
      streaming: true,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 6 · 7 · Progress & streaming (polling / status)                     */
/* ------------------------------------------------------------------ */

/**
 * Advance a task by elapsed wall time: queued → processing (frames stream),
 * then completed with the poster + mp4 artifact. Progress is reported as a
 * frame counter so the console can show live streaming progress.
 */
export function advanceVideoTask<T extends VideoTask>(task: T, now: number): T {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }
  const next: T = { ...task };
  if (next.status === "queued") {
    if (now - next.createdAt >= 500) {
      next.status = "processing";
      next.startedAt = now;
      next.progress = 0;
    }
    return next;
  }
  const startedAt = next.startedAt ?? next.createdAt;
  const elapsed = now - startedAt;
  const pct = Math.min(100, Math.round((elapsed / next.durationMs) * 100));
  next.progress = pct;
  next.framesRendered = Math.min(next.totalFrames, Math.floor((pct / 100) * next.totalFrames));
  if (pct >= 100) {
    next.status = "completed";
    next.completedAt = now;
    next.progress = 100;
    next.framesRendered = next.totalFrames;
    next.previewUrl = buildVideoPreviewUrl(next);
    next.outputUrl = buildVideoOutputUrl(next);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 8 · 10 · Preview · Storage · Download                               */
/* ------------------------------------------------------------------ */

/** Poster frame staged in the video asset bucket. */
export function buildVideoPreviewUrl(task: Pick<VideoTask, "id">): string {
  return `s3://atelier-assets/video/${task.id}/poster.jpg`;
}

/** Final H.264 clip staged in the video asset bucket. */
export function buildVideoOutputUrl(task: Pick<VideoTask, "id">): string {
  return `s3://atelier-assets/video/${task.id}/clip.mp4`;
}

export interface VideoUrls {
  previewUrl: string;
  outputUrl: string;
}

export function buildVideoUrls(task: Pick<VideoTask, "id">): VideoUrls {
  return {
    previewUrl: buildVideoPreviewUrl(task),
    outputUrl: buildVideoOutputUrl(task),
  };
}

export interface DownloadResult {
  ok: boolean;
  error?: string;
  previewUrl?: string;
  outputUrl?: string;
}

export function downloadVideoTask(task: VideoTask): DownloadResult {
  if (task.status !== "completed" || !task.outputUrl) {
    return {
      ok: false,
      error: `Task ${task.id} is ${task.status} — clip not ready`,
    };
  }
  return { ok: true, previewUrl: task.previewUrl, outputUrl: task.outputUrl };
}

/* ------------------------------------------------------------------ */
/* Retry                                                               */
/* ------------------------------------------------------------------ */

export interface RetryResult<T extends VideoTask = VideoTask> {
  ok: boolean;
  error?: string;
  task?: T;
}

/** Retry a failed/cancelled task: reset to queued, bump attempts, new timing. */
export function retryVideoTask<T extends VideoTask>(task: T, now: number): RetryResult<T> {
  if (task.status === "completed") {
    return { ok: false, error: "Task already completed — nothing to retry" };
  }
  if (task.attempts >= 3) {
    return { ok: false, error: "Maximum retries reached (3)" };
  }
  const next: T = {
    ...task,
    status: "queued",
    createdAt: now,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    attempts: task.attempts + 1,
    durationMs: simulatedDuration(task.provider, task.prompt),
    progress: 0,
    framesRendered: 0,
    previewUrl: undefined,
    outputUrl: undefined,
  };
  return { ok: true, task: next };
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

export type VideoWebhookEvent = "generation.completed" | "generation.failed";

/** Reconcile a task with an upstream webhook delivery. */
export function applyVideoWebhook<T extends VideoTask>(task: T, event: string, now: number): T {
  const next: T = { ...task };
  if (event === "generation.completed") {
    if (next.status !== "completed") {
      next.status = "completed";
      next.completedAt = now;
      next.progress = 100;
      next.framesRendered = next.totalFrames;
      next.previewUrl = buildVideoPreviewUrl(next);
      next.outputUrl = buildVideoOutputUrl(next);
      next.error = undefined;
    }
  } else if (event === "generation.failed") {
    next.status = "failed";
    next.completedAt = now;
    next.error = "Upstream reported a failure via webhook";
  }
  return next;
}
