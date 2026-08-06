import { describe, expect, it } from "vitest";
import {
  KEY_PREFIX,
  WEBHOOK_PREFIX,
  generateSecret,
  generateWebhookSecret,
  secretPrefix,
  sha256Hex,
  webhookSecretPrefix,
} from "./keygen";

describe("keygen", () => {
  it("generates secrets with the live prefix and correct length", () => {
    const secret = generateSecret();
    expect(secret.startsWith(KEY_PREFIX)).toBe(true);
    // "apk_live_" (9) + 24 bytes of hex (48)
    expect(secret.length).toBe(9 + 48);
  });

  it("never generates the same secret twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(seen.size).toBe(50);
  });

  it("produces a 64-char sha-256 hex digest", async () => {
    const hash = await sha256Hex("apk_live_abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes deterministically", async () => {
    expect(await sha256Hex("same-input")).toBe(await sha256Hex("same-input"));
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });

  it("reveals only a short prefix", () => {
    const secret = generateSecret();
    const prefix = secretPrefix(secret);
    expect(prefix.endsWith("…")).toBe(true);
    expect(prefix.length).toBe(17);
    // the prefix must not leak the tail of the secret
    expect(prefix).not.toContain(secret.slice(17));
  });
});

describe("webhook secrets", () => {
  it("generates whsec_ secrets of the expected length", () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith(WEBHOOK_PREFIX)).toBe(true);
    // "whsec_" (6) + 32 bytes of hex (64)
    expect(secret.length).toBe(6 + 64);
  });

  it("never repeats and never equals an API key secret", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()));
    expect(seen.size).toBe(50);
    expect(generateWebhookSecret().startsWith(KEY_PREFIX)).toBe(false);
  });

  it("exposes only a short prefix", () => {
    const secret = generateWebhookSecret();
    expect(webhookSecretPrefix(secret).endsWith("…")).toBe(true);
    expect(webhookSecretPrefix(secret)).not.toContain(secret.slice(12));
  });
});
