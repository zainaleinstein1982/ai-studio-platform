// STEP 04 · Request validation — pure, unit-tested.
import {
  GATEWAY_KINDS,
  KIND_META,
  PROVIDER_MODELS,
  type GatewayKind,
} from "../catalog";

export const MAX_PROMPT_LENGTH = 4000;

export interface ValidationInput {
  kind: string;
  provider: string;
  model: string;
  prompt: string;
  hasImage: boolean;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateRequest(input: ValidationInput): ValidationResult {
  if (!GATEWAY_KINDS.includes(input.kind as GatewayKind)) {
    return { ok: false, reason: `Unknown request kind "${input.kind}"` };
  }
  const kind = input.kind as GatewayKind;

  const group = PROVIDER_MODELS[kind].find((g) => g.provider === input.provider);
  if (!group) {
    return { ok: false, reason: `Provider "${input.provider}" does not serve ${KIND_META[kind].label}` };
  }
  if (!group.models.includes(input.model)) {
    return {
      ok: false,
      reason: `Model "${input.model}" is not offered by ${group.providerLabel} for ${KIND_META[kind].label}`,
    };
  }

  const prompt = input.prompt?.trim() ?? "";
  if (!prompt) return { ok: false, reason: "Prompt cannot be empty" };
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, reason: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters` };
  }

  if (KIND_META[kind].needsImage && !input.hasImage) {
    return { ok: false, reason: `${KIND_META[kind].label} requires an image input` };
  }

  return { ok: true };
}
