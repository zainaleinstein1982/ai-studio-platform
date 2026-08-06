import { api } from "@/convex/_generated/api";
import {
  KIND_META,
  PROVIDER_MODELS,
  type GatewayKind,
} from "@/convex/catalog";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Check,
  ImagePlus,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle, StatusBadge, kindLabel, providerLabel } from "./bits";
import { cn } from "@/lib/utils";
import { isKeyActive, scopeAllows } from "@/convex/keyPolicy";
import { useNow } from "@/hooks/use-now";
import type { Id } from "@/convex/_generated/dataModel";

const KINDS = Object.keys(KIND_META) as GatewayKind[];

interface PendingImage {
  storageId: Id<"_storage">;
  name: string;
  preview: string;
}

/* STEP 04 · stage labels for the events timeline */
const STAGE_META: Record<string, { label: string; tone: "done" | "info" | "fail" }> = {
  accepted: { label: "Accepted by gateway", tone: "done" },
  queued: { label: "Queued for a worker", tone: "info" },
  dequeued: { label: "Dequeued by worker", tone: "info" },
  attempt: { label: "Provider attempt", tone: "info" },
  retry: { label: "Retrying (backoff)", tone: "info" },
  chunk: { label: "Streaming chunk", tone: "info" },
  completed: { label: "Completed", tone: "done" },
  failed: { label: "Failed", tone: "fail" },
};

export function GatewayTab() {
  const requests = useQuery(api.gateway.list, { limit: 6 });
  const stats = useQuery(api.gateway.stats);
  const keys = useQuery(api.apiKeys.list);
  const health = useQuery(api.gateway.providerHealth);
  const send = useMutation(api.gateway.send);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const [kind, setKind] = useState<GatewayKind>("text");
  const groups = useMemo(() => PROVIDER_MODELS[kind], [kind]);
  const [provider, setProvider] = useState(groups[0].provider);
  const [model, setModel] = useState(groups[0].models[0]);

  function handleKindChange(next: GatewayKind) {
    const nextGroups = PROVIDER_MODELS[next];
    setKind(next);
    setProvider(nextGroups[0].provider);
    setModel(nextGroups[0].models[0]);
  }
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<PendingImage | null>(null);
  const [apiKeyId, setApiKeyId] = useState<string>("auto");
  const [stream, setStream] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const latest = requests?.[0];
  const meta = KIND_META[kind];
  const credits = stats?.credits ?? 0;
  // STEP 03 · only offer keys whose scopes grant this route and that are active.
  const now = useNow();
  const activeKeys = (keys ?? []).filter((k) => !k.revokedAt && isKeyActive(k, now));
  const allowedKeys = activeKeys.filter((k) => scopeAllows(k.scopes, kind));
  const effectiveApiKeyId = allowedKeys.some((k) => k.id === apiKeyId) ? apiKeyId : "auto";

  const cost = meta.credits;
  const canSend =
    prompt.trim().length > 0 &&
    (!meta.needsImage || image !== null) &&
    credits >= cost &&
    !sending;

  async function handleImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setImage({ storageId, name: file.name, preview: URL.createObjectURL(file) });
    } catch {
      toast.error("Image upload failed — try again.");
    }
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      await send({
        kind,
        provider,
        model,
        prompt: prompt.trim(),
        imageStorageId: image?.storageId,
        imageName: image?.name,
        apiKeyId: apiKeyId === "auto" ? undefined : (apiKeyId as Id<"apiKeys">),
        stream,
        simulateFailure,
      });
      toast.success(
        stream
          ? `${meta.label} request queued — streaming the response in chunks…`
          : `${meta.label} request queued — watching the pipeline…`,
      );
      setPrompt("");
      setImage((img) => {
        if (img) URL.revokeObjectURL(img.preview);
        return null;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed to send.");
    } finally {
      setSending(false);
    }
  }

  /* ---- pipeline trace steps ---------------------------------- */
  const status = latest?.status ?? null;
  const attempts = latest?.attempts ?? 0;
  const steps = [
    {
      key: "router",
      label: "Gateway router",
      detail: latest ? `${latest.provider}/${latest.model}` : "kind → provider → model",
      state: status === null ? "pending" : "done",
    },
    {
      key: "queue",
      label: "Queue system",
      detail: latest ? `drained by worker · ${latest.status === "queued" ? "waiting" : "dequeued"}` : "durable queue",
      state: status === null ? "pending" : status === "queued" ? "active" : status === "failed" ? "failed" : "done",
    },
    {
      key: "provider",
      label: "AI provider",
      detail: latest
        ? `${providerLabel(latest.provider)} · ${latest.model}${attempts > 1 ? ` · ${attempts} attempt${attempts > 1 ? "s" : ""}` : ""}`
        : "simulated round trip",
      state: status === null ? "pending" : status === "processing" ? "active" : status === "completed" ? "done" : status === "failed" ? "failed" : "pending",
    },
    {
      key: "storage",
      label: "Object storage",
      detail: latest?.imageUrl || latest?.status === "completed" ? "assets bucket" : "inputs & outputs",
      state: status === "completed" ? "done" : "pending",
    },
    {
      key: "ledger",
      label: "History & billing",
      detail: latest ? `${latest.credits} credit${latest.credits > 1 ? "s" : ""} · ledger updated` : "metered per call",
      state: status === "completed" ? "done" : "pending",
    },
  ];

  /* STEP 04 · streaming output cursor — show partial text live */
  const streaming =
    latest?.stream && latest.status === "processing" && latest.responseText != null;
  const showOutput =
    latest?.status === "completed" && latest.responseText
      ? latest.responseText
      : streaming
        ? latest.responseText
        : null;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      {/* ── Composer ──────────────────────────────────────────── */}
      <div className="xl:col-span-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Request composer" title="Send through the gateway" />

          {/* route kinds */}
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Route
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const m = KIND_META[k];
              const selected = k === kind;
              return (
                <button
                  key={k}
                  onClick={() => handleKindChange(k)}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left transition-all",
                    selected
                      ? "border-foreground/30 bg-accent/50 shadow-[inset_0_0_0_1px_oklch(0.885_0.011_85)]"
                      : "border-border bg-background hover:border-foreground/25",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-foreground">
                      {m.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {m.credits} cr · {m.short}
                    </span>
                  </span>
                  {selected && <Check className="size-3.5 shrink-0 text-chart-1" />}
                </button>
              );
            })}
          </div>

          {/* provider / model / key */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Provider
              </Label>
              <Select value={provider} onValueChange={(v) => {
                setProvider(v);
                const g = groups.find((x) => x.provider === v);
                if (g) setModel(g.models[0]);
              }}>
                <SelectTrigger className="mt-2 border-border bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.provider} value={g.provider}>
                      {g.providerLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Model
              </Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-2 border-border bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups
                    .find((g) => g.provider === provider)
                    ?.models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Via API key
              </Label>
              <Select value={effectiveApiKeyId} onValueChange={setApiKeyId}>
                <SelectTrigger className="mt-2 border-border bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (no key)</SelectItem>
                  {allowedKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                {allowedKeys.length === 0
                  ? `No keys grant the ${meta.label} route — edit a key's scopes in API Keys.`
                  : `${allowedKeys.length} key${allowedKeys.length > 1 ? "s" : ""} grant${allowedKeys.length === 1 ? "s" : ""} this route.`}
              </p>
            </div>
          </div>

          {/* prompt */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Prompt
              </Label>
              <button
                onClick={() => setPrompt(meta.example)}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-chart-1 transition-colors hover:text-chart-1/80"
              >
                <Sparkles className="size-3" /> Use an example
              </button>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={meta.placeholder}
              rows={5}
              className="mt-2 resize-none border-border bg-background text-[13px] focus-visible:ring-chart-1/30"
            />
          </div>

          {/* image */}
          {meta.needsImage && (
            <div className="mt-5">
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Input image
              </Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void handleImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {image ? (
                <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-background p-2.5">
                  <img
                    src={image.preview}
                    alt="preview"
                    className="h-14 w-14 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium">{image.name}</p>
                    <p className="text-[11px] text-muted-foreground">staged for storage</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      URL.revokeObjectURL(image.preview);
                      setImage(null);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-4 py-6 text-[12.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <ImagePlus className="size-4" />
                  Drop or choose an image
                </button>
              )}
            </div>
          )}

          {/* STEP 04 · gateway behavior toggles */}
          <div className="mt-5 grid gap-3 rounded-md border border-border/70 bg-background p-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-[12.5px] font-medium text-foreground">Stream response</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                  Deliver the output in chunks with a live cursor.
                </span>
              </span>
              <Switch checked={stream} onCheckedChange={setStream} />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-[12.5px] font-medium text-foreground">Simulate failure</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                  Force a provider outage to exercise retry + circuit breaker.
                </span>
              </span>
              <Switch checked={simulateFailure} onCheckedChange={setSimulateFailure} />
            </label>
          </div>

          {/* send row */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
            <p className="text-[12px] text-muted-foreground">
              Cost: <span className="font-mono text-foreground">{cost} credits</span> · balance{" "}
              <span className={cn("font-mono", credits < cost ? "text-destructive" : "text-foreground")}>
                {credits.toLocaleString()}
              </span>
            </p>
            <Button
              onClick={handleSend}
              disabled={!canSend}
              className="group gap-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  Send request
                  <Send className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Trace + response ──────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Live trace"
            title="Pipeline"
            right={latest ? <StatusBadge status={latest.status} /> : undefined}
          />

          <div className="mt-6">
            {steps.map((s, i) => (
              <div key={s.key} className="relative flex gap-3.5">
                {/* connector */}
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-[9px] top-6 h-[calc(100%-6px)] w-px",
                      s.state === "done" ? "bg-chart-2/60" : "bg-border",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    s.state === "done" && "border-chart-2/60 bg-chart-2/10 text-chart-2",
                    s.state === "active" && "border-chart-4/60 bg-chart-4/10 text-chart-4",
                    s.state === "failed" && "border-destructive/50 bg-destructive/10 text-destructive",
                    s.state === "pending" && "border-border bg-background text-muted-foreground/40",
                  )}
                >
                  {s.state === "done" ? (
                    <Check className="size-3" />
                  ) : s.state === "active" ? (
                    <span className="size-2 animate-pulse rounded-full bg-chart-4" />
                  ) : s.state === "failed" ? (
                    <X className="size-3" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-border" />
                  )}
                </span>
                <div className="min-w-0 flex-1 pb-5">
                  <p className="text-[13px] font-medium text-foreground">{s.label}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* STEP 04 · events timeline */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Task queue" title="Events" />
          {latest && latest.events?.length ? (
            <div className="mt-4 space-y-1">
              {latest.events.map((ev, i) => {
                const m = STAGE_META[ev.stage] ?? { label: ev.stage, tone: "info" as const };
                return (
                  <div key={i} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-accent/40">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        m.tone === "done" && "bg-chart-2",
                        m.tone === "fail" && "bg-destructive",
                        m.tone === "info" && "bg-chart-4",
                      )}
                    />
                    <p className="min-w-0 flex-1 text-[12px] text-foreground/90">{m.label}</p>
                    {ev.detail && (
                      <p className="max-w-[45%] truncate font-mono text-[10.5px] text-muted-foreground">
                        {ev.detail}
                      </p>
                    )}
                    <p className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                      +{Math.round((ev.at - (latest.createdAt ?? ev.at)) / 1000)}s
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
              Request events appear here as the worker pipeline advances.
            </p>
          )}
        </div>

        {/* response */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Provider response"
            title="Output"
            right={streaming ? <span className="text-[11px] font-medium text-chart-4">streaming…</span> : undefined}
          />
          {latest && showOutput ? (
            <div className="mt-4 space-y-4">
              {latest?.imageUrl && latest.status === "completed" && (
                <img
                  src={latest.imageUrl}
                  alt={latest.imageName ?? "input image"}
                  className="max-h-40 rounded border border-border object-contain"
                />
              )}
              <pre className="scrollbar-thin overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-[11.5px] leading-6 text-foreground/90">
                {showOutput}
                {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-chart-4 align-middle" />}
              </pre>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[11.5px] text-muted-foreground">
                <span>
                  latency <span className="font-mono text-foreground">{latest.latencyMs != null ? `${(latest.latencyMs / 1000).toFixed(2)}s` : "—"}</span>
                </span>
                <span>
                  route{" "}
                  <span className="font-mono text-foreground">
                    {latest.provider}/{latest.model}
                  </span>
                </span>
                <span>
                  cost <span className="font-mono text-foreground">{latest.credits} cr</span>
                </span>
                <span>
                  attempts <span className="font-mono text-foreground">{latest.attempts ?? 0}</span>
                </span>
              </div>
            </div>
          ) : latest ? (
            <div className="mt-4 flex h-40 items-center justify-center rounded-md border border-dashed border-border">
              <p className="text-[12px] text-muted-foreground">
                {latest.status === "queued"
                  ? "Request is waiting in the queue…"
                  : latest.status === "processing"
                    ? "Provider is working on it…"
                    : "Awaiting output."}
              </p>
            </div>
          ) : (
            <div className="mt-4 flex h-40 items-center justify-center rounded-md border border-dashed border-border">
              <p className="max-w-[240px] text-center text-[12px] text-muted-foreground">
                Send a request and watch it travel the pipeline, then collect the response here.
              </p>
            </div>
          )}
        </div>

        {/* STEP 04 · provider health */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Provider manager" title="Upstream health" />
          {health?.length ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {health.map((h) => (
                <div
                  key={h.provider}
                  className={cn(
                    "rounded-md border px-3 py-2.5",
                    h.healthy ? "border-border bg-background" : "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-foreground">{h.label}</p>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        h.state === "closed" && "bg-chart-2",
                        h.state === "half_open" && "bg-chart-4",
                        h.state === "open" && "bg-destructive",
                      )}
                    />
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {h.state.replace("_", " ")}
                    {h.retryInSec != null && ` · retry ${h.retryInSec}s`}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {h.successCount} ok · {h.failures} fail · timeout {(h.timeoutMs / 1000).toFixed(0)}s
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
              Provider breaker state appears here after the first request.
            </p>
          )}
        </div>

        {/* recent */}
        <div>
          <SectionTitle kicker="Ledger" title="Just sent" />
          <div className="mt-3 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
            {(requests ?? []).slice(0, 4).map((r) => (
              <div key={r._id} className="flex items-center gap-3 px-4 py-3">
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                <p className="min-w-0 flex-1 truncate text-[12.5px]">
                  <span className="font-medium">{kindLabel(r.kind)}</span>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{providerLabel(r.provider)}/{r.model}</span>
                </p>
                <StatusBadge status={r.status} />
                <span className="font-mono text-[11px] text-muted-foreground">{r.credits} cr</span>
              </div>
            ))}
            {!requests?.length && (
              <p className="px-4 py-5 text-center text-[12px] text-muted-foreground">
                Nothing sent yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
