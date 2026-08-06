// STEP 07 · Image → 3D module — pure pipeline core.
//
// The full workflow, as pure functions over plain data:
//
//   upload → background removal → enhancement → vision caption →
//   prompt optimization → generate 3D → preview → storage →
//   download → webhook
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/imageTo3d.ts), in the browser (the console tab), and in
// unit tests. The vision stages (bg removal, enhancement, captioning) are
// simulated deterministically — in production these would call a CV model
// (rembg / SAM) and a vision LLM, then POST the cleaned image to the 3D
// provider's image-to-3D endpoint.

import { sdkProviderById } from "../providers/sdk";
import {
  TEXT3D_PROVIDER_IDS,
  optimizePrompt,
  routeProvider,
  type Text3dProviderId,
} from "./pipeline";

export { TEXT3D_PROVIDER_IDS, type Text3dProviderId };

/* ------------------------------------------------------------------ */
/* 1 · Upload image                                                    */
/* ------------------------------------------------------------------ */

export interface UploadedImage {
  name: string;
  dataUrl: string; // data:image/jpeg|png|webp;base64,…
  width: number;
  height: number;
  avgColor: string; // "#rrggbb" — client-computed mean colour
  brightness: number; // 0..1 average luminance
}

export const MAX_IMAGE_DATA_URL = 900_000; // chars ≈ 675 KB decoded
export const MIN_DIM = 32;
export const MAX_DIM = 4096;

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  clean?: UploadedImage;
}

/** Reject bad uploads before any CV or 3D work happens. */
export function validateImage(image: UploadedImage | undefined): ValidationResult {
  if (!image) return { ok: false, reason: "No image uploaded." };
  const name = image.name?.trim() || "image";
  if (!image.dataUrl?.startsWith("data:image/")) {
    return { ok: false, reason: "Unsupported file — expected an image data URL." };
  }
  const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(";"));
  if (!IMAGE_MIMES.includes(mime)) {
    return { ok: false, reason: `Unsupported image type "${mime}" — use png, jpeg, or webp.` };
  }
  if (image.dataUrl.length > MAX_IMAGE_DATA_URL) {
    return { ok: false, reason: "Image is too large — uploads are downscaled to ≤ 512px." };
  }
  const w = Math.round(image.width);
  const h = Math.round(image.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN_DIM || h < MIN_DIM) {
    return { ok: false, reason: `Image is too small — minimum ${MIN_DIM}×${MIN_DIM}px.` };
  }
  if (w > MAX_DIM || h > MAX_DIM) {
    return { ok: false, reason: `Image is too large — maximum ${MAX_DIM}px per side.` };
  }
  const b = Number(image.brightness);
  if (!Number.isFinite(b) || b < 0 || b > 1) {
    return { ok: false, reason: "Image stats missing (brightness)." };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(image.avgColor ?? "")) {
    return { ok: false, reason: "Image stats missing (avg color)." };
  }
  return { ok: true, clean: { name, dataUrl: image.dataUrl, width: w, height: h, avgColor: image.avgColor, brightness: b } };
}

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit — stable fingerprint of the upload (sync, no crypto). */
export function hashImage(image: Pick<UploadedImage, "dataUrl" | "name">): number {
  const s = `${image.name}|${image.dataUrl}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function seedOf(hash: number, bank: number, len: number): number {
  return ((hash >>> (bank * 5)) ^ (hash >>> (bank * 11))) % len;
}

/* ------------------------------------------------------------------ */
/* 2 · Background removal (simulated)                                  */
/* ------------------------------------------------------------------ */

export type MaskType = "alpha" | "soft-edge" | "chroma";

export interface BgResult {
  ok: boolean;
  maskType: MaskType;
  keptPct: number; // percentage of subject pixels retained
  artifactUrl: string; // transparent PNG staged for the 3D provider
}

export function removeBackground(image: UploadedImage): BgResult {
  const hash = hashImage(image);
  const maskTypes: MaskType[] = ["alpha", "soft-edge", "chroma"];
  const maskType = maskTypes[seedOf(hash, 0, maskTypes.length)];
  const keptPct = 88 + seedOf(hash, 1, 9); // 88–96%
  const slug = (image.name || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "image";
  return {
    ok: true,
    maskType,
    keptPct,
    artifactUrl: `s3://atelier-assets/image3d/${slug}-${hash.toString(16).slice(0, 6)}-cutout.png`,
  };
}

/* ------------------------------------------------------------------ */
/* 3 · Image enhancement (simulated)                                   */
/* ------------------------------------------------------------------ */

export interface EnhanceResult {
  ok: boolean;
  contrast: number; // 1.0 = untouched
  saturation: number;
  sharpness: number; // 0–100
  artifactUrl: string;
}

export function enhanceImage(image: UploadedImage): EnhanceResult {
  const hash = hashImage(image);
  const contrast = 1.04 + seedOf(hash, 2, 12) / 100; // 1.04–1.15
  const saturation = 1.02 + seedOf(hash, 3, 18) / 100; // 1.02–1.19
  const sharpness = 55 + seedOf(hash, 4, 36); // 55–90
  return {
    ok: true,
    contrast,
    saturation,
    sharpness,
    artifactUrl: `s3://atelier-assets/image3d/${hash.toString(16).slice(0, 8)}-enhanced.png`,
  };
}

/* ------------------------------------------------------------------ */
/* 4 · Vision caption (simulated, deterministic)                       */
/* ------------------------------------------------------------------ */

function hueBucket(hex: string): { hue: string; palette: string } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.12) return { hue: "neutral", palette: "monochrome" };
  let hue = "neutral";
  let d: number;
  if (max === r) {
    d = ((g - b) / (max - min) + 6) % 6;
    hue = d > 5 || d < 0.16 ? "red" : d < 1.16 ? "orange" : d < 2.16 ? "yellow" : d < 3.16 ? "green" : d < 4.16 ? "cyan" : d < 5.16 ? "blue" : "magenta";
  } else if (max === g) {
    d = (b - r) / (max - min) + 2;
    hue = d < 0.5 ? "yellow" : d < 1.5 ? "green" : d < 2.5 ? "cyan" : "blue";
  } else {
    d = (r - g) / (max - min) + 4;
    hue = d < 0.5 ? "cyan" : d < 1.5 ? "blue" : d < 2.5 ? "magenta" : d < 3.5 ? "red" : "orange";
  }
  const palettes: Record<string, string> = {
    red: "warm vermilion",
    orange: "amber & rust",
    yellow: "sunlit ochre",
    green: "olive & sage",
    cyan: "muted teal",
    blue: "cool slate",
    magenta: "plum & violet",
    neutral: "monochrome",
  };
  return { hue, palette: palettes[hue] ?? "monochrome" };
}

const OBJECTS = [
  "ceramic vessel",
  "sculpted figurine",
  "product prototype",
  "ornamental artifact",
  "carved object",
  "decorative piece",
];
const MATERIALS = [
  "matte ceramic",
  "polished stone",
  "brushed metal",
  "carved wood",
  "glazed porcelain",
  "cast resin",
];
const SHAPES = ["rounded", "angular", "organic", "symmetrical", "asymmetric"];
const LIGHTING = ["soft studio", "diffuse daylight", "dramatic rim", "low-key window"];
const SURFACES = ["light-gray backdrop", "white cyclorama", "seamless studio backdrop"];

/** Deterministic natural-language description of the subject. */
export function visionCaption(image: UploadedImage): string {
  const hash = hashImage(image);
  const { palette } = hueBucket(image.avgColor);
  const object = OBJECTS[seedOf(hash, 0, OBJECTS.length)];
  const material = MATERIALS[seedOf(hash, 1, MATERIALS.length)];
  const shape = SHAPES[seedOf(hash, 2, SHAPES.length)];
  const lighting = LIGHTING[seedOf(hash, 3, LIGHTING.length)];
  const surface = SURFACES[seedOf(hash, 4, SURFACES.length)];
  const lit = image.brightness < 0.35 ? "dark" : image.brightness > 0.72 ? "bright" : "even";
  return `A ${shape} ${material} ${object} on a ${surface} — ${lit}, ${lighting} lighting, ${palette} palette.`;
}

/* ------------------------------------------------------------------ */
/* 5 · Prompt optimization                                             */
/* ------------------------------------------------------------------ */

/** Turn the vision caption into a provider-tuned image-to-3D prompt. */
export function optimizeImagePrompt(caption: string, provider: Text3dProviderId): string {
  return optimizePrompt(`Reference image — ${caption}`, provider);
}

/* ------------------------------------------------------------------ */
/* 6 · Provider router                                                 */
/* ------------------------------------------------------------------ */

export interface RouteInput {
  caption: string;
  preferredProvider?: string;
  preferredModel?: string;
}

/** Image-to-3D routing — reuses the STEP 06 keyword + preference router. */
export function routeImageProvider(input: RouteInput) {
  return routeProvider({
    prompt: input.caption,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });
}

/* ------------------------------------------------------------------ */
/* Task model                                                          */
/* ------------------------------------------------------------------ */

export type Image3dTaskStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface Image3dTask {
  id: string;
  provider: Text3dProviderId;
  model: string;
  imageName: string;
  imageUrl: string;
  width: number;
  height: number;
  caption: string;
  optimizedPrompt: string;
  status: Image3dTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  attempts: number;
  error?: string;
  previewUrl?: string;
  outputs?: { glb: string; fbx: string; obj: string };
}

/** Image references are unambiguous — slightly faster than text-to-3D. */
function durationFor(provider: Text3dProviderId, seedStr: string): number {
  const base = sdkProviderById(provider)?.durationMs ?? 15_000;
  const seed = (seedStr.length * 131 + base) % 4001;
  return Math.round(base * (0.62 + (seed % 5) / 10));
}

/* ------------------------------------------------------------------ */
/* 7 · Submit task                                                     */
/* ------------------------------------------------------------------ */

export interface SubmitInput {
  image: UploadedImage;
  preferredProvider?: string;
  preferredModel?: string;
  now: number;
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  task?: Image3dTask;
}

/** Upload → validate → caption → optimize → route → queued task. */
export function submitImageTask(input: SubmitInput): SubmitResult {
  const validated = validateImage(input.image);
  if (!validated.ok || !validated.clean) {
    return { ok: false, error: validated.reason };
  }
  const caption = visionCaption(validated.clean);
  const routed = routeImageProvider({
    caption,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });
  const optimized = optimizeImagePrompt(caption, routed.provider);
  return {
    ok: true,
    task: {
      id: `i3d_${hexId(5)}`,
      provider: routed.provider,
      model: routed.model,
      imageName: validated.clean.name,
      imageUrl: validated.clean.dataUrl,
      width: validated.clean.width,
      height: validated.clean.height,
      caption,
      optimizedPrompt: optimized,
      status: "queued",
      createdAt: input.now,
      durationMs: durationFor(routed.provider, caption),
      attempts: 1,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 8 · Polling / status                                                */
/* ------------------------------------------------------------------ */

/** Advance a task by elapsed wall time: queued → processing → completed. */
export function advanceImageTask(task: Image3dTask, now: number): Image3dTask {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }
  const next: Image3dTask = { ...task };
  if (next.status === "queued") {
    if (now - next.createdAt >= 500) {
      next.status = "processing";
      next.startedAt = now;
    }
    return next;
  }
  const startedAt = next.startedAt ?? next.createdAt;
  if (now - startedAt >= next.durationMs) {
    next.status = "completed";
    next.completedAt = now;
    next.previewUrl = buildPreviewUrl(next);
    next.outputs = buildImageOutputUrls(next);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 9 · 10 · 11 · Preview · Storage · Download                          */
/* ------------------------------------------------------------------ */

/** Rendered preview thumbnail in the asset bucket. */
export function buildPreviewUrl(task: Pick<Image3dTask, "id">): string {
  return `s3://atelier-assets/image3d/${task.id}/preview.png`;
}

/** Storage paths for the three export formats + preview render. */
export function buildImageOutputUrls(task: Pick<Image3dTask, "id">): {
  glb: string;
  fbx: string;
  obj: string;
} {
  return {
    glb: `s3://atelier-assets/image3d/${task.id}/model.glb`,
    fbx: `s3://atelier-assets/image3d/${task.id}/model.fbx`,
    obj: `s3://atelier-assets/image3d/${task.id}/model.obj`,
  };
}

export interface DownloadResult {
  ok: boolean;
  error?: string;
  glb?: string;
  fbx?: string;
  obj?: string;
  previewUrl?: string;
}

export function downloadImageTask(task: Image3dTask): DownloadResult {
  if (task.status !== "completed" || !task.outputs) {
    return {
      ok: false,
      error: `Task ${task.id} is ${task.status} — export not ready`,
    };
  }
  return { ok: true, ...task.outputs, previewUrl: task.previewUrl };
}

/* ------------------------------------------------------------------ */
/* 12 · Retry                                                          */
/* ------------------------------------------------------------------ */

export interface RetryResult {
  ok: boolean;
  error?: string;
  task?: Image3dTask;
}

/** Retry a failed/cancelled task: reset to queued, bump attempts, new timing. */
export function retryImageTask(task: Image3dTask, now: number): RetryResult {
  if (task.status === "completed") {
    return { ok: false, error: "Task already completed — nothing to retry" };
  }
  if (task.attempts >= 3) {
    return { ok: false, error: "Maximum retries reached (3)" };
  }
  const next: Image3dTask = {
    ...task,
    status: "queued",
    createdAt: now,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    attempts: task.attempts + 1,
    durationMs: durationFor(task.provider, task.caption),
  };
  return { ok: true, task: next };
}

/* ------------------------------------------------------------------ */
/* 13 · Webhook                                                        */
/* ------------------------------------------------------------------ */

export type Image3dWebhookEvent = "generation.completed" | "generation.failed";

/** Reconcile a task with an upstream webhook delivery. */
export function applyImage3dWebhook(
  task: Image3dTask,
  event: string,
  now: number,
): Image3dTask {
  const next: Image3dTask = { ...task };
  if (event === "generation.completed") {
    if (next.status !== "completed") {
      next.status = "completed";
      next.completedAt = now;
      next.previewUrl = buildPreviewUrl(next);
      next.outputs = buildImageOutputUrls(next);
      next.error = undefined;
    }
  } else if (event === "generation.failed") {
    next.status = "failed";
    next.completedAt = now;
    next.error = "Upstream reported a failure via webhook";
  }
  return next;
}
