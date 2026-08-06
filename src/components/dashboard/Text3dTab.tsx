import { api } from "@/convex/_generated/api";
import {
  TEXT3D_PROVIDER_IDS,
  validatePrompt,
  optimizePrompt,
  routeProvider,
  type Text3dProviderId,
} from "@/convex/threeD/pipeline";
import { sdkProviderById } from "@/convex/providers/sdk";
import { useMutation, useQuery } from "convex/react";
import {
  Box,
  Check,
  CloudDownload,
  File,
  FileArchive,
  FileCode2,
  Loader2,
  RefreshCw,
  Sparkles,
  Webhook as WebhookIcon,
  X,
} from "lucide-react";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle } from "./bits";
import { cn } from "@/lib/utils";
import { signWebhookPayload } from "@/convex/providers/sdk";
import { useNow } from "@/hooks/use-now";
import type { Id } from "@/convex/_generated/dataModel";

const EXAMPLES = [
  "a minimalist ceramic vase with a ribbed neck, 12 cm tall",
  "a low-poly forest fox for a game character",
  "an organic free-form sculpture inspired by sea foam",
  "a mid-century reading chair with turned legs, print-ready",
];

/* The 13 workflow stages from the STEP 06 spec. */
const STAGES = [
  { key: "receive", label: "Receive prompt", desc: "ingress accepted" },
  { key: "validate", label: "Validate", desc: "length & content checks" },
  { key: "optimize", label: "Optimize prompt", desc: "provider-tuned enrichment" },
  { key: "router", label: "Provider router", desc: "keyword + preference routing" },
  { key: "submit", label: "Submit task", desc: "queued to Meshy · Tripo · Hunyuan3D" },
  { key: "poll", label: "Polling", desc: "scheduler advances the task" },
  { key: "glb", label: "Download GLB", desc: "glTF 2.0 export" },
  { key: "fbx", label: "Download FBX", desc: "Autodesk exchange" },
  { key: "obj", label: "Download OBJ", desc: "wavefront geometry" },
  { key: "history", label: "History", desc: "ledger entry written" },
  { key: "retry", label: "Retry", desc: "failed tasks re-queued" },
  { key: "webhook", label: "Webhook", desc: "signed delivery" },
  { key: "storage", label: "Storage", desc: "artifacts in the asset bucket" },
];

const PROVIDER_META: Record<Text3dProviderId, string> = {
  meshy: "PBR-baked · game-ready",
  tripo: "watertight · printable",
  hunyuan3d: "organic · realtime",
};

const T3D_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  queued: { label: "Queued", cls: "border-chart-5/50 bg-chart-5/10 text-chart-5", dot: "bg-chart-5" },
  processing: { label: "Processing", cls: "border-chart-4/50 bg-chart-4/10 text-chart-4", dot: "bg-chart-4" },
  completed: { label: "Completed", cls: "border-chart-2/50 bg-chart-2/10 text-chart-2", dot: "bg-chart-2" },
  failed: { label: "Failed", cls: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function T3dBadge({ status }: { status: string }) {
  const cfg = T3D_STATUS[status] ?? T3D_STATUS.queued;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", cfg.cls)}>
      <span className={cn("size-1.5 rounded-full", cfg.dot, status === "queued" || status === "processing" ? "animate-pulse" : "")} />
      {cfg.label}
    </span>
  );
}

function fmtProgress(status: string, createdAt: number, durationMs: number, now: number) {
  if (status === "completed") return 100;
  if (status === "queued") return 4;
  if (status === "processing") {
    return Math.min(96, Math.round(((now - createdAt - 500) / durationMs) * 96));
  }
  return 0;
}

export function Text3dTab() {
  const tasks = useQuery(api.textTo3d.list, { limit: 10 });
  const create = useMutation(api.textTo3d.create);
  const retryTask = useMutation(api.textTo3d.retry);
  const cancelTask = useMutation(api.textTo3d.cancel);
  const generateSecret = useMutation(api.sdk.generateWebhookSecret);
  const deliverWebhook = useMutation(api.textTo3d.deliverWebhook);

  const [prompt, setPrompt] = useState("");
  const [preferred, setPreferred] = useState<string>("auto");
  const [taskId, setTaskId] = useState<Id<"text3dTasks"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);

  const task = useQuery(api.textTo3d.get, taskId ? { taskId } : "skip");

  /* ---- live composer previews (pure pipeline functions) ---- */
  const validation = validatePrompt(prompt);
  const routed = prompt.trim().length >= 4 ? routeProvider({ prompt }) : null;
  const optimized = routed ? optimizePrompt(prompt, routed.provider) : null;
  const preferredRoute =
    preferred !== "auto" ? routeProvider({ prompt, preferredProvider: preferred }) : null;

  const now = useNow(1000);
  const canSubmit = validation.ok && !submitting;

  async function handleSubmit() {
    if (!validation.ok || !validation.clean) return;
    setSubmitting(true);
    try {
      const res = await create({
        prompt: validation.clean,
        preferredProvider: preferred === "auto" ? undefined : preferred,
      });
      setTaskId(res.taskId);
      toast.success(`Task queued via ${sdkProviderById(res.provider)?.label ?? res.provider} · ${res.model}`);
      setPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    if (!taskId) return;
    try {
      await retryTask({ taskId });
      toast.success("Task re-queued — retrying…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
  }

  async function handleCancel() {
    if (!taskId) return;
    try {
      await cancelTask({ taskId });
      toast.success("Task cancelled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleGenerateSecret() {
    try {
      const provider = task?.provider ?? routed?.provider ?? "tripo";
      const res = await generateSecret({ provider });
      setWebhookSecret(res.secret);
      toast.success(`Webhook secret for ${sdkProviderById(provider)?.label ?? provider} — shown once.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate secret");
    }
  }

  async function handleDeliverWebhook() {
    if (!taskId) return;
    if (!webhookSecret) {
      toast.error("Generate a webhook secret first.");
      return;
    }
    setDelivering(true);
    try {
      const payload = JSON.stringify({ taskId, event: "generation.completed" });
      const signature = await signWebhookPayload(webhookSecret, payload);
      const res = await deliverWebhook({
        taskId,
        event: "generation.completed",
        payload,
        signature,
      });
      toast.success(`Webhook verified — task reconciled (${res.status}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webhook delivery failed");
    } finally {
      setDelivering(false);
    }
  }

  /* ---- workflow stage states --------------------------------- */
  const stageState = (key: string): "done" | "active" | "pending" | "failed" => {
    if (!task) return key === "receive" ? "active" : "pending";
    const order = STAGES.map((s) => s.key);
    const idx = order.indexOf(key);
    const terminal =
      task.status === "completed" ? 13 : task.status === "failed" || task.status === "cancelled" ? 5 : task.status === "processing" ? 6 : 5;
    if (idx < terminal) return "done";
    if (idx === terminal) return task.status === "failed" || task.status === "cancelled" ? "failed" : "active";
    return "pending";
  };

  const progress = task
    ? fmtProgress(task.status, task.createdAt, task.durationMs, now)
    : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      {/* ── Composer ─────────────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Text → 3D module" title="Compose a mesh" />

          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Prompt
          </p>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe an object to generate as a 3D mesh…"
            rows={4}
            className="mt-2 resize-none border-border bg-background text-[13px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Sparkles className="size-2.5" />
                  {ex.slice(0, 26)}…
                </button>
              ))}
            </div>
            <p
              className={cn(
                "text-[11px]",
                validation.ok ? "text-chart-2" : "text-destructive",
              )}
            >
              {validation.ok ? "Prompt looks good" : (validation.reason ?? "…")}
            </p>
          </div>

          {/* provider preference */}
          <div className="mt-5">
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Provider preference
            </Label>
            <Select value={preferred} onValueChange={setPreferred}>
              <SelectTrigger className="mt-2 border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (router decides)</SelectItem>
                {TEXT3D_PROVIDER_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {sdkProviderById(id)?.label} · {PROVIDER_META[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* live pipeline previews */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background p-3.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Provider router
              </p>
              <p className="mt-1.5 text-[12.5px] font-medium text-foreground">
                {preferredRoute
                  ? `${sdkProviderById(preferredRoute.provider)?.label} · ${preferredRoute.model}`
                  : routed
                    ? `${sdkProviderById(routed.provider)?.label} · ${routed.model}`
                    : "type a prompt to route"}
              </p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {routed ? PROVIDER_META[routed.provider] : "keyword + preference based"}
              </p>
            </div>
            <div className="rounded-md border border-border/70 bg-background p-3.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Optimized prompt
              </p>
              <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-5 text-muted-foreground">
                {optimized ?? "the optimizer rewrites your prompt per provider"}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
            <p className="text-[12px] text-muted-foreground">
              Exports: <span className="font-mono text-foreground">GLB · FBX · OBJ</span> · 1 task
            </p>
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="group gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Box className="size-4" />
              )}
              Submit task
            </Button>
          </div>
        </div>

        {/* history */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="History" title="Recent tasks" />
          <div className="mt-4 divide-y divide-border/70">
            {!tasks?.length && (
              <p className="py-6 text-center text-[12px] text-muted-foreground">
                No 3D tasks yet — submit one in the composer.
              </p>
            )}
            {(tasks ?? []).map((t) => (
              <div key={t._id} className="flex items-center gap-3 py-3">
                <Box className="size-3.5 shrink-0 text-muted-foreground/50" />
                <p className="min-w-0 flex-1 truncate text-[12.5px]">
                  <span className="font-medium">{sdkProviderById(t.provider)?.label ?? t.provider}</span>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{t.prompt.slice(0, 44)}…</span>
                </p>
                <T3dBadge status={t.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Workflow + task ──────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Workflow"
            title="Pipeline"
            right={task ? <T3dBadge status={task.status} /> : undefined}
          />

          {task && (task.status === "queued" || task.status === "processing") && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-chart-1 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="mt-6 space-y-1">
            {STAGES.map((s, i) => {
              const state = stageState(s.key);
              return (
                <div key={s.key} className="relative flex items-start gap-3">
                  {i < STAGES.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-[9px] top-6 h-[calc(100%-4px)] w-px",
                        state === "done" ? "bg-chart-2/60" : "bg-border",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      state === "done" && "border-chart-2/60 bg-chart-2/10 text-chart-2",
                      state === "active" && "border-chart-4/60 bg-chart-4/10 text-chart-4",
                      state === "failed" && "border-destructive/50 bg-destructive/10 text-destructive",
                      state === "pending" && "border-border bg-background text-muted-foreground/40",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="size-3" />
                    ) : state === "active" ? (
                      <span className="size-2 animate-pulse rounded-full bg-chart-4" />
                    ) : state === "failed" ? (
                      <X className="size-3" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-border" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 pb-3">
                    <p className="text-[12.5px] font-medium text-foreground">{s.label}</p>
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                      {s.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* live task */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Live task" title="Submission" />
          {!task ? (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
              Submit a prompt to watch it travel the 13-stage pipeline.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="truncate font-mono text-[11px] text-muted-foreground">{task._id}</p>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Optimized prompt
                </p>
                <p className="mt-1.5 text-[11.5px] leading-5 text-foreground/85">
                  {task.optimizedPrompt}
                </p>
              </div>
              {task.status === "failed" && (
                <p className="text-[12px] text-destructive">{task.error ?? "Task failed."}</p>
              )}

              {task.status === "completed" && (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Exports
                  </p>
                  {[
                    { fmt: "GLB", icon: FileCode2, url: task.glbUrl },
                    { fmt: "FBX", icon: FileArchive, url: task.fbxUrl },
                    { fmt: "OBJ", icon: File, url: task.objUrl },
                  ].map(({ fmt, icon: Icon, url }) => (
                    <div
                      key={fmt}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-foreground">
                        <Icon className="size-3.5 text-chart-1" />
                        {fmt}
                      </span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {url}
                      </span>
                    </div>
                  ))}
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-chart-2">
                    <CloudDownload className="size-3" />
                    Downloads ready — assets retained 30 days.
                  </p>
                </div>
              )}

              {(task.status === "queued" || task.status === "processing") && (
                <Button
                  variant="outline"
                  onClick={() => void handleCancel()}
                  className="w-full border-border bg-background text-destructive hover:bg-destructive/5"
                >
                  <X className="size-3.5" /> Cancel task
                </Button>
              )}
              {task.status === "failed" && (
                <Button
                  onClick={() => void handleRetry()}
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <RefreshCw className="size-3.5" /> Retry task ({task.attempts}/3)
                </Button>
              )}
            </div>
          )}
        </div>

        {/* webhook */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Webhook" title="Signed delivery" />
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                {webhookSecret
                  ? "Secret ready — shown once."
                  : "Generate the provider signing secret."}
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
              disabled={!taskId || !webhookSecret || delivering}
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
              HMAC-SHA256 signature verified server-side — same path as{" "}
              <span className="font-mono text-foreground/80">POST /v1/webhooks/text3d/:taskId</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
