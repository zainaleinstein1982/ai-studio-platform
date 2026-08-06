// Pure key generation + hashing helpers. No Convex imports — unit-testable.
// Uses Web Crypto only (node:crypto is not available in the Convex runtime).

export const KEY_PREFIX = "apk_live_";
export const SECRET_HEX_BYTES = 24; // 48 hex chars

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSecret(): string {
  return `${KEY_PREFIX}${randomHex(SECRET_HEX_BYTES)}`;
}

/** sha-256 hex digest — the full secret is never stored, only its hash. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function secretPrefix(secret: string): string {
  return `${secret.slice(0, 16)}…`;
}

/* ------------------------------------------------------------------ */
/* Webhook secrets                                                     */
/* ------------------------------------------------------------------ */

export const WEBHOOK_PREFIX = "whsec_";

export function generateWebhookSecret(): string {
  // 32 random bytes → 64 hex chars after the prefix.
  return `${WEBHOOK_PREFIX}${randomHex(32)}`;
}

export function webhookSecretPrefix(secret: string): string {
  return `${secret.slice(0, 12)}…`;
}
