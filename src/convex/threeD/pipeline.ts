// STEP 06 · Text → 3D module — pure pipeline core.
//
// The full workflow, as pure functions over plain data:
//
//   receive → validate → optimize → router → submit → poll →
//   download (GLB · FBX · OBJ) → history → retry → webhook → storage
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/textTo3d.ts), in the browser (the console tab), and in
// unit tests. In production the "submit" step would call Meshy / Tripo /
// Hunyuan3D REST APIs; here the lifecycle is simulated deterministically.

import { sdkProviderById, type SdkProvider } from "../providers/sdk";

/* ------------------------------------------------------------------ */
/* Provider set (text→3D upstreams from the Provider SDK)              */
/* ------------------------------------------------------------------ */

export const TEXT3D_PROVIDER_IDS = ["meshy", "tripo", "hunyuan3d"] as const;
export type Text3dProviderId = (typeof TEXT3D_PROVIDER_IDS)[number];

export interface RoutedProvider {
  provider: Text3dProviderId;
  model: string;
  label: string;
}

/** Ordered router preference — fastest/most capable first. */
const ROUTER_ORDER: Text3dProviderId[] = ["tripo", "meshy", "hunyuan3d"];

function specOf(id: Text3dProviderId): SdkProvider {
  const s = sdkProviderById(id);
  if (!s) throw new Error(`Unknown 3D provider ${id}`);
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

export const MAX_PROMPT_LENGTH = 1_000;

export function validatePrompt(raw: string | undefined): ValidationResult {
  const prompt = (raw ?? "").trim();
  if (!prompt) return { ok: false, reason: "Prompt is empty — describe the object to generate." };
  if (prompt.length < 4) {
    return { ok: false, reason: "Prompt is too short — describe the object in more detail." };
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, reason: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters.` };
  }
  return { ok: true, clean: prompt };
}

/* ------------------------------------------------------------------ */
/* 3 · Optimize prompt                                                 */
/* ------------------------------------------------------------------ */

/** Deterministic prompt enrichment tuned per provider. */
const OPTIMIZERS: Record<Text3dProviderId, (p: string) => string> = {
  tripo: (p) =>
    `${p.trim()} — watertight, quad-dominant topology; clean base; printable and game-ready detail;`,
  meshy: (p) =>
    `${p.trim()} — PBR materials baked; 128k triangles; retopologised; realistic proportions;`,
  hunyuan3d: (p) =>
    `${p.trim()} — symmetric where natural; organic silhouette; moderate poly budget for realtime;`,
};

export function optimizePrompt(prompt: string, provider: Text3dProviderId): string {
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

/** Pick a provider + model. Keyword hints prefer a provider; otherwise round-robin by seed. */
export function routeProvider(input: RouteInput): RoutedProvider {
  const p = input.prompt.toLowerCase();

  // explicit preference wins (still validated)
  if (input.preferredProvider && TEXT3D_PROVIDER_IDS.includes(input.preferredProvider as never)) {
    const id = input.preferredProvider as Text3dProviderId;
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
  let id: Text3dProviderId = "tripo";
  if (/print|furniture|vase|architectur|product/i.test(p)) id = "tripo";
  else if (/game|character|creature|low.?poly|stylized/i.test(p)) id = "meshy";
  else if (/organic|sculptur|anatom|free.?form/i.test(p)) id = "hunyuan3d";

  const spec = specOf(id);
  return { provider: id, model: spec.defaultModel, label: spec.label };
}

/* ------------------------------------------------------------------ */
/* Task model                                                          */
/* ------------------------------------------------------------------ */

export type Text3dTaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface Text3dTask {
  id: string;
  provider: Text3dProviderId;
  model: string;
  prompt: string;
  optimizedPrompt: string;
  status: Text3dTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  attempts: number;
  error?: string;
  outputs?: { glb: string; fbx: string; obj: string };
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic simulated duration (provider base ± 20%). */
function durationFor(provider: Text3dProviderId, prompt: string): number {
  const base = specOf(provider).durationMs;
  const seed = (prompt.length * 131 + base) % 4001;
  return Math.round(base * (0.8 + (seed % 5) / 10));
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
  task?: Text3dTask;
}

/** Receive → validate → optimize → route → create the queued task. */
export function submitTask(input: SubmitInput): SubmitResult {
  const validated = validatePrompt(input.prompt);
  if (!validated.ok || !validated.clean) {
    return { ok: false, error: validated.reason };
  }
  const routed = routeProvider({
    prompt: validated.clean,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });
  const optimized = optimizePrompt(validated.clean, routed.provider);
  return {
    ok: true,
    task: {
      id: `t3d_${hexId(5)}`,
      provider: routed.provider,
      model: routed.model,
      prompt: validated.clean,
      optimizedPrompt: optimized,
      status: "queued",
      createdAt: input.now,
      durationMs: durationFor(routed.provider, validated.clean),
      attempts: 1,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 6 · Polling / status                                                */
/* ------------------------------------------------------------------ */

/** Advance a task by elapsed wall time: queued → processing → completed. */
export function advanceTask(task: Text3dTask, now: number): Text3dTask {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task;
  }
  const next: Text3dTask = { ...task };
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
    next.outputs = buildOutputUrls(next);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 7 · 8 · 9 · Download GLB / FBX / OBJ                                */
/* ------------------------------------------------------------------ */

/** Storage paths for the three export formats. */
export function buildOutputUrls(task: Pick<Text3dTask, "id">): {
  glb: string;
  fbx: string;
  obj: string;
} {
  return {
    glb: `s3://atelier-assets/3d/${task.id}.glb`,
    fbx: `s3://atelier-assets/3d/${task.id}.fbx`,
    obj: `s3://atelier-assets/3d/${task.id}.obj`,
  };
}

export interface DownloadResult {
  ok: boolean;
  error?: string;
  glb?: string;
  fbx?: string;
  obj?: string;
}

export function downloadTask(task: Text3dTask): DownloadResult {
  if (task.status !== "completed" || !task.outputs) {
    return {
      ok: false,
      error: `Task ${task.id} is ${task.status} — export not ready`,
    };
  }
  return { ok: true, ...task.outputs };
}

/* ------------------------------------------------------------------ */
/* 11 · Retry                                                          */
/* ------------------------------------------------------------------ */

export interface RetryResult {
  ok: boolean;
  error?: string;
  task?: Text3dTask;
}

/** Retry a failed/cancelled task: reset to queued, bump attempts, new timing. */
export function retryTask(task: Text3dTask, now: number): RetryResult {
  if (task.status === "completed") {
    return { ok: false, error: "Task already completed — nothing to retry" };
  }
  if (task.attempts >= 3) {
    return { ok: false, error: "Maximum retries reached (3)" };
  }
  const next: Text3dTask = {
    ...task,
    status: "queued",
    createdAt: now,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    attempts: task.attempts + 1,
    durationMs: durationFor(task.provider, task.prompt),
  };
  return { ok: true, task: next };
}

/* ------------------------------------------------------------------ */
/* 12 · Webhook                                                        */
/* ------------------------------------------------------------------ */

export type Text3dWebhookEvent = "generation.completed" | "generation.failed";

/** Reconcile a task with an upstream webhook delivery. */
export function applyText3dWebhook(task: Text3dTask, event: string, now: number): Text3dTask {
  const next: Text3dTask = { ...task };
  if (event === "generation.completed") {
    if (next.status !== "completed") {
      next.status = "completed";
      next.completedAt = now;
      next.outputs = buildOutputUrls(next);
      next.error = undefined;
    }
  } else if (event === "generation.failed") {
    next.status = "failed";
    next.completedAt = now;
    next.error = "Upstream reported a failure via webhook";
  }
  return next;
}
