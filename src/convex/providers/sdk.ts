// STEP 05 · Provider SDK — pure core.
//
// The SDK wraps every upstream in the same six-operation contract:
//   authenticate → generate → status → cancel → download → webhook
// This module is deliberately free of Convex imports: it runs in the
// backend (via src/convex/sdk.ts), in the browser (the console tab), and
// in unit tests. Credentials, job lifecycle, and webhook signatures are
// all pure functions over plain data.
//
// In production each provider would call its real REST API; here the
// adapters simulate the lifecycle with deterministic timing so the whole
// SDK can be exercised end-to-end without live keys.

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export type SdkCategory =
  | "language"
  | "vision"
  | "image"
  | "3d"
  | "video"
  | "audio"
  | "aggregator";

export type SdkCapability =
  | "text"
  | "vision"
  | "image"
  | "3d"
  | "video"
  | "audio";

export interface SdkProvider {
  id: string;
  label: string;
  category: SdkCategory;
  tagline: string;
  baseUrl: string;
  authEnv: string; // env var that supplies the credential
  keyPrefix: string; // credential format, e.g. "sk-"
  minKeyLength: number;
  models: string[];
  defaultModel: string;
  timeoutMs: number; // upstream timeout enforced by the SDK
  durationMs: number; // simulated generation time
  capability: SdkCapability;
}

export const SDK_PROVIDERS: SdkProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    category: "language",
    tagline: "GPT models for text & structured reasoning",
    baseUrl: "https://api.openai.com/v1",
    authEnv: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    minKeyLength: 20,
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    defaultModel: "gpt-4o",
    timeoutMs: 45_000,
    durationMs: 2_400,
    capability: "text",
  },
  {
    id: "anthropic",
    label: "Claude",
    category: "language",
    tagline: "Claude models from Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authEnv: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    minKeyLength: 28,
    models: ["claude-3-5-sonnet", "claude-3-5-haiku", "claude-opus-4"],
    defaultModel: "claude-3-5-sonnet",
    timeoutMs: 45_000,
    durationMs: 2_800,
    capability: "text",
  },
  {
    id: "google",
    label: "Gemini",
    category: "language",
    tagline: "Gemini multimodal models from Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authEnv: "GEMINI_API_KEY",
    keyPrefix: "AIza",
    minKeyLength: 20,
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
    timeoutMs: 60_000,
    durationMs: 2_200,
    capability: "text",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    category: "aggregator",
    tagline: "One key to hundreds of open & frontier models",
    baseUrl: "https://openrouter.ai/api/v1",
    authEnv: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    minKeyLength: 24,
    models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "meta-llama/llama-3.3-70b"],
    defaultModel: "openai/gpt-4o",
    timeoutMs: 60_000,
    durationMs: 2_600,
    capability: "text",
  },
  {
    id: "meshy",
    label: "Meshy",
    category: "3d",
    tagline: "Text & image to 3D mesh generation",
    baseUrl: "https://api.meshy.ai/v1",
    authEnv: "MESHY_API_KEY",
    keyPrefix: "msy_",
    minKeyLength: 20,
    models: ["meshy-v4", "meshy-v4-fast"],
    defaultModel: "meshy-v4",
    timeoutMs: 90_000,
    durationMs: 18_000,
    capability: "3d",
  },
  {
    id: "tripo",
    label: "Tripo",
    category: "3d",
    tagline: "Fast text & image to 3D assets",
    baseUrl: "https://api.tripo3d.ai/v2",
    authEnv: "TRIPO_API_KEY",
    keyPrefix: "tp-",
    minKeyLength: 20,
    models: ["tripo-3d-v2", "tripo-3d-v2-fast"],
    defaultModel: "tripo-3d-v2",
    timeoutMs: 90_000,
    durationMs: 15_000,
    capability: "3d",
  },
  {
    id: "hunyuan3d",
    label: "Hunyuan3D",
    category: "3d",
    tagline: "Tencent Hunyuan3D text-to-3D",
    baseUrl: "https://api.hunyuan.cloud.tencent.com",
    authEnv: "HUNYUAN3D_API_KEY",
    keyPrefix: "hy-",
    minKeyLength: 20,
    models: ["hunyuan3d-2.0", "hunyuan3d-2.0-fast"],
    defaultModel: "hunyuan3d-2.0",
    timeoutMs: 90_000,
    durationMs: 20_000,
    capability: "3d",
  },
  {
    id: "runway",
    label: "Runway",
    category: "video",
    tagline: "Gen-3 video generation",
    baseUrl: "https://api.dev.runwayml.com/v1",
    authEnv: "RUNWAY_API_KEY",
    keyPrefix: "rw-",
    minKeyLength: 20,
    models: ["gen-3-alpha", "gen-3-alpha-turbo"],
    defaultModel: "gen-3-alpha",
    timeoutMs: 120_000,
    durationMs: 42_000,
    capability: "video",
  },
  {
    id: "luma",
    label: "Luma",
    category: "video",
    tagline: "Dream Machine video from text & images",
    baseUrl: "https://api.lumalabs.ai/dream-machine/v1",
    authEnv: "LUMA_API_KEY",
    keyPrefix: "lumakey-",
    minKeyLength: 20,
    models: ["dream-machine", "ray-2"],
    defaultModel: "dream-machine",
    timeoutMs: 120_000,
    durationMs: 35_000,
    capability: "video",
  },
  {
    id: "pika",
    label: "Pika",
    category: "video",
    tagline: "Pika video generation & effects",
    baseUrl: "https://api.pika.art/v1",
    authEnv: "PIKA_API_KEY",
    keyPrefix: "pk-",
    minKeyLength: 20,
    models: ["pika-2", "pika-2-turbo"],
    defaultModel: "pika-2",
    timeoutMs: 120_000,
    durationMs: 38_000,
    capability: "video",
  },
  {
    id: "fal",
    label: "Fal",
    category: "aggregator",
    tagline: "Serverless GPU for image, video & audio models",
    baseUrl: "https://fal.run",
    authEnv: "FAL_KEY",
    keyPrefix: "fal-",
    minKeyLength: 20,
    models: ["fal-ai/flux/dev", "fal-ai/kling-video", "fal-ai/stable-diffusion-v35"],
    defaultModel: "fal-ai/flux/dev",
    timeoutMs: 120_000,
    durationMs: 12_000,
    capability: "image",
  },
  {
    id: "replicate",
    label: "Replicate",
    category: "aggregator",
    tagline: "Run any open model with one API",
    baseUrl: "https://api.replicate.com/v1",
    authEnv: "REPLICATE_API_TOKEN",
    keyPrefix: "r8_",
    minKeyLength: 20,
    models: ["black-forest-labs/flux-schnell", "stability-ai/sdxl"],
    defaultModel: "black-forest-labs/flux-schnell",
    timeoutMs: 120_000,
    durationMs: 14_000,
    capability: "image",
  },
  {
    id: "stability",
    label: "Stable Diffusion",
    category: "image",
    tagline: "Stability AI image generation",
    baseUrl: "https://api.stability.ai/v2beta",
    authEnv: "STABILITY_API_KEY",
    keyPrefix: "sk-",
    minKeyLength: 20,
    models: ["stable-diffusion-3-5", "sd3-5-large"],
    defaultModel: "stable-diffusion-3-5",
    timeoutMs: 90_000,
    durationMs: 10_000,
    capability: "image",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    category: "audio",
    tagline: "Text-to-speech & voice cloning",
    baseUrl: "https://api.elevenlabs.io/v1",
    authEnv: "ELEVENLABS_API_KEY",
    keyPrefix: "sk_",
    minKeyLength: 24,
    models: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
    defaultModel: "eleven_multilingual_v2",
    timeoutMs: 60_000,
    durationMs: 6_000,
    capability: "audio",
  },
  {
    id: "deepgram",
    label: "Deepgram",
    category: "audio",
    tagline: "Speech-to-text & transcription",
    baseUrl: "https://api.deepgram.com/v1",
    authEnv: "DEEPGRAM_API_KEY",
    keyPrefix: "dg-",
    minKeyLength: 20,
    models: ["nova-3", "whisper-large"],
    defaultModel: "nova-3",
    timeoutMs: 60_000,
    durationMs: 5_000,
    capability: "audio",
  },
];

export function sdkProviderById(id: string): SdkProvider | undefined {
  return SDK_PROVIDERS.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* Job model                                                           */
/* ------------------------------------------------------------------ */

export type SdkJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface SdkJob {
  id: string;
  provider: string;
  model: string;
  prompt: string;
  imageName?: string;
  status: SdkJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  outputText?: string;
  outputUrl?: string;
  error?: string;
  attempts: number;
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* 1 · Authenticate                                                    */
/* ------------------------------------------------------------------ */

export interface AuthenticateResult {
  ok: boolean;
  error?: string;
  provider?: SdkProvider;
}

/**
 * Validate a credential against the provider's expected format.
 * Real deployments would call the provider's /models endpoint to confirm
 * the key is live; here format + length checks stand in for that round trip.
 */
export function authenticate(
  providerId: string,
  credential: string | undefined,
): AuthenticateResult {
  const provider = sdkProviderById(providerId);
  if (!provider) {
    return { ok: false, error: `Unknown provider "${providerId}"` };
  }
  const key = (credential ?? "").trim();
  if (!key) {
    return { ok: false, error: `${provider.label} requires an API key (${provider.authEnv})` };
  }
  if (!key.startsWith(provider.keyPrefix)) {
    return {
      ok: false,
      error: `${provider.label} keys must start with "${provider.keyPrefix}"`,
    };
  }
  if (key.length < provider.minKeyLength) {
    return {
      ok: false,
      error: `${provider.label} key looks truncated — expected at least ${provider.minKeyLength} chars`,
    };
  }
  return { ok: true, provider };
}

/* ------------------------------------------------------------------ */
/* 2 · Generate                                                        */
/* ------------------------------------------------------------------ */

export interface GenerateInput {
  provider: SdkProvider;
  model: string;
  prompt: string;
  imageName?: string;
  now: number;
  credential?: string;
  validateCredential?: boolean;
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  job?: SdkJob;
}

export function generateJob(input: GenerateInput): GenerateResult {
  if (input.validateCredential !== false) {
    const auth = authenticate(input.provider.id, input.credential);
    if (!auth.ok) return { ok: false, error: auth.error };
  }
  const prompt = input.prompt.trim();
  if (!prompt) {
    return { ok: false, error: `${input.provider.label} needs a prompt to generate from` };
  }
  const model = input.model || input.provider.defaultModel;
  if (!input.provider.models.includes(model)) {
    return { ok: false, error: `${model} is not a valid ${input.provider.label} model` };
  }
  const durationMs = deterministicDuration(input.provider, prompt);
  return {
    ok: true,
    job: {
      id: `job_${hexId(5)}`,
      provider: input.provider.id,
      model,
      prompt,
      imageName: input.imageName,
      status: "queued",
      createdAt: input.now,
      durationMs,
      attempts: 1,
    },
  };
}

/** Deterministic (same provider+prompt ⇒ same timing) simulated duration. */
function deterministicDuration(provider: SdkProvider, prompt: string): number {
  const seed = (provider.durationMs + prompt.length * 97) % 2401;
  return Math.round(provider.durationMs * (0.8 + (seed % 5) / 10));
}

/* ------------------------------------------------------------------ */
/* 3 · Status                                                          */
/* ------------------------------------------------------------------ */

/**
 * Advance a job through its lifecycle based on elapsed wall time:
 *   queued → processing (after ~500ms) → completed (after durationMs).
 * Returns a NEW job object; the caller persists it.
 */
export function advanceJob(job: SdkJob, now: number): SdkJob {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return job;
  }
  const next: SdkJob = { ...job };
  if (next.status === "queued") {
    if (now - next.createdAt >= 500) {
      next.status = "processing";
      next.startedAt = now;
    }
    return next;
  }
  // processing
  const startedAt = next.startedAt ?? next.createdAt;
  const elapsed = now - startedAt;
  if (elapsed >= next.durationMs) {
    next.status = "completed";
    next.completedAt = now;
    const artifact = buildArtifact(next);
    next.outputText = artifact.text;
    next.outputUrl = artifact.url;
  }
  return next;
}

function buildArtifact(job: SdkJob): { text: string; url: string } {
  const provider = sdkProviderById(job.provider);
  const label = provider?.label ?? job.provider;
  const id = hexId(4);
  const base = `s3://atelier-assets/sdk/${job.id}`;
  switch (provider?.capability ?? "text") {
    case "image":
      return {
        text: `Image generated by ${label} · ${job.model}\n\n— asset ${id}.png · 1024×1024\n— prompt: “${job.prompt.slice(0, 120)}”\n— stored at ${base}.png`,
        url: `${base}.png`,
      };
    case "3d":
      return {
        text: `Mesh generated by ${label} · ${job.model}\n\n— asset ${id}.glb · glTF 2.0 + USDZ\n— 128k triangles · PBR materials baked\n— stored at ${base}.glb`,
        url: `${base}.glb`,
      };
    case "video":
      return {
        text: `Clip rendered by ${label} · ${job.model}\n\n— asset ${id}.mp4 · 8s · 24fps · 1080p\n— stored at ${base}.mp4`,
        url: `${base}.mp4`,
      };
    case "audio":
      return {
        text: `Audio produced by ${label} · ${job.model}\n\n— asset ${id}.mp3 · 44.1kHz stereo\n— stored at ${base}.mp3`,
        url: `${base}.mp3`,
      };
    default:
      return {
        text: `Response from ${label} · ${job.model}\n\n“${job.prompt.slice(0, 160)}”\n\nGenerated through the Atelier Provider SDK — authenticated, queued, processed, and downloaded through the six-operation contract.`,
        url: `${base}.txt`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* 4 · Cancel                                                          */
/* ------------------------------------------------------------------ */

/** Cancel a job that has not finished. Terminal jobs are unchanged. */
export function cancelJob(job: SdkJob, now: number): SdkJob {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return job;
  }
  return { ...job, status: "cancelled", completedAt: now };
}

/* ------------------------------------------------------------------ */
/* 5 · Download                                                        */
/* ------------------------------------------------------------------ */

export interface DownloadResult {
  ok: boolean;
  error?: string;
  text?: string;
  url?: string;
}

export function downloadJob(job: SdkJob): DownloadResult {
  if (job.status !== "completed") {
    return { ok: false, error: `Job ${job.id} is ${job.status} — not ready to download` };
  }
  return { ok: true, text: job.outputText, url: job.outputUrl };
}

/* ------------------------------------------------------------------ */
/* 6 · Webhook                                                         */
/* ------------------------------------------------------------------ */

export const WEBHOOK_HEADER = "x-atelier-signature";

/** Sign a webhook payload with the provider secret (HMAC-SHA256). */
export async function signWebhookPayload(
  secret: string,
  payload: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `sha256=${Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Constant-time-ish check of an incoming signature. */
export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const expected = await signWebhookPayload(secret, payload);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export type WebhookEvent = "generation.completed" | "generation.failed";

/** Reconcile a job with an upstream webhook delivery. */
export function applyWebhookEvent(job: SdkJob, event: string, now: number): SdkJob {
  const next: SdkJob = { ...job };
  if (event === "generation.completed") {
    if (next.status !== "completed") {
      next.status = "completed";
      next.completedAt = now;
      const artifact = buildArtifact(next);
      next.outputText = artifact.text;
      next.outputUrl = artifact.url;
    }
  } else if (event === "generation.failed") {
    next.status = "failed";
    next.completedAt = now;
    next.error = "Upstream reported a failure via webhook";
  }
  return next;
}
