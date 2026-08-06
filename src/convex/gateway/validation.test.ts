import { describe, expect, it } from "vitest";
import { MAX_PROMPT_LENGTH, validateRequest } from "./validation";

const base = { provider: "openai", model: "gpt-4o", prompt: "hello", hasImage: false };

describe("validateRequest", () => {
  it("accepts a valid text request", () => {
    expect(validateRequest({ kind: "text", ...base }).ok).toBe(true);
  });

  it("rejects unknown kinds", () => {
    const res = validateRequest({ kind: "hologram", ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Unknown request kind");
  });

  it("rejects unknown providers and models", () => {
    const badProvider = validateRequest({ kind: "text", ...base, provider: "nope" });
    expect(badProvider.ok).toBe(false);
    const badModel = validateRequest({ kind: "text", ...base, model: "gpt-99" });
    expect(badModel.ok).toBe(false);
  });

  it("rejects an empty or whitespace prompt", () => {
    expect(validateRequest({ kind: "text", ...base, prompt: "   " }).ok).toBe(false);
    expect(validateRequest({ kind: "text", ...base, prompt: "" }).ok).toBe(false);
  });

  it("rejects overlong prompts", () => {
    expect(
      validateRequest({ kind: "text", ...base, prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) }).ok,
    ).toBe(false);
    expect(
      validateRequest({ kind: "text", ...base, prompt: "x".repeat(MAX_PROMPT_LENGTH) }).ok,
    ).toBe(true);
  });

  it("requires an image for vision routes", () => {
    expect(validateRequest({ kind: "vision", ...base, hasImage: false }).ok).toBe(false);
    expect(validateRequest({ kind: "vision", ...base, hasImage: true }).ok).toBe(true);
  });

  it("rejects image-only-validated kinds without an image", () => {
    for (const kind of ["imageTo3d", "imageToVideo"] as const) {
      expect(validateRequest({ kind, ...base, hasImage: false }).ok).toBe(false);
    }
  });
});
