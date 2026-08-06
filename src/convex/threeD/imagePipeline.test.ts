// STEP 07 · Image → 3D pipeline — unit tests.
import { describe, expect, it } from "vitest";
import {
  advanceImageTask,
  applyImage3dWebhook,
  buildImageOutputUrls,
  buildPreviewUrl,
  downloadImageTask,
  enhanceImage,
  hashImage,
  optimizeImagePrompt,
  removeBackground,
  retryImageTask,
  routeImageProvider,
  submitImageTask,
  validateImage,
  visionCaption,
  MAX_IMAGE_DATA_URL,
  type Image3dTask,
  type UploadedImage,
} from "./imagePipeline";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function image(over: Partial<UploadedImage> = {}): UploadedImage {
  return {
    name: "vase.png",
    dataUrl: PNG,
    width: 512,
    height: 640,
    avgColor: "#8a7a5c",
    brightness: 0.52,
    ...over,
  };
}

describe("1 · validateImage", () => {
  it("rejects missing uploads", () => {
    expect(validateImage(undefined).ok).toBe(false);
  });

  it("rejects non-image data URLs", () => {
    expect(validateImage(image({ dataUrl: "data:text/plain;base64,eA==" })).ok).toBe(false);
  });

  it("rejects unsupported mime types", () => {
    const gif = PNG.replace("image/png", "image/gif");
    expect(validateImage(image({ dataUrl: gif })).ok).toBe(false);
  });

  it("rejects oversized uploads", () => {
    expect(
      validateImage(image({ dataUrl: `data:image/png;base64,${"a".repeat(MAX_IMAGE_DATA_URL)}` })).ok,
    ).toBe(false);
  });

  it("rejects too-small and too-large dimensions", () => {
    expect(validateImage(image({ width: 8, height: 8 })).ok).toBe(false);
    expect(validateImage(image({ width: 5000, height: 5000 })).ok).toBe(false);
  });

  it("rejects bad stats", () => {
    expect(validateImage(image({ brightness: 1.5 })).ok).toBe(false);
    expect(validateImage(image({ avgColor: "blue" })).ok).toBe(false);
  });

  it("accepts a valid upload and normalizes it", () => {
    const res = validateImage(image({ name: "  vase.png  ", width: 512.4, height: 640.7 }));
    expect(res.ok).toBe(true);
    expect(res.clean).toMatchObject({ name: "vase.png", width: 512, height: 641 });
  });
});

describe("hashImage", () => {
  it("is deterministic per upload", () => {
    const a = image();
    expect(hashImage(a)).toBe(hashImage(a));
  });

  it("differs across uploads", () => {
    expect(hashImage(image({ name: "a.png" }))).not.toBe(hashImage(image({ name: "b.png" })));
  });
});

describe("2 · removeBackground", () => {
  it("returns a valid mask with deterministic artifact", () => {
    const res = removeBackground(image());
    expect(res.ok).toBe(true);
    expect(["alpha", "soft-edge", "chroma"]).toContain(res.maskType);
    expect(res.keptPct).toBeGreaterThanOrEqual(88);
    expect(res.keptPct).toBeLessThanOrEqual(96);
    expect(res.artifactUrl.startsWith("s3://atelier-assets/image3d/")).toBe(true);
    expect(res.artifactUrl.endsWith("-cutout.png")).toBe(true);
  });

  it("is deterministic", () => {
    const a = image();
    expect(removeBackground(a)).toEqual(removeBackground(a));
  });
});

describe("3 · enhanceImage", () => {
  it("returns bounded enhancement parameters", () => {
    const res = enhanceImage(image());
    expect(res.ok).toBe(true);
    expect(res.contrast).toBeGreaterThanOrEqual(1.04);
    expect(res.contrast).toBeLessThanOrEqual(1.16);
    expect(res.saturation).toBeGreaterThanOrEqual(1.02);
    expect(res.saturation).toBeLessThanOrEqual(1.2);
    expect(res.sharpness).toBeGreaterThanOrEqual(55);
    expect(res.sharpness).toBeLessThanOrEqual(91);
    expect(res.artifactUrl.endsWith("-enhanced.png")).toBe(true);
  });
});

describe("4 · visionCaption", () => {
  it("produces a deterministic natural-language caption", () => {
    const a = image();
    const c = visionCaption(a);
    expect(c).toBe(visionCaption(a));
    expect(c).toMatch(/A .+ on a .+ — .+ lighting, .+ palette\.$/);
  });

  it("reflects image stats (dark vs bright)", () => {
    const dark = visionCaption(image({ brightness: 0.1, avgColor: "#202020" }));
    const bright = visionCaption(image({ brightness: 0.9, avgColor: "#e8e2d2" }));
    expect(dark).toContain("dark");
    expect(bright).toContain("bright");
  });
});

describe("5 · optimizeImagePrompt", () => {
  it("keeps the caption and adds provider tuning", () => {
    const caption = visionCaption(image());
    const optimized = optimizeImagePrompt(caption, "tripo");
    // the optimizer strips trailing punctuation from the base prompt
    expect(optimized).toContain(caption.replace(/\.$/, ""));
    expect(optimized).toMatch(/watertight|printable/);
  });
});

describe("6 · routeImageProvider", () => {
  it("routes by default and honors preference", () => {
    expect(routeImageProvider({ caption: visionCaption(image()) }).provider).toBe("tripo");
    const routed = routeImageProvider({ caption: "x", preferredProvider: "meshy" });
    expect(routed.provider).toBe("meshy");
    expect(routed.model).toMatch(/^meshy/);
  });

  it("falls back for unknown providers", () => {
    const routed = routeImageProvider({ caption: "x", preferredProvider: "nope" });
    expect(["tripo", "meshy", "hunyuan3d"]).toContain(routed.provider);
  });
});

describe("7 · submitImageTask", () => {
  it("rejects invalid images", () => {
    const res = submitImageTask({ image: image({ width: 4 }), now: 1000 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("creates a queued task with caption + optimized prompt", () => {
    const res = submitImageTask({ image: image(), now: 1000 });
    expect(res.ok).toBe(true);
    const t = res.task!;
    expect(t.id.startsWith("i3d_")).toBe(true);
    expect(t.status).toBe("queued");
    expect(t.attempts).toBe(1);
    expect(t.caption.length).toBeGreaterThan(0);
    expect(t.optimizedPrompt).toContain(t.caption.replace(/\.$/, ""));
    expect(t.imageUrl).toBe(PNG);
    expect(t.durationMs).toBeGreaterThan(0);
  });
});

describe("8 · advanceImageTask", () => {
  function task(over: Partial<Image3dTask> = {}): Image3dTask {
    return {
      id: "i3d_test",
      provider: "tripo",
      model: "tripo-3d-v2",
      imageName: "vase.png",
      imageUrl: PNG,
      width: 512,
      height: 640,
      caption: "A rounded matte ceramic vessel on a light-gray backdrop.",
      optimizedPrompt: "Reference image — A rounded matte ceramic vessel.",
      status: "queued",
      createdAt: 0,
      durationMs: 5000,
      attempts: 1,
      ...over,
    };
  }

  it("moves queued → processing after 500ms", () => {
    const next = advanceImageTask(task(), 600);
    expect(next.status).toBe("processing");
    expect(next.startedAt).toBe(600);
  });

  it("moves processing → completed after durationMs with outputs", () => {
    const t = advanceImageTask(task({ status: "processing", startedAt: 100 }), 5200);
    expect(t.status).toBe("completed");
    expect(t.completedAt).toBe(5200);
    expect(t.previewUrl).toBeDefined();
    expect(t.outputs).toEqual({
      glb: "s3://atelier-assets/image3d/i3d_test/model.glb",
      fbx: "s3://atelier-assets/image3d/i3d_test/model.fbx",
      obj: "s3://atelier-assets/image3d/i3d_test/model.obj",
    });
  });

  it("is immutable once terminal", () => {
    const done = task({ status: "completed", completedAt: 1, outputs: buildImageOutputUrls({ id: "i3d_test" }) });
    expect(advanceImageTask(done, 9999)).toBe(done);
  });
});

describe("9 · preview · download", () => {
  it("builds preview and export urls", () => {
    expect(buildPreviewUrl({ id: "i3d_x" })).toContain("preview.png");
    expect(buildImageOutputUrls({ id: "i3d_x" }).fbx.endsWith(".fbx")).toBe(true);
  });

  it("gates downloads on completion", () => {
    const t: Image3dTask = {
      id: "i3d_test",
      provider: "tripo",
      model: "tripo-3d-v2",
      imageName: "vase.png",
      imageUrl: PNG,
      width: 512,
      height: 640,
      caption: "c",
      optimizedPrompt: "p",
      status: "queued",
      createdAt: 0,
      durationMs: 5000,
      attempts: 1,
    };
    expect(downloadImageTask(t).ok).toBe(false);
    // advance is single-step: queued → processing, then processing → completed
    const mid = advanceImageTask(t, 9999);
    expect(mid.status).toBe("processing");
    const done = advanceImageTask(mid, 20000);
    expect(done.status).toBe("completed");
    const dl = downloadImageTask(done);
    expect(dl.ok).toBe(true);
    expect(dl.glb).toBeDefined();
    expect(dl.previewUrl).toBeDefined();
  });
});

describe("10 · retryImageTask", () => {
  const base: Image3dTask = {
    id: "i3d_test",
    provider: "tripo",
    model: "tripo-3d-v2",
    imageName: "vase.png",
    imageUrl: PNG,
    width: 512,
    height: 640,
    caption: "c",
    optimizedPrompt: "p",
    status: "failed",
    createdAt: 0,
    durationMs: 5000,
    attempts: 1,
    error: "boom",
  };

  it("re-queues a failed task and bumps attempts", () => {
    const res = retryImageTask(base, 1000);
    expect(res.ok).toBe(true);
    expect(res.task).toMatchObject({ status: "queued", attempts: 2, createdAt: 1000 });
    expect(res.task?.error).toBeUndefined();
  });

  it("refuses completed tasks", () => {
    expect(retryImageTask({ ...base, status: "completed" }, 1000).ok).toBe(false);
  });

  it("caps at 3 attempts", () => {
    expect(retryImageTask({ ...base, attempts: 3 }, 1000).ok).toBe(false);
  });
});

describe("11 · applyImage3dWebhook", () => {
  const base: Image3dTask = {
    id: "i3d_test",
    provider: "tripo",
    model: "tripo-3d-v2",
    imageName: "vase.png",
    imageUrl: PNG,
    width: 512,
    height: 640,
    caption: "c",
    optimizedPrompt: "p",
    status: "processing",
    createdAt: 0,
    startedAt: 100,
    durationMs: 5000,
    attempts: 1,
  };

  it("reconciles completed deliveries", () => {
    const next = applyImage3dWebhook(base, "generation.completed", 2000);
    expect(next.status).toBe("completed");
    expect(next.outputs).toBeDefined();
    expect(next.previewUrl).toBeDefined();
  });

  it("reconciles failed deliveries", () => {
    const next = applyImage3dWebhook(base, "generation.failed", 2000);
    expect(next.status).toBe("failed");
    expect(next.error).toContain("webhook");
  });
});
