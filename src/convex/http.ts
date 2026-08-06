// HTTP surface — auth routes + the Atelier gateway reverse-proxy API.
//
//   POST /v1/:kind          Authorization: Bearer apk_live_…
//   GET  /v1/requests/:id   Authorization: Bearer apk_live_…
//   POST /v1/webhooks/:provider   X-Atelier-Signature: sha256=…
//
// The proxy validates the key (sha-256 lookup), enforces the key policy and
// circuit breaker, then enqueues the request through the same worker pipeline
// the console uses. Webhook deliveries are HMAC-verified against the
// provider's signing secret before the job is reconciled.
import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";
import { sha256Hex } from "./keygen";

const http = httpRouter();

auth.addHttpRoutes(http);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function bearerKey(ctx: ActionCtx, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key") ?? "").trim();
  if (!token) return null;
  const keyHash = await sha256Hex(token);
  const key = await ctx.runQuery(api.apiKeys.findByHash, { keyHash });
  return key; // { id } | null
}

export const v1Proxy = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  const pathname = new URL(request.url).pathname;
  const kind = pathname.replace(/^\/v1\//, "").toLowerCase();
  if (!kind) return json({ error: "Missing route kind" }, 400);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const { requestId } = await ctx.runMutation(api.gateway.sendViaKey, {
      keyId: key.id,
      kind,
      provider: typeof body.provider === "string" ? body.provider : "",
      model: typeof body.model === "string" ? body.model : "",
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      imageName: typeof body.imageName === "string" ? body.imageName : undefined,
      stream: Boolean(body.stream),
      simulateFailure: Boolean(body.simulateFailure),
    });
    return json(
      { id: requestId, status: "queued", statusUrl: `/v1/requests/${requestId}` },
      202,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Gateway error";
    const lower = msg.toLowerCase();
    const status = lower.includes("rate limit")
      ? 429
      : lower.includes("circuit") || lower.includes("unavailable")
        ? 503
        : lower.includes("key")
          ? 401
          : 400;
    return json({ error: msg }, status);
  }
});

export const v1Get = httpAction(async (ctx, request) => {
  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  const pathname = new URL(request.url).pathname;
  const requestId = pathname.replace(/^\/v1\/requests\//, "");
  if (!requestId) return json({ error: "Missing request id" }, 400);

  const req = await ctx.runQuery(api.gateway.getRequestForKey, {
    keyId: key.id,
    requestId: requestId as never,
  });
  if (!req) return json({ error: "Request not found" }, 404);

  return json({
    id: req._id,
    status: req.status,
    kind: req.kind,
    provider: req.provider,
    model: req.model,
    streamed: Boolean(req.stream),
    attempts: req.attempts ?? 0,
    latencyMs: req.latencyMs ?? null,
    credits: req.credits,
    responseText: req.responseText ?? null,
    error: req.error ?? null,
    createdAt: req.createdAt,
    completedAt: req.completedAt ?? null,
  });
});

/** Inbound provider webhook — POST /v1/webhooks/:provider */
export const webhookReceiver = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const pathname = new URL(request.url).pathname;
  const provider = pathname.replace(/^\/v1\/webhooks\//, "").toLowerCase();
  if (!provider) return json({ error: "Missing provider" }, 400);

  const signature = request.headers.get("x-atelier-signature") ?? "";
  if (!signature) return json({ error: "Missing X-Atelier-Signature header" }, 401);

  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const event = typeof body.event === "string" ? body.event : "";
  if (!jobId || !event) {
    return json({ error: "Body must include jobId and event" }, 400);
  }

  try {
    const result = await ctx.runMutation(api.sdk.verifyAndApplyWebhook, {
      jobId: jobId as never,
      event,
      payload,
      signature,
    });
    return json({ ok: true, jobId, status: result.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Webhook failed";
    return json({ error: msg }, msg.toLowerCase().includes("signature") ? 401 : 400);
  }
});

// This router only supports exact paths and path prefixes (no :params).
http.route({ pathPrefix: "/v1/requests/", method: "GET", handler: v1Get });
http.route({ pathPrefix: "/v1/webhooks/", method: "POST", handler: webhookReceiver });
http.route({ pathPrefix: "/v1/webhooks/", method: "OPTIONS", handler: webhookReceiver });
http.route({ pathPrefix: "/v1/", method: "POST", handler: v1Proxy });
http.route({ pathPrefix: "/v1/", method: "OPTIONS", handler: v1Proxy });

export default http;
