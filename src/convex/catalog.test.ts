import { describe, expect, it } from "vitest";
import {
  ALL_PROVIDERS,
  GATEWAY_KINDS,
  KIND_META,
  PLANS,
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  simulateResponse,
} from "./catalog";

describe("KIND_META", () => {
  it("covers every gateway kind with positive credits", () => {
    for (const kind of GATEWAY_KINDS) {
      const meta = KIND_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.credits).toBeGreaterThan(0);
      expect(meta.example.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly the vision/image routes as needing an image", () => {
    const needsImage = GATEWAY_KINDS.filter((k) => KIND_META[k].needsImage).sort();
    expect(needsImage).toEqual(["imageTo3d", "imageToVideo", "vision"]);
  });

  it("prices routes by complexity: video > 3d > text", () => {
    expect(KIND_META.imageToVideo.credits).toBeGreaterThan(KIND_META.textToVideo.credits);
    expect(KIND_META.textToVideo.credits).toBeGreaterThan(KIND_META.textTo3d.credits);
    expect(KIND_META.textTo3d.credits).toBeGreaterThan(KIND_META.text.credits);
  });
});

describe("PROVIDER_MODELS", () => {
  it("gives every kind at least one provider with a model", () => {
    for (const kind of GATEWAY_KINDS) {
      const groups = PROVIDER_MODELS[kind];
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.providerLabel.length).toBeGreaterThan(0);
        expect(group.models.length).toBeGreaterThan(0);
        expect(PROVIDER_LABEL[group.provider]).toBe(group.providerLabel);
      }
    }
  });

  it("registers every provider in the flat label map", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(PROVIDER_LABEL[provider]).toBeTruthy();
    }
  });
});

describe("simulateResponse", () => {
  const base = {
    provider: "openai",
    model: "gpt-4o",
    prompt: "describe a quiet gallery at dawn",
  };

  it("returns a deterministic latency within the modelled range", () => {
    const a = simulateResponse({ kind: "text", ...base });
    const b = simulateResponse({ kind: "text", ...base });
    expect(a.latencyMs).toBe(b.latencyMs);
    expect(a.latencyMs).toBeGreaterThanOrEqual(1700);
    expect(a.latencyMs).toBeLessThan(4000);
  });

  it("always flags output as simulated", () => {
    for (const kind of GATEWAY_KINDS) {
      const res = simulateResponse({ kind, ...base });
      expect(res.text).toContain("simulated by Atelier");
      expect(res.text.length).toBeGreaterThan(80);
    }
  });

  it("names the provider/model in the response", () => {
    const res = simulateResponse({ kind: "text", ...base });
    expect(res.text).toContain("openai");
    expect(res.text).toContain("gpt-4o");
  });

  it("echoes the image name for vision routes", () => {
    const res = simulateResponse({ kind: "vision", ...base, imageName: "still-life.png" });
    expect(res.text).toContain("still-life.png");
  });

  it("truncates very long prompts", () => {
    const res = simulateResponse({
      kind: "text",
      ...base,
      prompt: "x".repeat(1000),
    });
    expect(res.text.length).toBeLessThan(1000);
  });
});

describe("PLANS", () => {
  it("orders plans by ascending credit allowance with unique ids", () => {
    const ids = new Set(PLANS.map((p) => p.id));
    expect(ids.size).toBe(PLANS.length);
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].credits).toBeGreaterThan(PLANS[i - 1].credits);
    }
  });

  it("keeps the starter allowance aligned with billing", () => {
    expect(PLANS[0].credits).toBe(100);
    expect(PLANS[0].price).toBe("$0");
  });
});
