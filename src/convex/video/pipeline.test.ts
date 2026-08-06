// STEP 08 · Text → Video pipeline — unit tests.
import { describe, expect, it } from "vitest";
import {
  VIDEO_PROVIDER_IDS,
  validateMotionPrompt,
  optimizeMotionPrompt,
  routeVideoProvider,
  submitVideoTask,
  advanceVideoTask,
  downloadVideoTask,
  buildVideoUrls,
  retryVideoTask,
  applyVideoWebhook,
  renderProfile,
  MAX_MOTION_PROMPT_LENGTH,
  type VideoTask,
} from "./pipeline";

const NOW = 2_000_000;

function sampleTask(over: Partial<VideoTask> = {}): VideoTask {
  return {
    id: "vid_test1",
    provider: "runway",
    model: "gen-3-alpha",
    prompt: "slow dolly across a sunlit atelier",
    optimizedPrompt: optimizeMotionPrompt("slow dolly across a sunlit atelier", "runway"),
    status: "queued",
    createdAt: NOW,
    durationMs: 18_000,
    attempts: 1,
    progress: 0,
    framesRendered: 0,
    totalFrames: 192,
    fps: 24,
    seconds: 8,
    streaming: true,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* 1·2 · Receive & validate                                            */
/* ------------------------------------------------------------------ */

describe("validateMotionPrompt", () => {
  it("rejects empty, too-short, and over-long prompts", () => {
    expect(validateMotionPrompt(undefined).ok).toBe(false);
    expect(validateMotionPrompt("   ").ok).toBe(false);
    expect(validateMotionPrompt("wave").ok).toBe(false);
    expect(validateMotionPrompt("x".repeat(MAX_MOTION_PROMPT_LENGTH + 1)).ok).toBe(false);
  });

  it("accepts and trims a good motion prompt", () => {
    const res = validateMotionPrompt("  a slow pan across the room  ");
    expect(res.ok).toBe(true);
    expect(res.clean).toBe("a slow pan across the room");
  });
});

/* ------------------------------------------------------------------ */
/* 3 · Optimize                                                        */
/* ------------------------------------------------------------------ */

describe("optimizeMotionPrompt", () => {
  it("is deterministic and provider-specific", () => {
    const a = optimizeMotionPrompt("a slow dolly", "runway");
    const b = optimizeMotionPrompt("a slow dolly", "runway");
    expect(a).toBe(b);
    expect(a).toContain("cinematic");
    expect(optimizeMotionPrompt("a slow dolly", "luma")).toContain("dreamlike");
    expect(optimizeMotionPrompt("a slow dolly", "pika")).toContain("bold");
  });

  it("returns a longer, enriched prompt", () => {
    const out = optimizeMotionPrompt("a slow dolly", "runway");
    expect(out.length).toBeGreaterThan("a slow dolly".length);
    expect(out).toContain("a slow dolly");
  });

  it("covers every router provider", () => {
    for (const id of VIDEO_PROVIDER_IDS) {
      const out = optimizeMotionPrompt("a slow pan", id);
      expect(out.length).toBeGreaterThan(8);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4 · Provider router                                                 */
/* ------------------------------------------------------------------ */

describe("routeVideoProvider", () => {
  it("routes keyword hints to the matching provider", () => {
    expect(routeVideoProvider({ prompt: "a cinematic dolly shot" }).provider).toBe("runway");
    expect(routeVideoProvider({ prompt: "a dreamlike morphing flow" }).provider).toBe("luma");
    expect(routeVideoProvider({ prompt: "a playful looping sticker effect" }).provider).toBe("pika");
  });

  it("defaults to runway for neutral prompts", () => {
    expect(routeVideoProvider({ prompt: "something moves slowly" }).provider).toBe("runway");
  });

  it("honours an explicit preferred provider and model", () => {
    const routed = routeVideoProvider({
      prompt: "a slow pan",
      preferredProvider: "luma",
      preferredModel: "dream-machine",
    });
    expect(routed.provider).toBe("luma");
    expect(routed.model).toBe("dream-machine");
  });

  it("falls back to the default model for an unknown preferred model", () => {
    const routed = routeVideoProvider({
      prompt: "a slow pan",
      preferredProvider: "runway",
      preferredModel: "does-not-exist",
    });
    expect(routed.model).toBe("gen-3-alpha");
  });

  it("ignores an unknown preferred provider", () => {
    const routed = routeVideoProvider({ prompt: "a slow pan", preferredProvider: "openai" });
    expect(VIDEO_PROVIDER_IDS).toContain(routed.provider);
  });
});

/* ------------------------------------------------------------------ */
/* Render profile                                                      */
/* ------------------------------------------------------------------ */

describe("renderProfile", () => {
  it("produces a 24 fps clip of 4–10 seconds", () => {
    for (const seed of ["a", "b", "slow dolly", "dreamlike morph", "sticker loop"]) {
      const p = renderProfile(seed);
      expect(p.fps).toBe(24);
      expect(p.seconds).toBeGreaterThanOrEqual(4);
      expect(p.seconds).toBeLessThanOrEqual(10);
      expect(p.totalFrames).toBe(p.fps * p.seconds);
    }
  });

  it("is deterministic", () => {
    expect(renderProfile("slow dolly")).toEqual(renderProfile("slow dolly"));
  });
});

/* ------------------------------------------------------------------ */
/* 5 · Submit task                                                     */
/* ------------------------------------------------------------------ */

describe("submitVideoTask", () => {
  it("creates a queued, optimized render task", () => {
    const res = submitVideoTask({ prompt: "slow dolly across a sunlit atelier", now: NOW });
    expect(res.ok).toBe(true);
    expect(res.task?.status).toBe("queued");
    expect(res.task?.id).toMatch(/^vid_/);
    expect(res.task?.attempts).toBe(1);
    expect(res.task?.streaming).toBe(true);
    expect(res.task?.totalFrames).toBe(res.task!.seconds * res.task!.fps);
    expect(res.task?.optimizedPrompt).not.toBe(res.task?.prompt);
    expect(res.task?.provider).toBe("runway");
  });

  it("routes through the preference when given", () => {
    const res = submitVideoTask({
      prompt: "a dreamlike morph",
      preferredProvider: "luma",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.task?.provider).toBe("luma");
  });

  it("rejects invalid prompts", () => {
    const res = submitVideoTask({ prompt: "", now: NOW });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("empty");
  });

  it("is deterministic for identical input", () => {
    const a = submitVideoTask({ prompt: "a slow pan", now: NOW });
    const b = submitVideoTask({ prompt: "a slow pan", now: NOW });
    expect(a.task?.durationMs).toBe(b.task?.durationMs);
    expect(a.task?.totalFrames).toBe(b.task?.totalFrames);
  });
});

/* ------------------------------------------------------------------ */
/* 6 · 7 · Progress & streaming (advance)                               */
/* ------------------------------------------------------------------ */

describe("advanceVideoTask (progress · streaming)", () => {
  it("moves queued → processing after the drain delay", () => {
    expect(advanceVideoTask(sampleTask(), NOW).status).toBe("queued");
    expect(advanceVideoTask(sampleTask(), NOW + 600).status).toBe("processing");
  });

  it("reports streaming progress as rendered frames", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const mid = advanceVideoTask(job, NOW + 9000); // halfway through 18s
    expect(mid.status).toBe("processing");
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(100);
    expect(mid.framesRendered).toBe(Math.floor((mid.progress / 100) * mid.totalFrames));
  });

  it("moves processing → completed with poster + mp4", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const done = advanceVideoTask(job, NOW + job.durationMs + 1);
    expect(done.status).toBe("completed");
    expect(done.progress).toBe(100);
    expect(done.framesRendered).toBe(done.totalFrames);
    expect(done.previewUrl).toContain("poster.jpg");
    expect(done.outputUrl).toContain("clip.mp4");
    expect(done.completedAt).toBeDefined();
  });

  it("keeps terminal tasks immutable", () => {
    const done = sampleTask({ status: "completed", completedAt: NOW });
    expect(advanceVideoTask(done, NOW + 99_999).status).toBe("completed");
  });
});

/* ------------------------------------------------------------------ */
/* 8 · 10 · Preview · Download                                          */
/* ------------------------------------------------------------------ */

describe("downloadVideoTask (MP4 · poster)", () => {
  it("builds the video urls from the task id", () => {
    const urls = buildVideoUrls({ id: "vid_abc" });
    expect(urls.outputUrl).toBe("s3://atelier-assets/video/vid_abc/clip.mp4");
    expect(urls.previewUrl).toBe("s3://atelier-assets/video/vid_abc/poster.jpg");
  });

  it("gates downloads on completion", () => {
    expect(downloadVideoTask(sampleTask()).ok).toBe(false);

    const done = downloadVideoTask(
      sampleTask({
        status: "completed",
        outputUrl: "s3://atelier-assets/video/vid_test1/clip.mp4",
        previewUrl: "s3://atelier-assets/video/vid_test1/poster.jpg",
      }),
    );
    expect(done.ok).toBe(true);
    expect(done.outputUrl).toContain(".mp4");
    expect(done.previewUrl).toContain("poster.jpg");
  });
});

/* ------------------------------------------------------------------ */
/* Retry                                                               */
/* ------------------------------------------------------------------ */

describe("retryVideoTask", () => {
  it("resets a failed task to queued and bumps attempts", () => {
    const failed = sampleTask({ status: "failed", error: "boom", attempts: 1 });
    const res = retryVideoTask(failed, NOW + 10_000);
    expect(res.ok).toBe(true);
    expect(res.task?.status).toBe("queued");
    expect(res.task?.attempts).toBe(2);
    expect(res.task?.error).toBeUndefined();
    expect(res.task?.progress).toBe(0);
    expect(res.task?.createdAt).toBe(NOW + 10_000);
  });

  it("refuses to retry completed tasks", () => {
    const done = sampleTask({ status: "completed", completedAt: NOW });
    expect(retryVideoTask(done, NOW + 1).ok).toBe(false);
  });

  it("stops at the retry ceiling", () => {
    const exhausted = sampleTask({ status: "failed", attempts: 3 });
    expect(retryVideoTask(exhausted, NOW).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

describe("applyVideoWebhook", () => {
  it("reconciles a completed event with poster + mp4", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const done = applyVideoWebhook(job, "generation.completed", NOW + 100);
    expect(done.status).toBe("completed");
    expect(done.progress).toBe(100);
    expect(done.outputUrl).toContain(".mp4");
    expect(done.previewUrl).toContain("poster.jpg");
  });

  it("reconciles a failed event", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const failed = applyVideoWebhook(job, "generation.failed", NOW + 100);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("webhook");
  });
});
