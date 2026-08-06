import { describe, expect, it } from "vitest";
import {
  SDK_PROVIDERS,
  sdkProviderById,
  authenticate,
  generateJob,
  advanceJob,
  cancelJob,
  downloadJob,
  signWebhookPayload,
  verifyWebhookSignature,
  applyWebhookEvent,
  type SdkJob,
} from "./sdk";

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe("SDK registry", () => {
  it("registers all 15 requested providers", () => {
    const ids = SDK_PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        "anthropic",
        "deepgram",
        "elevenlabs",
        "fal",
        "google",
        "hunyuan3d",
        "luma",
        "meshy",
        "openai",
        "openrouter",
        "pika",
        "replicate",
        "runway",
        "stability",
        "tripo",
      ].sort(),
    );
  });

  it("gives every provider the fields the six operations need", () => {
    for (const p of SDK_PROVIDERS) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.models).toContain(p.defaultModel);
      expect(p.keyPrefix.length).toBeGreaterThan(0);
      expect(p.timeoutMs).toBeGreaterThan(0);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(sdkProviderById(p.id)?.label).toBe(p.label);
    }
  });

  it("covers every capability category at least once", () => {
    const caps = new Set(SDK_PROVIDERS.map((p) => p.capability));
    for (const c of ["text", "image", "3d", "video", "audio"]) {
      expect(caps.has(c as never)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 1 · Authenticate                                                    */
/* ------------------------------------------------------------------ */

describe("authenticate", () => {
  it("rejects unknown providers", () => {
    const res = authenticate("not-a-provider", "sk-anything");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unknown provider");
  });

  it("rejects missing credentials", () => {
    const res = authenticate("openai", undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("OPENAI_API_KEY");
  });

  it("rejects keys with the wrong prefix", () => {
    const res = authenticate("anthropic", "sk-wrongprefix-1234567890");
    expect(res.ok).toBe(false);
    expect(res.error).toContain('start with "sk-ant-"');
  });

  it("rejects truncated keys", () => {
    const res = authenticate("openai", "sk-short");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("truncated");
  });

  it("accepts a well-formed key for each provider", () => {
    const samples: Record<string, string> = {
      openai: "sk-" + "a".repeat(30),
      anthropic: "sk-ant-" + "a".repeat(30),
      google: "AIza" + "a".repeat(20),
      openrouter: "sk-or-" + "a".repeat(25),
      meshy: "msy_" + "a".repeat(20),
      tripo: "tp-" + "a".repeat(20),
      hunyuan3d: "hy-" + "a".repeat(20),
      runway: "rw-" + "a".repeat(20),
      luma: "lumakey-" + "a".repeat(20),
      pika: "pk-" + "a".repeat(20),
      fal: "fal-" + "a".repeat(20),
      replicate: "r8_" + "a".repeat(20),
      stability: "sk-" + "a".repeat(30),
      elevenlabs: "sk_" + "a".repeat(25),
      deepgram: "dg-" + "a".repeat(20),
    };
    for (const [id, key] of Object.entries(samples)) {
      const res = authenticate(id, key);
      expect(res.ok, `${id}: ${res.error}`).toBe(true);
      expect(res.provider?.id).toBe(id);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2 · Generate                                                        */
/* ------------------------------------------------------------------ */

const NOW = 1_000_000;

function sampleJob(over: Partial<SdkJob> = {}): SdkJob {
  return {
    id: "job_test1",
    provider: "openai",
    model: "gpt-4o",
    prompt: "describe a quiet gallery",
    status: "queued",
    createdAt: NOW,
    durationMs: 2_400,
    attempts: 1,
    ...over,
  };
}

describe("generateJob", () => {
  it("creates a queued job with an id", () => {
    const res = generateJob({
      provider: sdkProviderById("openai")!,
      model: "gpt-4o",
      prompt: "hello",
      now: NOW,
      validateCredential: false,
    });
    expect(res.ok).toBe(true);
    expect(res.job?.status).toBe("queued");
    expect(res.job?.id).toMatch(/^job_/);
    expect(res.job?.attempts).toBe(1);
  });

  it("rejects empty prompts", () => {
    const res = generateJob({
      provider: sdkProviderById("openai")!,
      model: "gpt-4o",
      prompt: "   ",
      now: NOW,
      validateCredential: false,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("prompt");
  });

  it("rejects unknown models", () => {
    const res = generateJob({
      provider: sdkProviderById("openai")!,
      model: "gpt-nope",
      prompt: "hello",
      now: NOW,
      validateCredential: false,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not a valid OpenAI model");
  });

  it("validates credentials when asked", () => {
    const res = generateJob({
      provider: sdkProviderById("openai")!,
      model: "gpt-4o",
      prompt: "hello",
      now: NOW,
      credential: "bad",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('start with "sk-"');
  });

  it("is deterministic for identical input", () => {
    const a = generateJob({
      provider: sdkProviderById("meshy")!,
      model: "meshy-v4",
      prompt: "a ceramic vase",
      now: NOW,
      validateCredential: false,
    });
    const b = generateJob({
      provider: sdkProviderById("meshy")!,
      model: "meshy-v4",
      prompt: "a ceramic vase",
      now: NOW,
      validateCredential: false,
    });
    expect(a.job?.durationMs).toBe(b.job?.durationMs);
    expect(a.job?.durationMs).toBeGreaterThanOrEqual(0.8 * 18_000);
  });
});

/* ------------------------------------------------------------------ */
/* 3 · Status                                                          */
/* ------------------------------------------------------------------ */

describe("advanceJob (status)", () => {
  it("moves queued → processing after the drain delay", () => {
    const queued = advanceJob(sampleJob(), NOW);
    expect(queued.status).toBe("queued");
    const processing = advanceJob(sampleJob(), NOW + 600);
    expect(processing.status).toBe("processing");
    expect(processing.startedAt).toBe(NOW + 600);
  });

  it("moves processing → completed after durationMs", () => {
    const job = sampleJob({ status: "processing", startedAt: NOW });
    const done = advanceJob(job, NOW + job.durationMs + 1);
    expect(done.status).toBe("completed");
    expect(done.outputText).toBeTruthy();
    expect(done.outputUrl).toContain("atelier-assets");
    expect(done.completedAt).toBeDefined();
  });

  it("keeps completed jobs terminal", () => {
    const done = sampleJob({ status: "completed", completedAt: NOW, outputText: "x" });
    const again = advanceJob(done, NOW + 99_999);
    expect(again.status).toBe("completed");
  });

  it("builds category-appropriate artifacts", () => {
    const cases: [string, string][] = [
      ["meshy", "glb"],
      ["runway", "mp4"],
      ["elevenlabs", "mp3"],
      ["stability", "png"],
      ["openai", "txt"],
    ];
    for (const [provider, ext] of cases) {
      const job = sampleJob({
        provider,
        model: sdkProviderById(provider)!.defaultModel,
        status: "processing",
        startedAt: NOW,
        durationMs: 100,
      });
      const done = advanceJob(job, NOW + 200);
      expect(done.status).toBe("completed");
      expect(done.outputUrl).toContain(ext);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4 · Cancel                                                          */
/* ------------------------------------------------------------------ */

describe("cancelJob", () => {
  it("cancels a queued or processing job", () => {
    for (const status of ["queued", "processing"] as const) {
      const cancelled = cancelJob(sampleJob({ status }), NOW);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.completedAt).toBe(NOW);
    }
  });

  it("does not cancel terminal jobs", () => {
    const done = sampleJob({ status: "completed", completedAt: NOW });
    expect(cancelJob(done, NOW + 10).status).toBe("completed");
    const failed = sampleJob({ status: "failed", completedAt: NOW });
    expect(cancelJob(failed, NOW + 10).status).toBe("failed");
  });
});

/* ------------------------------------------------------------------ */
/* 5 · Download                                                        */
/* ------------------------------------------------------------------ */

describe("downloadJob", () => {
  it("returns the artifact only when completed", () => {
    const queued = downloadJob(sampleJob());
    expect(queued.ok).toBe(false);
    expect(queued.error).toContain("queued");

    const done = downloadJob(
      sampleJob({ status: "completed", outputText: "hello", outputUrl: "s3://x" }),
    );
    expect(done.ok).toBe(true);
    expect(done.text).toBe("hello");
    expect(done.url).toBe("s3://x");
  });
});

/* ------------------------------------------------------------------ */
/* 6 · Webhook                                                         */
/* ------------------------------------------------------------------ */

describe("webhook", () => {
  it("signs and verifies a payload with the right secret", async () => {
    const payload = JSON.stringify({ id: "job_1", event: "generation.completed" });
    const sig = await signWebhookPayload("whsec_demo", payload);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature("whsec_demo", payload, sig)).toBe(true);
  });

  it("rejects a wrong secret or tampered payload", async () => {
    const payload = JSON.stringify({ id: "job_1" });
    const sig = await signWebhookPayload("whsec_demo", payload);
    expect(await verifyWebhookSignature("whsec_other", payload, sig)).toBe(false);
    expect(await verifyWebhookSignature("whsec_demo", payload + " ", sig)).toBe(false);
    expect(await verifyWebhookSignature("whsec_demo", payload, "sha256=0000")).toBe(false);
  });

  it("reconciles a completed event onto a processing job", () => {
    const job = sampleJob({ status: "processing", startedAt: NOW });
    const reconciled = applyWebhookEvent(job, "generation.completed", NOW + 100);
    expect(reconciled.status).toBe("completed");
    expect(reconciled.outputText).toBeTruthy();
  });

  it("reconciles a failed event", () => {
    const job = sampleJob({ status: "processing", startedAt: NOW });
    const reconciled = applyWebhookEvent(job, "generation.failed", NOW + 100);
    expect(reconciled.status).toBe("failed");
    expect(reconciled.error).toContain("webhook");
  });
});
