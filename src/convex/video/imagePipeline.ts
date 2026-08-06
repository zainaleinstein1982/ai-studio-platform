// STEP 08 · Video module — pure pipeline core (image → video).
//
// The full workflow, as pure functions over plain data:
//
//   upload → validate → vision caption → combine motion → optimize →
//   route → queue → progress → streaming → preview → download → webhook
//
// This module deliberately has no Convex imports: it runs in the backend
// (via src/convex/imageToVideo.ts), in the browser (the console tab), and in
// unit tests. Image validation + captioning are reused from the STEP 07
// image→3D pipeline; the render lifecycle is shared with the STEP 08
// text→video pipeline.

import { validateImage, visionCaption, type UploadedImage } from "../threeD/imagePipeline";
import {
  VIDEO_PROVIDER_IDS,
  type VideoProviderId,
  validateMotionPrompt,
  optimizeMotionPrompt,
  routeVideoProvider,
  advanceVideoTask,
  buildVideoPreviewUrl,
  buildVideoOutputUrl,
  retryVideoTask,
  applyVideoWebhook,
  renderProfile,
  simulatedDuration,
  type VideoTask,
} from "./pipeline";

export {
  VIDEO_PROVIDER_IDS,
  type VideoProviderId,
  type UploadedImage,
  validateMotionPrompt,
  advanceVideoTask,
  buildVideoPreviewUrl,
  buildVideoOutputUrl,
  retryVideoTask,
  applyVideoWebhook,
};

/* ------------------------------------------------------------------ */
/* Task model                                                          */
/* ------------------------------------------------------------------ */

export type ImageVideoTaskStatus = VideoTask["status"];

export interface ImageVideoTask {
  id: string;
  provider: VideoProviderId;
  model: string;
  imageName: string;
  imageUrl: string;
  width: number;
  height: number;
  caption: string; // vision caption describing the still
  prompt: string; // user's motion prompt
  optimizedPrompt: string; // motion + subject, provider-tuned
  status: ImageVideoTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  attempts: number;
  error?: string;
  // video specifics
  progress: number;
  framesRendered: number;
  totalFrames: number;
  fps: number;
  seconds: number;
  streaming: boolean;
  previewUrl?: string;
  outputUrl?: string;
}

/* ------------------------------------------------------------------ */
/* Motion + subject composition                                        */
/* ------------------------------------------------------------------ */

/** Merge the user's motion prompt with the vision caption of the still. */
export function buildImageVideoPrompt(motion: string, caption: string): string {
  const clean = motion.trim().replace(/[.!?\s]+$/, "");
  return `${clean} — Subject: ${caption}`;
}

/* ------------------------------------------------------------------ */
/* Submit task                                                         */
/* ------------------------------------------------------------------ */

export interface SubmitInput {
  image: UploadedImage;
  prompt: string; // motion prompt
  preferredProvider?: string;
  preferredModel?: string;
  now: number;
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  task?: ImageVideoTask;
}

/** Upload → validate → caption → combine motion → optimize → route → queued task. */
export function submitImageVideoTask(input: SubmitInput): SubmitResult {
  const validatedImage = validateImage(input.image);
  if (!validatedImage.ok || !validatedImage.clean) {
    return { ok: false, error: validatedImage.reason };
  }
  const validatedMotion = validateMotionPrompt(input.prompt);
  if (!validatedMotion.ok || !validatedMotion.clean) {
    return { ok: false, error: validatedMotion.reason };
  }
  const caption = visionCaption(validatedImage.clean);
  const combined = buildImageVideoPrompt(validatedMotion.clean, caption);
  const routed = routeVideoProvider({
    prompt: combined,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });
  const optimized = optimizeMotionPrompt(combined, routed.provider);
  const profile = renderProfile(combined);
  return {
    ok: true,
    task: {
      id: `vid_${Math.random().toString(16).slice(2, 8)}`,
      provider: routed.provider,
      model: routed.model,
      imageName: validatedImage.clean.name,
      imageUrl: validatedImage.clean.dataUrl,
      width: validatedImage.clean.width,
      height: validatedImage.clean.height,
      caption,
      prompt: validatedMotion.clean,
      optimizedPrompt: optimized,
      status: "queued",
      createdAt: input.now,
      durationMs: simulatedDuration(routed.provider, combined),
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
/* Download                                                            */
/* ------------------------------------------------------------------ */

export interface DownloadResult {
  ok: boolean;
  error?: string;
  previewUrl?: string;
  outputUrl?: string;
}

export function downloadImageVideoTask(task: ImageVideoTask): DownloadResult {
  if (task.status !== "completed" || !task.outputUrl) {
    return {
      ok: false,
      error: `Task ${task.id} is ${task.status} — clip not ready`,
    };
  }
  return { ok: true, previewUrl: task.previewUrl, outputUrl: task.outputUrl };
}

/** Re-export the text→video url builders for the image variant. */
export { buildVideoUrls } from "./pipeline";
