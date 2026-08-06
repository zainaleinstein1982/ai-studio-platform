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
