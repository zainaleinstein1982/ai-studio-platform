// STEP 08 · Image → Video pipeline — unit tests.
import { describe, expect, it } from "vitest";
import {
  advanceVideoTask,
  buildImageVideoPrompt,
  downloadImageVideoTask,
  submitImageVideoTask,
  buildVideoUrls,
  type ImageVideoTask,
  type UploadedImage,
} from "./imagePipeline";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function image(over: Partial<UploadedImage> = {}): UploadedImage {
  return {
    name: "still.png",
    dataUrl: PNG,
    width: 512,
    height: 640,
    avgColor: "#8a7a5c",
    brightness: 0.52,
    ...over,
  };
}

function task(over: Partial<ImageVideoTask> = {}): ImageVideoTask {
  return {
    id: "vid_img_test",
    provider: "runway",
    model: "gen-3-alpha",
    imageName: "still.png",
    imageUrl: PNG,
    width: 512,
    height: 640,
    caption: "A rounded matte ceramic vessel on a light-gray backdrop.",
    prompt: "the curtains sway gently",
    optimizedPrompt: buildImageVideoPrompt("the curtains sway gently", "A rounded matte ceramic vessel on a light-gray backdrop."),
    status: "queued",
    createdAt: 0,
    durationMs: 12_000,
    attempts: 1,
    progress: 0,
    framesRendered: 0,
    totalFrames: 120,
    fps: 24,
    seconds: 5,
    streaming: true,
    ...over,
  };
}

describe("buildImageVideoPrompt", () => {
  it("merges motion with the subject caption", () => {
    const p = buildImageVideoPrompt("the curtains sway gently.", "A vase on a backdrop.");
    expect(p).toBe("the curtains sway gently — Subject: A vase on a backdrop.");
  });

  it("strips trailing punctuation from the motion", () => {
    const p = buildImageVideoPrompt("dust drifts!! ", "A room.");
    expect(p.startsWith("dust drifts — Subject")).toBe(true);
  });
});

describe("submitImageVideoTask", () => {
  it("rejects invalid images", () => {
    const res = submitImageVideoTask({ image: image({ width: 4 }), prompt: "sway gently", now: 1000 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("rejects empty motion prompts", () => {
    const res = submitImageVideoTask({ image: image(), prompt: "", now: 1000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("empty");
  });

  it("creates a queued task with caption + combined optimized prompt", () => {
    const res = submitImageVideoTask({ image: image(), prompt: "the curtains sway gently", now: 1000 });
    expect(res.ok).toBe(true);
    const t = res.task!;
    expect(t.id.startsWith("vid_")).toBe(true);
    expect(t.status).toBe("queued");
    expect(t.attempts).toBe(1);
    expect(t.caption.length).toBeGreaterThan(0);
    expect(t.optimizedPrompt).toContain("Subject:");
    expect(t.optimizedPrompt).toContain(t.caption.replace(/\.$/, ""));
    expect(t.totalFrames).toBe(t.seconds * t.fps);
    expect(t.streaming).toBe(true);
    expect(t.imageUrl).toBe(PNG);
  });
});

describe("advanceVideoTask (shared render lifecycle)", () => {
  it("moves queued → processing → completed with mp4 artifact", () => {
    const mid = advanceVideoTask(task(), 600);
    expect(mid.status).toBe("processing");

    const done = advanceVideoTask(task({ status: "processing", startedAt: 100 }), 20000);
    expect(done.status).toBe("completed");
    expect(done.progress).toBe(100);
    expect(done.framesRendered).toBe(done.totalFrames);
    expect(done.outputUrl).toContain("clip.mp4");
    expect(done.previewUrl).toContain("poster.jpg");
  });
});

describe("downloadImageVideoTask", () => {
  it("gates downloads on completion", () => {
    expect(downloadImageVideoTask(task()).ok).toBe(false);

    const done = downloadImageVideoTask(
      task({
        status: "completed",
        outputUrl: "s3://atelier-assets/video/vid_img_test/clip.mp4",
        previewUrl: "s3://atelier-assets/video/vid_img_test/poster.jpg",
      }),
    );
    expect(done.ok).toBe(true);
    expect(done.outputUrl).toContain(".mp4");
  });
});

describe("buildVideoUrls", () => {
  it("points into the video bucket", () => {
    const urls = buildVideoUrls({ id: "vid_x" });
    expect(urls.outputUrl.startsWith("s3://atelier-assets/video/")).toBe(true);
    expect(urls.previewUrl.endsWith("poster.jpg")).toBe(true);
  });
});
