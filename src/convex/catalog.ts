// Shared catalog for the Atelier AI Platform Gateway.
// Imported by both the Convex backend and the React frontend.
// Must stay free of server-only imports (pure constants + pure functions).
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Gateway request kinds — mirrors the AI Platform workflow pipeline    */
/* ------------------------------------------------------------------ */

export const GATEWAY_KINDS = [
  "text",
  "vision",
  "textTo3d",
  "imageTo3d",
  "textToVideo",
  "imageToVideo",
] as const;

export type GatewayKind = (typeof GATEWAY_KINDS)[number];

// Note: written explicitly — this Convex version rejects dynamically mapped unions.
export const kindValidator = v.union(
  v.literal("text"),
  v.literal("vision"),
  v.literal("textTo3d"),
  v.literal("imageTo3d"),
  v.literal("textToVideo"),
  v.literal("imageToVideo"),
);

export const REQUEST_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const statusValidator = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
);

/* ------------------------------------------------------------------ */
/* Presentation metadata                                               */
/* ------------------------------------------------------------------ */

export interface KindMeta {
  label: string;
  short: string;
  credits: number;
  needsImage: boolean;
  placeholder: string;
  example: string;
}

export const KIND_META: Record<GatewayKind, KindMeta> = {
  text: {
    label: "Text AI",
    short: "LLM",
    credits: 1,
    needsImage: false,
    placeholder: "Ask anything — summarise, draft, translate, reason…",
    example:
      "Write a short gallery placard for a quiet morning painting, in the voice of a patient curator.",
  },
  vision: {
    label: "Vision AI",
    short: "Vision",
    credits: 2,
    needsImage: true,
    placeholder: "Describe what you want analysed about the image…",
    example: "Identify the subject, palette, and lighting of this image.",
  },
  textTo3d: {
    label: "Text → 3D",
    short: "3D",
    credits: 5,
    needsImage: false,
    placeholder: "Describe an object to generate as a 3D mesh…",
    example: "A minimalist ceramic vase with a ribbed neck, 12 cm tall.",
  },
  imageTo3d: {
    label: "Image → 3D",
    short: "3D",
    credits: 6,
    needsImage: true,
    placeholder: "Optional guidance for the 3D reconstruction…",
    example: "Reconstruct this object as a watertight mesh, front view first.",
  },
  textToVideo: {
    label: "Text → Video",
    short: "Video",
    credits: 8,
    needsImage: false,
    placeholder: "Describe the scene, camera move, and duration…",
    example:
      "Slow dolly across a sunlit atelier, 8 seconds, 24fps, shallow depth of field.",
  },
  imageToVideo: {
    label: "Image → Video",
    short: "Video",
    credits: 10,
    needsImage: true,
    placeholder: "Describe the motion you want applied to the image…",
    example: "The curtains sway gently; dust drifts through the light, 5 seconds.",
  },
};

export interface ProviderGroup {
  provider: string;
  providerLabel: string;
  models: string[];
}

export const PROVIDER_MODELS: Record<GatewayKind, ProviderGroup[]> = {
  text: [
    { provider: "openai", providerLabel: "OpenAI", models: ["gpt-4o", "gpt-4o-mini"] },
    { provider: "anthropic", providerLabel: "Anthropic", models: ["claude-3-5-sonnet", "claude-3-5-haiku"] },
    { provider: "google", providerLabel: "Google", models: ["gemini-1-5-pro", "gemini-1-5-flash"] },
  ],
  vision: [
    { provider: "openai", providerLabel: "OpenAI", models: ["gpt-4o"] },
    { provider: "anthropic", providerLabel: "Anthropic", models: ["claude-3-5-sonnet"] },
    { provider: "google", providerLabel: "Google", models: ["gemini-1-5-pro"] },
  ],
  textTo3d: [
    { provider: "meshy", providerLabel: "Meshy", models: ["meshy-v4"] },
    { provider: "tripo", providerLabel: "Tripo", models: ["tripo-3d-v2"] },
  ],
  imageTo3d: [
    { provider: "meshy", providerLabel: "Meshy", models: ["meshy-v4"] },
    { provider: "tripo", providerLabel: "Tripo", models: ["tripo-3d-v2"] },
  ],
  textToVideo: [
    { provider: "runway", providerLabel: "Runway", models: ["gen-3-alpha"] },
    { provider: "kling", providerLabel: "Kling", models: ["kling-v2"] },
  ],
  imageToVideo: [
    { provider: "runway", providerLabel: "Runway", models: ["gen-3-alpha"] },
    { provider: "kling", providerLabel: "Kling", models: ["kling-v2"] },
    { provider: "luma", providerLabel: "Luma", models: ["dream-machine"] },
  ],
};

export const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDER_MODELS)
    .flat()
    .map((g) => [g.provider, g.providerLabel]),
);

export const ALL_PROVIDERS = Array.from(
  new Set(Object.values(PROVIDER_MODELS).flat().map((g) => g.provider)),
);

/* ------------------------------------------------------------------ */
/* Billing plans (shared between backend and console)                  */
/* ------------------------------------------------------------------ */

export const STARTER_CREDITS = 100;

export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: "$0",
    credits: 100,
    tagline: "For exploring the gateway",
    features: ["100 credits", "Text & Vision routes", "7-day history", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    credits: 2000,
    tagline: "For shipping products",
    features: ["2,000 credits / mo", "All 6 provider routes", "Priority queue", "Email support"],
  },
  {
    id: "scale",
    name: "Scale",
    price: "$149",
    credits: 20000,
    tagline: "For high-volume teams",
    features: ["20,000 credits / mo", "Dedicated gateway", "SLA + audit logs", "Direct line to engineers"],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export function planById(id: string) {
  return PLANS.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* Pure response simulator (used by the gateway worker action)         */
/* ------------------------------------------------------------------ */

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function simulateResponse(opts: {
  kind: GatewayKind;
  provider: string;
  model: string;
  prompt: string;
  imageName?: string;
}): { text: string; latencyMs: number } {
  const { kind, provider, model, prompt, imageName } = opts;
  const truncated = prompt.trim().length > 160 ? prompt.trim().slice(0, 160) + "…" : prompt.trim() || "—";
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;
  const seed = provider.length + model.length + prompt.length;
  const latencyMs = 1700 + ((seed * 2654435761) % 2300); // 1.7s – 4.0s
  const id = hexId(6);

  const note = `\n\n· simulated by Atelier gateway — connect a live provider key during Deployment to receive real output.`;

  switch (kind) {
    case "text":
      return {
        text: `Response from ${providerLabel} · ${model}\n\n“${truncated}”\n\nThis is a composed reply rendered by the gateway’s text route. The router matched your request to ${provider}/${model}, passed it through the queue, and returned this payload after a modelled ${latencyMs} ms round trip. Wire a real provider credential in Deployment to stream authentic completions through the same path.${note}`,
        latencyMs,
      };
    case "vision":
      return {
        text: `Vision analysis · ${providerLabel} ${model}\n\nInput frame: ${imageName ?? "uploaded image"}.\nSubject — a primary form near the optical centre, framed with generous negative space.\nPalette — warm, desaturated mid-tones consistent with a soft daylight key.\nLighting — directional, low contrast, with gentle falloff toward the edges.\nComposition — balanced thirds; the eye is led from the lower-left entry point to the focal form.\n\nConfidence 0.94 · tokens 312 · via ${provider}/${model}${note}`,
        latencyMs,
      };
    case "textTo3d":
      return {
        text: `Mesh generated · ${providerLabel} ${model}\n\nPrompt: “${truncated}”\n\n— Asset 3d_${id}.glb (glTF 2.0 + USDZ)\n— 128k triangles · quad-dominant retopology\n— PBR materials baked · 1.2 MB\n— stored at s3://atelier-assets/3d/3d_${id}.glb\n— preview rendered in ${latencyMs} ms${note}`,
        latencyMs,
      };
    case "imageTo3d":
      return {
        text: `Reconstruction complete · ${providerLabel} ${model}\n\nSource: ${imageName ?? "uploaded image"}.\n\n— Asset 3d_${id}.glb · watertight mesh\n— 96k triangles · texture projected from input\n— stored at s3://atelier-assets/3d/3d_${id}.glb\n— depth + normals resolved in ${latencyMs} ms${note}`,
        latencyMs,
      };
    case "textToVideo":
      return {
        text: `Clip rendered · ${providerLabel} ${model}\n\nPrompt: “${truncated}”\n\n— video_${id}.mp4 · 8s · 24 fps · 1080p\n— camera: dolly in, locked horizon, gentle parallax\n— stored at s3://atelier-assets/video/video_${id}.mp4\n— first pass rendered in ${latencyMs} ms${note}`,
        latencyMs,
      };
    case "imageToVideo":
      return {
        text: `Motion applied · ${providerLabel} ${model}\n\nSource: ${imageName ?? "uploaded image"}.\n\n— video_${id}.mp4 · 5s · 24 fps · 1080p\n— two keyframes interpolated with optical flow\n— stored at s3://atelier-assets/video/video_${id}.mp4\n— rendered in ${latencyMs} ms${note}`,
        latencyMs,
      };
  }
}
