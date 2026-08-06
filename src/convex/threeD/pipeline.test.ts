import { describe, expect, it } from "vitest";
import {
  TEXT3D_PROVIDER_IDS,
  validatePrompt,
  optimizePrompt,
  routeProvider,
  submitTask,
  advanceTask,
  downloadTask,
  buildOutputUrls,
  retryTask,
  applyText3dWebhook,
  MAX_PROMPT_LENGTH,
  type Text3dTask,
} from "./pipeline";

const NOW = 2_000_000;

function sampleTask(over: Partial<Text3dTask> = {}): Text3dTask {
  return {
    id: "t3d_test1",
    provider: "tripo",
    model: "tripo-3d-v2",
    prompt: "a minimalist ceramic vase",
    optimizedPrompt: optimizePrompt("a minimalist ceramic vase", "tripo"),
    status: "queued",
    createdAt: NOW,
    durationMs: 15_000,
    attempts: 1,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* 1·2 · Receive & validate                                            */
/* ------------------------------------------------------------------ */

describe("validatePrompt", () => {
  it("rejects empty, too-short, and over-long prompts", () => {
    expect(validatePrompt(undefined).ok).toBe(false);
    expect(validatePrompt("   ").ok).toBe(false);
    expect(validatePrompt("a").ok).toBe(false);
    expect(validatePrompt("x".repeat(MAX_PROMPT_LENGTH + 1)).ok).toBe(false);
  });

  it("accepts and trims a good prompt", () => {
    const res = validatePrompt("  a ceramic vase with a ribbed neck  ");
    expect(res.ok).toBe(true);
    expect(res.clean).toBe("a ceramic vase with a ribbed neck");
  });
});

/* ------------------------------------------------------------------ */
/* 3 · Optimize                                                        */
/* ------------------------------------------------------------------ */

describe("optimizePrompt", () => {
  it("is deterministic and provider-specific", () => {
    const a = optimizePrompt("a chair", "meshy");
    const b = optimizePrompt("a chair", "meshy");
    expect(a).toBe(b);
    expect(a).toContain("PBR");
    expect(optimizePrompt("a chair", "tripo")).toContain("watertight");
    expect(optimizePrompt("a chair", "hunyuan3d")).toContain("symmetric");
  });

  it("returns a longer, enriched prompt", () => {
    const out = optimizePrompt("a stool", "meshy");
    expect(out.length).toBeGreaterThan("a stool".length);
    expect(out).toContain("a stool");
  });

  it("covers every router provider", () => {
    for (const id of TEXT3D_PROVIDER_IDS) {
      const out = optimizePrompt("a lamp", id);
      expect(out.length).toBeGreaterThan(8);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4 · Provider router                                                 */
/* ------------------------------------------------------------------ */

describe("routeProvider", () => {
  it("routes keyword hints to the matching provider", () => {
    expect(routeProvider({ prompt: "a print-ready chair" }).provider).toBe("tripo");
    expect(routeProvider({ prompt: "a low-poly game character" }).provider).toBe("meshy");
    expect(routeProvider({ prompt: "an organic free-form sculpture" }).provider).toBe("hunyuan3d");
  });

  it("defaults to tripo for neutral prompts", () => {
    expect(routeProvider({ prompt: "a box" }).provider).toBe("tripo");
  });

  it("honours an explicit preferred provider and model", () => {
    const routed = routeProvider({
      prompt: "a chair",
      preferredProvider: "meshy",
      preferredModel: "meshy-v4",
    });
    expect(routed.provider).toBe("meshy");
    expect(routed.model).toBe("meshy-v4");
  });

  it("falls back to the default model for an unknown preferred model", () => {
    const routed = routeProvider({
      prompt: "a chair",
      preferredProvider: "tripo",
      preferredModel: "does-not-exist",
    });
    expect(routed.model).toBe("tripo-3d-v2");
  });

  it("ignores an unknown preferred provider", () => {
    const routed = routeProvider({ prompt: "a vase", preferredProvider: "openai" });
    expect(TEXT3D_PROVIDER_IDS).toContain(routed.provider);
  });
});

/* ------------------------------------------------------------------ */
/* 5 · Submit task                                                     */
/* ------------------------------------------------------------------ */

describe("submitTask", () => {
  it("creates a queued, optimized task", () => {
    const res = submitTask({ prompt: "a ribbed ceramic vase", now: NOW });
    expect(res.ok).toBe(true);
    expect(res.task?.status).toBe("queued");
    expect(res.task?.id).toMatch(/^t3d_/);
    expect(res.task?.attempts).toBe(1);
    expect(res.task?.optimizedPrompt).not.toBe(res.task?.prompt);
    expect(res.task?.provider).toBe("tripo");
  });

  it("routes through the preference when given", () => {
    const res = submitTask({
      prompt: "a low-poly fox",
      preferredProvider: "meshy",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.task?.provider).toBe("meshy");
  });

  it("rejects invalid prompts", () => {
    const res = submitTask({ prompt: "", now: NOW });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("empty");
  });

  it("is deterministic for identical input", () => {
    const a = submitTask({ prompt: "a lighthouse", now: NOW });
    const b = submitTask({ prompt: "a lighthouse", now: NOW });
    expect(a.task?.durationMs).toBe(b.task?.durationMs);
  });
});

/* ------------------------------------------------------------------ */
/* 6 · Polling / advance                                               */
/* ------------------------------------------------------------------ */

describe("advanceTask (polling)", () => {
  it("moves queued → processing after the drain delay", () => {
    expect(advanceTask(sampleTask(), NOW).status).toBe("queued");
    expect(advanceTask(sampleTask(), NOW + 600).status).toBe("processing");
  });

  it("moves processing → completed with export outputs", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const done = advanceTask(job, NOW + job.durationMs + 1);
    expect(done.status).toBe("completed");
    expect(done.outputs).toBeDefined();
    expect(done.completedAt).toBeDefined();
  });

  it("keeps terminal tasks immutable", () => {
    const done = sampleTask({ status: "completed", completedAt: NOW });
    expect(advanceTask(done, NOW + 99_999).status).toBe("completed");
  });
});

/* ------------------------------------------------------------------ */
/* 7 · 8 · 9 · Download formats                                        */
/* ------------------------------------------------------------------ */

describe("downloadTask (GLB · FBX · OBJ)", () => {
  it("builds all three export URLs from the task id", () => {
    const urls = buildOutputUrls({ id: "t3d_abc" });
    expect(urls.glb).toBe("s3://atelier-assets/3d/t3d_abc.glb");
    expect(urls.fbx).toContain(".fbx");
    expect(urls.obj).toContain(".obj");
  });

  it("gates downloads on completion", () => {
    const queued = downloadTask(sampleTask());
    expect(queued.ok).toBe(false);
    expect(queued.error).toContain("queued");

    const done = downloadTask(
      sampleTask({ status: "completed", outputs: buildOutputUrls({ id: "t3d_abc" }) }),
    );
    expect(done.ok).toBe(true);
    expect(done.glb).toContain(".glb");
    expect(done.fbx).toContain(".fbx");
    expect(done.obj).toContain(".obj");
  });
});

/* ------------------------------------------------------------------ */
/* 11 · Retry                                                          */
/* ------------------------------------------------------------------ */

describe("retryTask", () => {
  it("resets a failed task to queued and bumps attempts", () => {
    const failed = sampleTask({ status: "failed", error: "boom", attempts: 1 });
    const res = retryTask(failed, NOW + 10_000);
    expect(res.ok).toBe(true);
    expect(res.task?.status).toBe("queued");
    expect(res.task?.attempts).toBe(2);
    expect(res.task?.error).toBeUndefined();
    expect(res.task?.createdAt).toBe(NOW + 10_000);
  });

  it("refuses to retry completed tasks", () => {
    const done = sampleTask({ status: "completed", completedAt: NOW });
    expect(retryTask(done, NOW + 1).ok).toBe(false);
  });

  it("stops at the retry ceiling", () => {
    const exhausted = sampleTask({ status: "failed", attempts: 3 });
    expect(retryTask(exhausted, NOW).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 12 · Webhook                                                        */
/* ------------------------------------------------------------------ */

describe("applyText3dWebhook", () => {
  it("reconciles a completed event with outputs", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const done = applyText3dWebhook(job, "generation.completed", NOW + 100);
    expect(done.status).toBe("completed");
    expect(done.outputs?.glb).toBeDefined();
  });

  it("reconciles a failed event", () => {
    const job = sampleTask({ status: "processing", startedAt: NOW });
    const failed = applyText3dWebhook(job, "generation.failed", NOW + 100);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("webhook");
  });
});
