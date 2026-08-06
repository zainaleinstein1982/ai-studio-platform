import { api } from "@/convex/_generated/api";
import { KIND_META, PLANS, PROVIDER_MODELS, type GatewayKind } from "@/convex/catalog";
import { useQuery } from "convex/react";
import { SectionTitle } from "./bits";

const KINDS = Object.keys(KIND_META) as GatewayKind[];

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="scrollbar-thin overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-[11.5px] leading-6 text-foreground/85">
      {children}
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-[11px] text-chart-1">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-2 text-[13px] leading-6 text-muted-foreground [&_pre]:mt-3">
          {children}
        </div>
      </div>
    </div>
  );
}

export function DocsTab() {
  const keys = useQuery(api.apiKeys.list);
  const keyPrefix = (keys ?? []).find((k) => !k.revokedAt)?.prefix ?? "apk_live_…";

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <SectionTitle kicker="Documentation" title="Getting started" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Atelier exposes a single gateway in front of every AI provider. This guide takes
          you from zero to your first routed call.
        </p>
      </div>

      <div className="space-y-8">
      {/* authentication reference (STEP 02) */}
      <div>
        <SectionTitle kicker="STEP 02 · Authentication" title="Sign-in methods" />
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Password",
              "Register / login with email + password. Passwords are hashed with scrypt; sessions are JWT with automatic refresh.",
            ],
            [
              "Magic link",
              "Six-digit code emailed to the address — no password needed. Codes expire after 15 minutes.",
            ],
            [
              "Forgot password",
              "Request a reset code, then set a new password. Reset codes are single-use and expire in 15 minutes.",
            ],
            [
              "Google · GitHub",
              "OAuth sign-in. Add AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and AUTH_GITHUB_ID / AUTH_GITHUB_SECRET to your project keys, then the buttons activate automatically.",
            ],
            [
              "Email verification",
              "Verify from the Account tab — sets the verified badge used by admin and org tooling.",
            ],
            [
              "RBAC · Organizations",
              "Roles member < user < admin gate mutations via the permission middleware. Organizations add owner / admin / member team roles.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="text-[13px] font-medium text-foreground">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* gateway architecture reference (STEP 04) */}
      <div>
        <SectionTitle kicker="STEP 04 · Gateway" title="Architecture" />
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Ingress & validation",
              "Requests are validated (kind, provider, model, prompt, image requirement) before any routing. The HTTP proxy accepts Bearer or X-API-Key auth.",
            ],
            [
              "Key policy",
              "Before enqueueing, the gateway checks scopes, daily / monthly / quota limits, expiry, and revocation — a rejected key never reaches a provider.",
            ],
            [
              "Circuit breaker",
              "Per-provider breakers trip after 3 consecutive failures and open for 30s. While open, calls fail fast with 503 instead of hammering the upstream.",
            ],
            [
              "Retry · timeout",
              "Failed attempts retry once with ~1.2s backoff. Every provider call is bounded by its adapter timeout (45–120s) — a timeout counts as a failure.",
            ],
            [
              "Task queue",
              "Queued requests are picked up by a scheduled worker: queued → processing → completed | failed. Events are appended to each request as it moves.",
            ],
            [
              "Streaming",
              "Enable stream: true and the response is delivered as partial chunks with a live cursor, then finalized. Chunks are visible in the ledger.",
            ],
            [
              "Provider abstraction",
              "Every upstream (OpenAI, Anthropic, Google, Meshy, Tripo, Runway, Kling, Luma) implements one ProviderAdapter — supports, timeout, call. Swapping a simulated adapter for a real HTTP call is a single file change.",
            ],
            [
              "Storage · billing",
              "Inputs and outputs persist to object storage; credits are charged only when a request completes. Failures never hit the balance.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="text-[13px] font-medium text-foreground">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

        <Step n={1} title="Create an API key">
          <p>
            Open <span className="font-mono text-[12px] text-foreground">API Keys</span>,
            create a key, and copy the secret the one time it is shown. Keys authenticate
            every call and appear in the ledger so you can trace usage.
          </p>
        </Step>

        <Step n={2} title="Install the SDK">
          <Code>
            <span className="text-muted-foreground"># any environment</span>{"\n"}
            <span className="text-chart-3">$</span> npm i @atelier/ai-platform{"\n\n"}
            <span className="text-chart-2">import</span> {"{ Atelier }"} <span className="text-chart-2">from</span>{" "}
            <span className="text-chart-5">"@atelier/ai-platform"</span>
            {"\n\n"}
            <span className="text-chart-2">const</span> atelier = <span className="text-chart-2">new</span> Atelier({"{"}
            {"\n  "}apiKey: <span className="text-chart-5">"{keyPrefix}"</span>
            {"\n}"})
          </Code>
        </Step>

        <Step n={3} title="Send your first request">
          <Code>
            <span className="text-chart-2">const</span> res = <span className="text-chart-2">await</span> atelier.text.create({"{"}
            {"\n  "}model: <span className="text-chart-5">"openai/gpt-4o"</span>,{"\n  "}prompt:{" "}
            <span className="text-chart-5">"a quiet gallery at dawn"</span>
            {"\n}"})
            {"\n\n"}
            <span className="text-muted-foreground">// → 200 OK · 1.9s · 1 credit · req_8f3a21</span>
          </Code>
          <p className="mt-3">
            Every call flows through the same path: router → queue → provider → storage →
            ledger. You can watch it live in the Gateway tab.
          </p>
        </Step>

        <Step n={4} title="Or call the HTTP API directly">
          <Code>
            <span className="text-muted-foreground"># curl — any language</span>{"\n"}
            <span className="text-chart-3">$</span> curl https://api.atelier.dev/v1/text {"\\"}
            {"\n  "}  -H <span className="text-chart-5">"Authorization: Bearer {keyPrefix}…"</span> {"\\"}
            {"\n  "}  -d <span className="text-chart-5">'{"{"}"prompt":"describe a still life"{"}"}'</span>
            {"\n\n"}
            <span className="text-muted-foreground"># → 202 {"{"}"id":"req_8f3a21","status":"queued"{"}"} — poll it:</span>
            {"\n"}
            <span className="text-chart-3">$</span> curl https://api.atelier.dev/v1/requests/req_8f3a21 {"\\"}
            {"\n  "}  -H <span className="text-chart-5">"Authorization: Bearer {keyPrefix}…"</span>
            {"\n\n"}
            <span className="text-muted-foreground"># stream: true delivers the body in chunks before completing</span>
          </Code>
        </Step>
      </div>

      {/* provider SDK reference (STEP 05) */}
      <div>
        <SectionTitle kicker="STEP 05 · Provider SDK" title="Six operations, fifteen providers" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Every upstream implements the same contract: <span className="font-mono text-[12px] text-foreground">authenticate</span>,{" "}
          <span className="font-mono text-[12px] text-foreground">generate</span>,{" "}
          <span className="font-mono text-[12px] text-foreground">status</span>,{" "}
          <span className="font-mono text-[12px] text-foreground">cancel</span>,{" "}
          <span className="font-mono text-[12px] text-foreground">download</span>,{" "}
          <span className="font-mono text-[12px] text-foreground">webhook</span>. The SDK tab drives a live job through all six.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Authenticate",
              "Credentials are validated against the provider's key format (prefix + length) before any request leaves the platform. In production this calls the provider's auth endpoint.",
            ],
            [
              "Generate",
              "Creates a job: model + prompt (+ optional image). Each provider carries its own models, timeout (45–120s), and simulated duration — video and 3D take the longest.",
            ],
            [
              "Status",
              "Jobs move queued → processing → completed | failed. The scheduler advances them on a fixed cadence; the console shows a live progress bar.",
            ],
            [
              "Cancel",
              "Queued and processing jobs can be cancelled; terminal jobs are immutable. Cancelled jobs never produce a downloadable artifact.",
            ],
            [
              "Download",
              "Completed jobs expose their artifact (text, PNG, GLB, MP4, MP3) as text + an asset URL. Downloading a non-completed job returns an error.",
            ],
            [
              "Webhook",
              "Each provider has a per-account signing secret (whsec_…). Payloads are HMAC-SHA256 signed; inbound deliveries hit POST /v1/webhooks/:provider with an X-Atelier-Signature header and are verified before the job is reconciled.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* text→3d module reference (STEP 06) */}
      <div>
        <SectionTitle kicker="STEP 06 · Text → 3D" title="The thirteen-stage workflow" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Prompts become watertight meshes through a single pipeline: receive → validate →
          optimize → router → submit → poll → download (GLB · FBX · OBJ) → history → retry →
          webhook → storage. The Text → 3D tab walks you through every stage live.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Validate",
              "Prompts are checked for length and content before anything is submitted. Errors are surfaced inline in the composer.",
            ],
            [
              "Optimize",
              "Each provider gets a tuned rewrite: Tripo favours watertight printable geometry, Meshy PBR game-ready detail, Hunyuan3D organic realtime silhouettes.",
            ],
            [
              "Provider router",
              "Keyword hints (print / game / organic) plus an optional explicit preference pick the upstream and default model. The choice is previewed live as you type.",
            ],
            [
              "Submit · Poll",
              "Tasks are queued, then a scheduled worker advances them queued → processing → completed with deterministic provider timing.",
            ],
            [
              "Download",
              "Completed tasks expose three exports — GLB (glTF 2.0), FBX, and OBJ — from the asset bucket. The HTTP API serves GET /v1/text3d/tasks/:id/download?format=glb|fbx|obj.",
            ],
            [
              "History · Retry",
              "Every submission lands in the ledger. Failed tasks can be retried up to 3 times, each attempt re-queued with fresh timing.",
            ],
            [
              "Webhook · Storage",
              "Signed HMAC-SHA256 deliveries reconcile tasks via POST /v1/webhooks/text3d/:taskId. Final artifacts persist to the 3D asset bucket for 30 days.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* image→3d module reference (STEP 07) */}
      <div>
        <SectionTitle kicker="STEP 07 · Image → 3D" title="The ten-stage workflow" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          A reference photo becomes a watertight mesh: upload → background removal →
          enhancement → vision caption → prompt optimization → generate 3D → preview →
          storage → download → webhook. The Image → 3D tab walks every stage live, with
          the CV stages simulated deterministically.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Upload image",
              "Images are downscaled to ≤ 512px in the browser and analysed (dimensions, mean colour, luminance) before upload — no large payloads ever reach the backend.",
            ],
            [
              "Background removal · Enhancement",
              "A deterministic cutout pass (alpha / soft-edge / chroma) and a contrast–saturation–sharpness pass prepare a clean subject. In production these call a CV model like rembg or SAM.",
            ],
            [
              "Vision caption",
              "The subject is described in natural language — shape, material, lighting, palette — seeded deterministically from the image's fingerprint and stats. Production would call a vision LLM.",
            ],
            [
              "Prompt optimization · Router",
              "The caption is rewritten per provider (Tripo printable, Meshy game-ready, Hunyuan3D organic) and routed by keywords or an explicit preference.",
            ],
            [
              "Generate 3D · Poll",
              "Tasks queue, then a scheduled worker advances them queued → processing → completed with deterministic provider timing.",
            ],
            [
              "Preview · Storage",
              "A preview thumbnail render plus the three exports land in the image3D asset bucket for 30 days.",
            ],
            [
              "Download · Webhook",
              "GLB / FBX / OBJ (+ preview) are served via GET /v1/image3d/tasks/:id/download?format=…. Signed deliveries reconcile tasks through POST /v1/webhooks/image3d/:taskId.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* video module reference (STEP 08) */}
      <div>
        <SectionTitle kicker="STEP 08 · Video" title="The eleven-stage render workflow" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Text and stills become 24 fps clips through one render pipeline: receive →
          validate → optimize motion → router → queue → progress → streaming → preview →
          history → download → webhook. The Video tab walks both Text→Video and
          Image→Video through every stage live, with render progress reported as
          streamed frames.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Queue",
              "Tasks are accepted into the render queue and drained by a scheduled worker: queued → processing → completed | failed with deterministic provider timing.",
            ],
            [
              "Progress",
              "Render progress is reported as a frame counter — every task knows its clip profile (24 fps, 4–10 s) and streams frames as they are encoded.",
            ],
            [
              "Streaming",
              "Chunks are delivered live while the clip renders; the console shows the frame cursor advancing in real time. In production this maps to chunked HTTP responses.",
            ],
            [
              "Preview · Download",
              "A poster frame (poster.jpg) and the final clip (clip.mp4, H.264) land in the video asset bucket. The HTTP API serves GET /v1/textVideo/tasks/:id/download?format=mp4|poster (and /v1/imageVideo/…).",
            ],
            [
              "History · Retry",
              "Every submission lands in the ledger. Failed renders can be retried up to 3 times, each attempt re-queued with fresh timing.",
            ],
            [
              "Webhook · Storage",
              "Signed HMAC-SHA256 deliveries reconcile tasks via POST /v1/webhooks/textVideo/:taskId (or /v1/webhooks/imageVideo/:taskId). Final artifacts persist to the video bucket for 30 days.",
            ],
            [
              "Providers",
              "Runway for cinematic camera work, Luma for dream-like fluid motion, Pika for playful loops and effects — each routed by keywords or an explicit preference.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* storage service reference (STEP 09) */}
      <div>
        <SectionTitle kicker="STEP 09 · Storage" title="MinIO-style object storage" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Every artifact — meshes, clips, posters, previews, uploads — lives in an
          S3-compatible bucket behind <span className="font-mono text-[12px] text-foreground">s3://atelier-assets/…</span> paths.
          The Storage service registers those objects, serves them from the CDN edge
          with per-tier cache headers, and issues HMAC-signed URLs. The Storage tab
          indexes the artifacts produced by every module (SDK, Text→3D, Image→3D,
          Text→Video, Image→Video) and lets you drive the caches live.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "MinIO · S3 compatible",
              "Six buckets: 3d, image3d, video, images, sdk, requests. Each object is registered with bucket, key, cache tier, and a deterministic size — the same contract a MinIO or S3 gateway exposes.",
            ],
            [
              "Signed URLs",
              "GET /v1/storage/signed?key=s3://…&expires=3600 returns a presigned CDN URL — HMAC-SHA256 over the object key + expiry, verified on delivery. Expiry is clamped to 1 minute – 24 hours.",
            ],
            [
              "Image cache · Preview cache",
              "Uploads, cutouts, enhanced stills, posters, and render previews are cached for 7 days with public, immutable Cache-Control — safe for long-lived edge caching.",
            ],
            [
              "Video cache · GLB cache",
              "MP4 clips and GLB/FBX/OBJ meshes are cached for 30 days. Clips stream with Accept-Ranges support; meshes ship as immutable blobs with strong ETags.",
            ],
            [
              "Eviction",
              "The sweep drops expired entries and tombstones; over-capacity tiers evict least-recently-used first. Warm · Evict controls on the Storage tab drive the lifecycle.",
            ],
            [
              "CDN ready",
              "Every bucket maps to https://cdn.atelier.dev/<bucket>/<key> with Cache-Control, CDN-Cache-Control, and ETag headers — wire a real edge (CloudFront / Fastly) by pointing its origin at the storage gateway.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* queue system reference (STEP 10) */}
      <div>
        <SectionTitle kicker="STEP 10 · Queue" title="Redis / Celery-style task queue" />
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Every pipeline runs on the same task queue: enqueue (priority + delay) →
          scheduler tick → worker claim → retry with exponential backoff → completed
          or the dead letter queue. The Queue tab drives the whole lifecycle live,
          including a force-failure switch that deliberately exercises the DLQ.
        </p>
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {[
            [
              "Redis · priority",
              "Jobs land in the queue with strict priority (high → normal → low) and FIFO order within a priority. Delayed jobs stay invisible until their due time passes — the Redis zset equivalent.",
            ],
            [
              "Celery · workers",
              "A shared worker pool of 4 slots claims due jobs up to the free capacity. The Queue tab shows each worker slot (idle / processing) as jobs stream through.",
            ],
            [
              "Scheduler",
              "A scheduled tick keeps itself alive while work remains: it claims due jobs, schedules their simulated processing, and wakes again when the next delayed job becomes due.",
            ],
            [
              "Retry · backoff",
              "Failed jobs are requeued with exponential backoff (1.2s → 2.4s → 4.8s, capped at 60s) and reclaimed once the backoff passes. Every retry is visible in the job ledger.",
            ],
            [
              "Dead letter queue",
              "Jobs that exhaust maxAttempts (3) move to the dead letter queue. Requeue resets attempts and sends them back through the pipeline; purge deletes them.",
            ],
            [
              "Concurrency",
              "The pool never exceeds 4 in-flight jobs — claimNext subtracts in-flight work from the free slots, so bursts backpressure instead of overwhelming the workers.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="grid gap-1.5 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6">
              <p className="font-mono text-[12px] font-medium text-chart-1">{title}</p>
              <p className="text-[12.5px] leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* provider reference */}
      <div>
        <SectionTitle kicker="Reference" title="Provider routes" />
        <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {KINDS.map((k) => {
            const meta = KIND_META[k];
            return (
              <div key={k} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
                <div>
                  <p className="text-[13px] font-medium text-foreground">{meta.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {meta.needsImage ? "requires an image input" : "text prompt only"}
                  </p>
                </div>
                <p className="font-mono text-[11.5px] text-muted-foreground">
                  {PROVIDER_MODELS[k].map((g) => g.provider).join(" · ")}
                </p>
                <span className="w-20 text-right font-mono text-[11.5px] text-chart-1">
                  {meta.credits} cr
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* status + limits */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Gateway status
          </p>
          <dl className="mt-3 space-y-2 font-mono text-[11.5px]">
            {[
              ["200", "completed · response stored"],
              ["202", "queued · worker draining"],
              ["402", "insufficient credits"],
              ["429", "rate limited · retry after backoff"],
              ["401", "invalid or revoked key"],
            ].map(([code, note]) => (
              <div key={code} className="flex justify-between gap-4">
                <dt className="text-chart-1">{code}</dt>
                <dd className="text-right text-muted-foreground">{note}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Limits
          </p>
          <dl className="mt-3 space-y-2 font-mono text-[11.5px] text-muted-foreground">
            {[
              ["Queue depth", "unlimited — backpressure"],
              ["Max prompt", "4,096 tokens"],
              ["Max image", "10 MB · png / jpeg / webp"],
              ["History", `${PLANS[0].features[2]} on Starter`],
              ["Retention", "indefinite on Pro & Scale"],
              ["Key scopes", "per-route grants"],
              ["Key limits", "daily / monthly / credit quota"],
              ["Key expiry", "optional, per key"],
              ["Webhook secret", "per key · regenerable"],
              ["Audit log", "key & role events"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt>{k}</dt>
                <dd className="text-right text-foreground/80">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
