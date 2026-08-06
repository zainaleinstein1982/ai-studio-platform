import { api } from "@/convex/_generated/api";
import {
  SDK_PROVIDERS,
  sdkProviderById,
  signWebhookPayload,
  type SdkCategory,
  type SdkProvider,
} from "@/convex/providers/sdk";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Check,
  CloudDownload,
  Loader2,
  Play,
  ShieldCheck,
  Webhook as WebhookIcon,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle } from "./bits";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

const CATEGORY_META: Record<SdkCategory, { label: string; note: string }> = {
  language: { label: "Language", note: "LLM text & reasoning" },
  vision: { label: "Vision", note: "Multimodal understanding" },
  image: { label: "Image", note: "Generation & editing" },
  "3d": { label: "3D", note: "Meshes & scenes" },
  video: { label: "Video", note: "Generation & effects" },
  audio: { label: "Audio", note: "Speech in & out" },
  aggregator: { label: "Aggregator", note: "Many models, one key" },
};

const CATEGORY_ORDER: SdkCategory[] = [
  "language",
  "vision",
  "image",
  "3d",
  "video",
  "audio",
  "aggregator",
];

const OPERATIONS = [
  { id: "authenticate", label: "Authenticate", icon: ShieldCheck },
  { id: "generate", label: "Generate", icon: Play },
  { id: "status", label: "Status", icon: Loader2 },
  { id: "cancel", label: "Cancel", icon: X },
  { id: "download", label: "Download", icon: CloudDownload },
  { id: "webhook", label: "Webhook", icon: WebhookIcon },
];

const SAMPLE_CREDENTIALS: Record<string, string> = {
  openai: "sk-" + "a".repeat(32),
  anthropic: "sk-ant-" + "a".repeat(30),
  google: "AIza" + "a".repeat(24),
  openrouter: "sk-or-" + "a".repeat(26),
  meshy: "msy_" + "a".repeat(22),
  tripo: "tp-" + "a".repeat(22),
  hunyuan3d: "hy-" + "a".repeat(22),
  runway: "rw-" + "a".repeat(22),
  luma: "lumakey-" + "a".repeat(22),
  pika: "pk-" + "a".repeat(22),
  fal: "fal-" + "a".repeat(22),
  replicate: "r8_" + "a".repeat(22),
  stability: "sk-" + "a".repeat(32),
  elevenlabs: "sk_" + "a".repeat(28),
  deepgram: "dg-" + "a".repeat(22),
};

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  queued: { label: "Queued", cls: "border-chart-5/50 bg-chart-5/10 text-chart-5", dot: "bg-chart-5" },
  processing: { label: "Processing", cls: "border-chart-4/50 bg-chart-4/10 text-chart-4", dot: "bg-chart-4" },
  completed: { label: "Completed", cls: "border-chart-2/50 bg-chart-2/10 text-chart-2", dot: "bg-chart-2" },
  failed: { label: "Failed", cls: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function JobBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLE[status] ?? STATUS_STYLE.queued;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        cfg.cls,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          cfg.dot,
          status === "processing" || status === "queued" ? "animate-pulse" : "",
        )}
      />
      {cfg.label}
    </span>
  );
}

export function ProvidersTab() {
  const jobs = useQuery(api.sdk.list, { limit: 12 });
  const authenticateCredential = useMutation(api.sdk.authenticateCredential);
  const generate = useMutation(api.sdk.generate);
  const cancelJob = useMutation(api.sdk.cancel);
  const generateSecret = useMutation(api.sdk.generateWebhookSecret);
  const deliverWebhook = useMutation(api.sdk.deliverWebhook);

  const [category, setCategory] = useState<SdkCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string>("openai");
  const provider = sdkProviderById(selectedId) ?? SDK_PROVIDERS[0];

  const visible = useMemo(
    () =>
      SDK_PROVIDERS.filter((p) => category === "all" || p.category === category),
    [category],
  );

  /* ---- playground state ------------------------------------- */
  const [credential, setCredential] = useState("");
  const [authResult, setAuthResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [authing, setAuthing] = useState(false);

  const [model, setModel] = useState(provider.defaultModel);
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<Id<"providerJobs"> | null>(null);
  const [generating, setGenerating] = useState(false);

  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);

  const job = useQuery(api.sdk.status, jobId ? { jobId } : "skip");
  const jobDoc = job ?? null;

  /* ---- operations ------------------------------------------- */

  async function handleAuthenticate() {
    setAuthing(true);
    setAuthResult(null);
    try {
      const res = await authenticateCredential({
        provider: provider.id,
        credential: credential.trim() || SAMPLE_CREDENTIALS[provider.id],
      });
      setAuthResult(res);
    } catch (e) {
      setAuthResult({ ok: false, error: e instanceof Error ? e.message : "Auth failed" });
    } finally {
      setAuthing(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await generate({
        provider: provider.id,
        model,
        prompt,
        credential: credential.trim() || undefined,
      });
      setJobId(res.jobId);
      toast.success(`${provider.label} job queued — watch it process…`);
      setPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCancel() {
    if (!jobId) return;
    try {
      await cancelJob({ jobId });
      toast.success("Job cancelled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleGenerateSecret() {
    try {
      const res = await generateSecret({ provider: provider.id });
      setWebhookSecret(res.secret);
      toast.success(`Webhook secret for ${provider.label} — shown once.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate secret");
    }
  }

  async function handleDeliverWebhook() {
    if (!jobId) return;
    if (!webhookSecret) {
      toast.error("Generate a webhook secret first.");
      return;
    }
    setDelivering(true);
    try {
      const payload = JSON.stringify({ jobId, provider: provider.id, event: "generation.completed" });
      const signature = await signWebhookPayload(webhookSecret, payload);
      const res = await deliverWebhook({ jobId, event: "generation.completed", payload, signature });
      toast.success(`Webhook verified (${res.status}) — job reconciled.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webhook delivery failed");
    } finally {
      setDelivering(false);
    }
  }

  function selectProvider(p: SdkProvider) {
    setSelectedId(p.id);
    setModel(p.defaultModel);
    setAuthResult(null);
    setJobId(null);
    setWebhookSecret(null);
  }

  const progress =
    jobDoc && (jobDoc.status === "processing" || jobDoc.status === "queued")
      ? Math.min(
          100,
          Math.round(
            (((jobDoc.startedAt ?? jobDoc.createdAt + 500) - jobDoc.createdAt + 500) /
              jobDoc.durationMs) *
              100,
          ),
        )
      : null;

  return (
    <div className="space-y-10">
      {/* ── header ─────────────────────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="STEP 05 · Provider SDK"
          title="Every provider, one contract"
        />
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
          Fifteen upstreams — OpenAI, Claude, Gemini, OpenRouter, Meshy, Tripo, Hunyuan3D,
          Runway, Luma, Pika, Fal, Replicate, Stable Diffusion, ElevenLabs, Deepgram — each
          exposing the same six operations: authenticate, generate, status, cancel, download,
          webhook. The playground below drives a live job through that contract.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* ── catalog ─────────────────────────────────────────── */}
        <div className="xl:col-span-3">
          <div className="rounded-lg border border-border bg-card p-6">
            <SectionTitle kicker="Registry" title="Providers" />

            {/* category filter */}
            <div className="scrollbar-thin mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {(["all", ...CATEGORY_ORDER] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors",
                    category === c
                      ? "border-foreground/25 bg-accent text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c === "all" ? "All" : CATEGORY_META[c].label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {visible.map((p) => {
                const selected = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProvider(p)}
                    className={cn(
                      "group rounded-md border p-3.5 text-left transition-all",
                      selected
                        ? "border-foreground/30 bg-accent/50"
                        : "border-border bg-background hover:border-foreground/25",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-foreground">{p.label}</p>
                      {selected && <Check className="size-3.5 text-chart-1" />}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {p.tagline}
                    </p>
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground/80">
                      {CATEGORY_META[p.category].label} · {p.defaultModel}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* job list */}
          <div className="mt-6 rounded-lg border border-border bg-card p-6">
            <SectionTitle kicker="SDK ledger" title="Recent jobs" />
            <div className="mt-4 divide-y divide-border/70">
              {(jobs ?? []).length === 0 && (
                <p className="py-6 text-center text-[12px] text-muted-foreground">
                  No SDK jobs yet — run one in the playground.
                </p>
              )}
              {(jobs ?? []).map((j) => (
                <div key={j._id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-foreground">
                      {sdkProviderById(j.provider)?.label ?? j.provider} · {j.model}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
                      {j._id} · {j.prompt.slice(0, 48)}…
                    </span>
                  </span>
                  <JobBadge status={j.status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── playground ──────────────────────────────────────── */}
        <div className="space-y-6 xl:col-span-2">
          <div className="rounded-lg border border-border bg-card p-6">
            <SectionTitle
              kicker="Playground"
              title={provider.label}
              right={
                <span className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {provider.authEnv}
                </span>
              }
            />

            {/* operations strip */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {OPERATIONS.map((op) => (
                <span
                  key={op.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground"
                >
                  <op.icon className="size-3" />
                  {op.label}
                </span>
              ))}
            </div>

            {/* 1 · authenticate */}
            <div className="mt-5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                1 · Authenticate
              </Label>
              <div className="mt-2 flex gap-2">
                <Input
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder={`e.g. ${SAMPLE_CREDENTIALS[provider.id].slice(0, 8)}…`}
                  className="font-mono text-[12px]"
                />
                <Button
                  variant="outline"
                  onClick={() => void handleAuthenticate()}
                  disabled={authing}
                  className="shrink-0 border-border bg-background"
                >
                  {authing ? <Loader2 className="size-3.5 animate-spin" /> : "Validate"}
                </Button>
              </div>
              {authResult && (
                <p
                  className={cn(
                    "mt-2 flex items-center gap-1.5 text-[11.5px]",
                    authResult.ok ? "text-chart-2" : "text-destructive",
                  )}
                >
                  {authResult.ok ? (
                    <BadgeCheck className="size-3.5" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                  {authResult.ok
                    ? `Authenticated with ${provider.label} — ${provider.baseUrl}`
                    : authResult.error}
                </p>
              )}
            </div>

            {/* 2 · generate */}
            <div className="mt-5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                2 · Generate
              </Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="border-border bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {provider.models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
                  timeout {(provider.timeoutMs / 1000).toFixed(0)}s
                </div>
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Prompt for ${provider.label}…`}
                rows={3}
                className="mt-2 resize-none border-border bg-background text-[12.5px]"
              />
              <Button
                onClick={() => void handleGenerate()}
                disabled={generating || prompt.trim().length === 0}
                className="mt-2.5 w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Generate job
              </Button>
            </div>
          </div>

          {/* live job */}
          <div className="rounded-lg border border-border bg-card p-6">
            <SectionTitle
              kicker="3 · Status · 4 · Cancel · 5 · Download"
              title="Live job"
              right={jobDoc ? <JobBadge status={jobDoc.status} /> : undefined}
            />
            {!jobId ? (
              <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
                Generate a job to see its lifecycle here.
              </p>
            ) : jobDoc ? (
              <div className="mt-4 space-y-4">
                <p className="truncate font-mono text-[11px] text-muted-foreground">{jobId}</p>

                {progress != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
                    <div
                      className="h-full rounded-full bg-chart-1 transition-all duration-700"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}

                {jobDoc.status === "completed" && (
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Artifact
                    </p>
                    <p className="mt-2 break-words font-mono text-[11px] leading-5 text-foreground/85">
                      {jobDoc.outputText}
                    </p>
                    <p className="mt-2 truncate font-mono text-[10.5px] text-chart-1">
                      {jobDoc.outputUrl}
                    </p>
                  </div>
                )}
                {jobDoc.status === "failed" && (
                  <p className="text-[12px] text-destructive">{jobDoc.error ?? "Job failed."}</p>
                )}

                {(jobDoc.status === "queued" || jobDoc.status === "processing") && (
                  <Button
                    variant="outline"
                    onClick={() => void handleCancel()}
                    className="w-full border-border bg-background text-destructive hover:bg-destructive/5"
                  >
                    <X className="size-3.5" /> Cancel job
                  </Button>
                )}
                {jobDoc.status === "completed" && (
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <CloudDownload className="size-3.5 text-chart-2" />
                    Download ready — artifact stored for 30 days.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}
          </div>

          {/* 6 · webhook */}
          <div className="rounded-lg border border-border bg-card p-6">
            <SectionTitle kicker="6 · Webhook" title="Signed delivery" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-muted-foreground">
                  {webhookSecret
                    ? "Secret ready — shown once, sign payloads with it."
                    : "Generate a per-provider signing secret."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleGenerateSecret()}
                  className="shrink-0 border-border bg-background"
                >
                  <WebhookIcon className="size-3.5" />
                  {webhookSecret ? "Regenerate" : "Generate"}
                </Button>
              </div>
              {webhookSecret && (
                <p className="rounded-md border border-chart-1/30 bg-chart-1/5 px-3 py-2 font-mono text-[11px] text-chart-1">
                  {webhookSecret}
                </p>
              )}
              <Button
                onClick={() => void handleDeliverWebhook()}
                disabled={!jobId || !webhookSecret || delivering}
                className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {delivering ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <WebhookIcon className="size-3.5" />
                )}
                Deliver generation.completed
              </Button>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Signs the payload with HMAC-SHA256 in your browser, then the server verifies
                the signature before reconciling the job — the same path as{" "}
                <span className="font-mono text-foreground/80">POST /v1/webhooks/:provider</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
