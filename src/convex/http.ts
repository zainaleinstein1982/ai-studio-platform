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

/** Text→3D — POST /v1/text3d/tasks (Bearer key) */
export const t3dSubmit = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json({ error: "Missing prompt" }, 400);

  try {
    const { taskId, status } = await ctx.runMutation(api.textTo3d.createViaKey, {
      keyId: key.id,
      prompt,
      preferredProvider:
        typeof body.preferredProvider === "string" ? body.preferredProvider : undefined,
      preferredModel: typeof body.preferredModel === "string" ? body.preferredModel : undefined,
    });
    return json(
      { id: taskId, status, statusUrl: `/v1/text3d/tasks/${taskId}` },
      202,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Text→3D submission failed";
    return json({ error: msg }, msg.toLowerCase().includes("key") ? 401 : 400);
  }
});

/** Text→3D — GET /v1/text3d/tasks/:id · GET /v1/text3d/tasks/:id/download */
export const t3dPoll = httpAction(async (ctx, request) => {
  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  const pathname = new URL(request.url).pathname;
  const rest = pathname.replace(/^\/v1\/text3d\/tasks\//, "");
  const download = rest.endsWith("/download");
  const id = download ? rest.replace(/\/download$/, "") : rest;
  if (!id) return json({ error: "Missing task id" }, 400);

  const task = await ctx.runQuery(api.textTo3d.getPublic, { taskId: id as never });
  if (!task) return json({ error: "Task not found" }, 404);

  if (download) {
    if (task.status !== "completed" || !task.outputs) {
      return json({ error: `Task is ${task.status} — export not ready` }, 409);
    }
    const format = new URL(request.url).searchParams.get("format") ?? "glb";
    const url = task.outputs[format as "glb" | "fbx" | "obj"];
    if (!url) return json({ error: `Unknown format "${format}"` }, 400);
    return json({ taskId: id, format, url, expiresIn: "30d" });
  }

  return json(task);
});

/** Text→3D webhook — POST /v1/webhooks/text3d/:taskId */
export const t3dWebhook = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const pathname = new URL(request.url).pathname;
  const taskId = pathname.replace(/^\/v1\/webhooks\/text3d\//, "");
  if (!taskId) return json({ error: "Missing task id" }, 400);

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
  const event = typeof body.event === "string" ? body.event : "";
  if (!event) return json({ error: "Body must include event" }, 400);

  try {
    const result = await ctx.runMutation(api.textTo3d.verifyAndApplyWebhook, {
      taskId: taskId as never,
      event,
      payload,
      signature,
    });
    return json({ ok: true, taskId, status: result.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Webhook failed";
    return json({ error: msg }, msg.toLowerCase().includes("signature") ? 401 : 400);
  }
});

/** Image→3D — POST /v1/image3d/tasks (Bearer key, base64 image in JSON) */
export const i3dSubmit = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  const imageName = typeof body.imageName === "string" ? body.imageName : "image.png";
  if (!imageUrl.startsWith("data:image/")) {
    return json({ error: "Missing image — send a base64 data URL in imageUrl" }, 400);
  }
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const str = (n: unknown) => (typeof n === "string" ? n : undefined);

  try {
    const { taskId, status } = await ctx.runMutation(api.imageTo3d.createViaKey, {
      keyId: key.id,
      imageName,
      imageUrl,
      width: num(body.width),
      height: num(body.height),
      avgColor: str(body.avgColor) ?? "#808080",
      brightness: num(body.brightness) || 0.5,
      preferredProvider: str(body.preferredProvider),
      preferredModel: str(body.preferredModel),
    });
    return json({ id: taskId, status, statusUrl: `/v1/image3d/tasks/${taskId}` }, 202);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Image→3D submission failed";
    return json({ error: msg }, msg.toLowerCase().includes("key") ? 401 : 400);
  }
});

/** Image→3D — GET /v1/image3d/tasks/:id · GET /v1/image3d/tasks/:id/download */
export const i3dPoll = httpAction(async (ctx, request) => {
  const key = await bearerKey(ctx, request);
  if (!key) return json({ error: "Invalid or missing API key" }, 401);

  const pathname = new URL(request.url).pathname;
  const rest = pathname.replace(/^\/v1\/image3d\/tasks\//, "");
  const download = rest.endsWith("/download");
  const id = download ? rest.replace(/\/download$/, "") : rest;
  if (!id) return json({ error: "Missing task id" }, 400);

  const task = await ctx.runQuery(api.imageTo3d.getPublic, { taskId: id as never });
  if (!task) return json({ error: "Task not found" }, 404);

  if (download) {
    if (task.status !== "completed" || !task.outputs) {
      return json({ error: `Task is ${task.status} — export not ready` }, 409);
    }
    const format = new URL(request.url).searchParams.get("format") ?? "glb";
    if (format === "preview") {
      return json({ taskId: id, format, url: task.previewUrl, expiresIn: "30d" });
    }
    const url = task.outputs[format as "glb" | "fbx" | "obj"];
    if (!url) return json({ error: `Unknown format "${format}"` }, 400);
    return json({ taskId: id, format, url, expiresIn: "30d" });
  }

  return json(task);
});

/** Image→3D webhook — POST /v1/webhooks/image3d/:taskId */
export const i3dWebhook = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const pathname = new URL(request.url).pathname;
  const taskId = pathname.replace(/^\/v1\/webhooks\/image3d\//, "");
  if (!taskId) return json({ error: "Missing task id" }, 400);

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
  const event = typeof body.event === "string" ? body.event : "";
  if (!event) return json({ error: "Body must include event" }, 400);

  try {
    const result = await ctx.runMutation(api.imageTo3d.verifyAndApplyWebhook, {
      taskId: taskId as never,
      event,
      payload,
      signature,
    });
    return json({ ok: true, taskId, status: result.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Webhook failed";
    return json({ error: msg }, msg.toLowerCase().includes("signature") ? 401 : 400);
  }
});

// This router only supports exact paths and path prefixes (no :params).
http.route({ pathPrefix: "/v1/requests/", method: "GET", handler: v1Get });
http.route({ pathPrefix: "/v1/webhooks/image3d/", method: "POST", handler: i3dWebhook });
http.route({ pathPrefix: "/v1/webhooks/image3d/", method: "OPTIONS", handler: i3dWebhook });
http.route({ pathPrefix: "/v1/webhooks/text3d/", method: "POST", handler: t3dWebhook });
http.route({ pathPrefix: "/v1/webhooks/text3d/", method: "OPTIONS", handler: t3dWebhook });
http.route({ pathPrefix: "/v1/webhooks/", method: "POST", handler: webhookReceiver });
http.route({ pathPrefix: "/v1/webhooks/", method: "OPTIONS", handler: webhookReceiver });
http.route({ pathPrefix: "/v1/text3d/tasks/", method: "GET", handler: t3dPoll });
http.route({ path: "/v1/text3d/tasks", method: "POST", handler: t3dSubmit });
http.route({ path: "/v1/text3d/tasks", method: "OPTIONS", handler: t3dSubmit });
http.route({ pathPrefix: "/v1/image3d/tasks/", method: "GET", handler: i3dPoll });
http.route({ path: "/v1/image3d/tasks", method: "POST", handler: i3dSubmit });
http.route({ path: "/v1/image3d/tasks", method: "OPTIONS", handler: i3dSubmit });
http.route({ pathPrefix: "/v1/", method: "POST", handler: v1Proxy });
http.route({ pathPrefix: "/v1/", method: "OPTIONS", handler: v1Proxy });

export default http;
