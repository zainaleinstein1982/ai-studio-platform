import { api } from "@/convex/_generated/api";
import {
  VIDEO_PROVIDER_IDS,
  validateMotionPrompt,
  optimizeMotionPrompt,
  routeVideoProvider,
  type VideoProviderId,
} from "@/convex/video/pipeline";
import { buildImageVideoPrompt } from "@/convex/video/imagePipeline";
import { validateImage, visionCaption, type UploadedImage } from "@/convex/threeD/imagePipeline";
import { sdkProviderById, signWebhookPayload } from "@/convex/providers/sdk";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Clapperboard,
  CloudDownload,
  Eye,
  FileVideo,
  Film,
  Image as ImageGlyph,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
  Webhook as WebhookIcon,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle } from "./bits";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import {
  MAX_FILE_BYTES,
  loadImage,
  readFileAsDataUrl,
  downscaleImage,
} from "./imageUtils";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type TextVideoDoc = Doc<"textVideoTasks">;
type ImageVideoDoc = Doc<"imageVideoTasks">;

/* The 11 workflow stages from the STEP 08 spec. */
const STAGES = [
  { key: "receive", label: "Receive prompt", desc: "ingress accepted" },
  { key: "validate", label: "Validate", desc: "length & content checks" },
  { key: "optimize", label: "Optimize motion", desc: "provider-tuned rewrite" },
  { key: "router", label: "Provider router", desc: "runway · luma · pika" },
  { key: "queue", label: "Queue", desc: "render queue entry" },
  { key: "progress", label: "Progress", desc: "frames rendering…" },
  { key: "streaming", label: "Streaming", desc: "chunks delivered live" },
  { key: "preview", label: "Preview", desc: "poster frame rendered" },
  { key: "history", label: "History", desc: "ledger entry written" },
  { key: "download", label: "Download", desc: "MP4 export ready" },
  { key: "webhook", label: "Webhook", desc: "signed delivery" },
];

const PROVIDER_META: Record<VideoProviderId, string> = {
  runway: "cinematic · photoreal",
  luma: "dream-like · fluid",
  pika: "effects · loops",
};

const TEXT_EXAMPLES = [
  "slow dolly across a sunlit atelier, 8 seconds, shallow depth of field",
  "a dreamlike morph of clouds into waves, seamless loop",
  "a playful sticker-style loop of a cat chasing light, saturated",
  "aerial drone tracking over a quiet coastal road at dusk",
];

const IMAGE_MOTION_EXAMPLES = [
  "the curtains sway gently; dust drifts through the light",
  "a slow push-in with soft focus drift",
  "gentle parallax — the scene breathes in and out",
  "raindrops race down the window; the street blurs beyond",
];

const VIDEO_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  queued: { label: "Queued", cls: "border-chart-5/50 bg-chart-5/10 text-chart-5", dot: "bg-chart-5" },
  processing: { label: "Rendering", cls: "border-chart-4/50 bg-chart-4/10 text-chart-4", dot: "bg-chart-4" },
  completed: { label: "Completed", cls: "border-chart-2/50 bg-chart-2/10 text-chart-2", dot: "bg-chart-2" },
  failed: { label: "Failed", cls: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function VideoBadge({ status }: { status: string }) {
  const cfg = VIDEO_STATUS[status] ?? VIDEO_STATUS.queued;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", cfg.cls)}>
      <span className={cn("size-1.5 rounded-full", cfg.dot, status === "queued" || status === "processing" ? "animate-pulse" : "")} />
      {cfg.label}
    </span>
  );
}

function fmtProgress(status: string, createdAt: number, durationMs: number, now: number) {
  if (status === "completed") return 100;
  if (status === "queued") return 3;
  if (status === "processing") return Math.min(97, Math.round(((now - createdAt - 500) / durationMs) * 97));
  return 0;
}

export function VideoTab() {
  const textTasks = useQuery(api.textToVideo.list, { limit: 8 });
  const imageTasks = useQuery(api.imageToVideo.list, { limit: 8 });
  const createText = useMutation(api.textToVideo.create);
  const createImage = useMutation(api.imageToVideo.create);
  const retryText = useMutation(api.textToVideo.retry);
  const retryImage = useMutation(api.imageToVideo.retry);
  const cancelText = useMutation(api.textToVideo.cancel);
  const cancelImage = useMutation(api.imageToVideo.cancel);
  const generateSecret = useMutation(api.sdk.generateWebhookSecret);
  const deliverText = useMutation(api.textToVideo.deliverWebhook);
  const deliverImage = useMutation(api.imageToVideo.deliverWebhook);

  const [mode, setMode] = useState<"text" | "image">("text");

  /* text composer */
  const [prompt, setPrompt] = useState("");
  const [preferred, setPreferred] = useState<string>("auto");

  /* image composer */
  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [textTaskId, setTextTaskId] = useState<Id<"textVideoTasks"> | null>(null);
  const [imageTaskId, setImageTaskId] = useState<Id<"imageVideoTasks"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);

  const textTask = useQuery(api.textToVideo.get, textTaskId ? { taskId: textTaskId } : "skip");
  const imageTask = useQuery(api.imageToVideo.get, imageTaskId ? { taskId: imageTaskId } : "skip");
  const activeTask: TextVideoDoc | ImageVideoDoc | null | undefined = mode === "text" ? textTask : imageTask;

  const now = useNow(1000);

  /* ---- live pipeline previews (pure functions) ---- */
  const textValidation = validateMotionPrompt(prompt);
  const textRouted =
    prompt.trim().length >= 6
      ? routeVideoProvider({ prompt, preferredProvider: preferred === "auto" ? undefined : preferred })
      : null;
  const textOptimized = textRouted ? optimizeMotionPrompt(prompt, textRouted.provider) : null;

  const imageValidation = validateImage(upload ?? undefined);
  const caption = upload ? visionCaption(upload) : null;
  const motionValidation = validateMotionPrompt(motionPrompt);
  const combined =
    upload && caption && motionValidation.ok
      ? buildImageVideoPrompt(motionPrompt, caption)
      : null;
  const imageRouted =
    combined && upload
      ? routeVideoProvider({ prompt: combined, preferredProvider: preferred === "auto" ? undefined : preferred })
      : null;
  const imageOptimized = combined && imageRouted ? optimizeMotionPrompt(combined, imageRouted.provider) : null;

  const canSubmit =
    mode === "text"
      ? textValidation.ok && !submitting
      : Boolean(upload && motionValidation.ok) && !submitting;

  const routed = mode === "text" ? textRouted : imageRouted;

  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(`"${file.name}" is not an image.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Image too large — max 12 MB.");
      return;
    }
    try {
      const raw = await readFileAsDataUrl(file);
      const img = await loadImage(raw);
      const down = await downscaleImage(img);
      setUpload({
        name: file.name,
        dataUrl: down.dataUrl,
        width: down.width,
        height: down.height,
        avgColor: down.avgColor,
        brightness: down.brightness,
      });
      toast.success(`Still ready — ${down.width}×${down.height} · ${Math.round((down.dataUrl.length * 0.75) / 1024)} KB`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the image");
    }
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (mode === "text") {
        if (!textValidation.ok || !textValidation.clean) return;
        const res = await createText({
          prompt: textValidation.clean,
          preferredProvider: preferred === "auto" ? undefined : preferred,
        });
        setTextTaskId(res.taskId);
        toast.success(`Clip queued via ${sdkProviderById(res.provider)?.label ?? res.provider} · ${res.model} · ${res.totalFrames} frames`);
        setPrompt("");
      } else {
        if (!upload || !imageValidation.ok || !motionValidation.ok || !motionValidation.clean) return;
        const res = await createImage({
          imageName: upload.name,
          imageUrl: upload.dataUrl,
          width: upload.width,
          height: upload.height,
          avgColor: upload.avgColor,
          brightness: upload.brightness,
          prompt: motionValidation.clean,
          preferredProvider: preferred === "auto" ? undefined : preferred,
        });
        setImageTaskId(res.taskId);
        toast.success(`Clip queued via ${sdkProviderById(res.provider)?.label ?? res.provider} · ${res.model} · ${res.totalFrames} frames`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    try {
      if (mode === "text") {
        if (!textTaskId) return;
        await retryText({ taskId: textTaskId });
      } else {
        if (!imageTaskId) return;
        await retryImage({ taskId: imageTaskId });
      }
      toast.success("Task re-queued — retrying…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
  }

  async function handleCancel() {
    try {
      if (mode === "text") {
        if (!textTaskId) return;
        await cancelText({ taskId: textTaskId });
      } else {
        if (!imageTaskId) return;
        await cancelImage({ taskId: imageTaskId });
      }
      toast.success("Task cancelled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleGenerateSecret() {
    try {
      const provider = activeTask?.provider ?? routed?.provider ?? "runway";
      const res = await generateSecret({ provider });
      setWebhookSecret(res.secret);
      toast.success(`Webhook secret for ${sdkProviderById(provider)?.label ?? provider} — shown once.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate secret");
    }
  }

  async function handleDeliverWebhook() {
    if (!webhookSecret) {
      toast.error("Generate a webhook secret first.");
      return;
    }
    setDelivering(true);
    try {
      const payload = JSON.stringify({ taskId: activeTask?._id, event: "generation.completed" });
      const signature = await signWebhookPayload(webhookSecret, payload);
      const res =
        mode === "text" && textTaskId
          ? await deliverText({ taskId: textTaskId, event: "generation.completed", payload, signature })
          : imageTaskId
            ? await deliverImage({ taskId: imageTaskId, event: "generation.completed", payload, signature })
            : null;
      if (!res) throw new Error("No active task");
      toast.success(`Webhook verified — task reconciled (${res.status}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webhook delivery failed");
    } finally {
      setDelivering(false);
    }
  }

  /* ---- workflow stage states ---- */
  const stageState = (key: string): "done" | "active" | "pending" | "failed" => {
    if (!activeTask) return key === "receive" ? "active" : "pending";
    const order = STAGES.map((s) => s.key);
    const idx = order.indexOf(key);
    const terminal =
      activeTask.status === "completed"
        ? 11
        : activeTask.status === "failed" || activeTask.status === "cancelled"
          ? 5
          : activeTask.status === "processing"
            ? 6
            : 5;
    if (idx < terminal) return "done";
    if (idx === terminal) return activeTask.status === "failed" || activeTask.status === "cancelled" ? "failed" : "active";
    return "pending";
  };

  const progress = activeTask ? fmtProgress(activeTask.status, activeTask.createdAt, activeTask.durationMs, now) : 0;

  const history = [
    ...(textTasks ?? []).map((t) => ({
      key: `t-${t._id}`,
      kind: "Text → Video",
      provider: t.provider,
      sub: t.prompt.slice(0, 42),
      status: t.status,
      thumb: null as string | null,
    })),
    ...(imageTasks ?? []).map((t) => ({
      key: `i-${t._id}`,
      kind: "Image → Video",
      provider: t.provider,
      sub: t.imageName,
      status: t.status,
      thumb: t.imageUrl,
    })),
  ].sort((a, b) => (a.key < b.key ? 1 : -1));

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      {/* ── Composer ─────────────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionTitle kicker="STEP 08 · Video module" title="Compose a clip" />
            {/* mode switch */}
            <div className="flex rounded-md border border-border bg-background p-0.5">
              {(
                [
                  { id: "text", label: "Text → Video", icon: Film },
                  { id: "image", label: "Image → Video", icon: ImageGlyph },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                    mode === m.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="size-3.5" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {mode === "text" ? (
            <>
              <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Motion prompt
              </p>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the scene, camera move, and duration…"
                rows={4}
                className="mt-2 resize-none border-border bg-background text-[13px]"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {TEXT_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setPrompt(ex)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Sparkles className="size-2.5" />
                      {ex.slice(0, 32)}…
                    </button>
                  ))}
                </div>
                <p className={cn("text-[11px]", textValidation.ok ? "text-chart-2" : "text-destructive")}>
                  {textValidation.ok ? "Motion prompt looks good" : (textValidation.reason ?? "…")}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* upload zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                className={cn(
                  "mt-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
                  dragging ? "border-chart-1 bg-chart-1/5" : "border-border bg-background hover:border-foreground/30",
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
                <span className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-chart-1">
                  <Upload className="size-5" />
                </span>
                <p className="text-[13px] font-medium text-foreground">
                  {upload ? "Replace still" : "Drop a still image, or click to browse"}
                </p>
                <p className="text-[11px] text-muted-foreground">PNG · JPEG · WEBP — auto-downscaled to 512px · ≤ 12 MB</p>
                {upload && (
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-chart-2/40 bg-chart-2/10 px-2.5 py-0.5 text-[11px] text-chart-2">
                    <Check className="size-3" />
                    {upload.name} · {upload.width}×{upload.height}
                  </p>
                )}
              </div>

              {upload && (
                <div className="mt-4 flex items-center gap-3 rounded-md border border-border/70 bg-background p-3">
                  <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-card">
                    <img src={upload.dataUrl} alt={upload.name} className="size-full object-cover" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Vision caption</p>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-foreground/85">{caption}</p>
                  </div>
                </div>
              )}

              <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Motion prompt
              </p>
              <Textarea
                value={motionPrompt}
                onChange={(e) => setMotionPrompt(e.target.value)}
                placeholder="Describe the motion you want applied to the still…"
                rows={3}
                className="mt-2 resize-none border-border bg-background text-[13px]"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {IMAGE_MOTION_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setMotionPrompt(ex)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Sparkles className="size-2.5" />
                      {ex.slice(0, 32)}…
                    </button>
                  ))}
                </div>
                <p className={cn("text-[11px]", motionValidation.ok ? "text-chart-2" : "text-destructive")}>
                  {motionValidation.ok ? "Motion prompt looks good" : (motionValidation.reason ?? "…")}
                </p>
              </div>
            </>
          )}

          {/* live pipeline previews */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background p-3.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Provider router</p>
              <p className="mt-1.5 text-[12.5px] font-medium text-foreground">
                {routed
                  ? `${sdkProviderById(routed.provider)?.label ?? routed.provider} · ${routed.model}`
                  : "type a prompt to route"}
              </p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {routed ? PROVIDER_META[routed.provider] : "keyword + preference based"}
              </p>
            </div>
            <div className="rounded-md border border-border/70 bg-background p-3.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Optimized motion</p>
              <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-5 text-muted-foreground">
                {mode === "text"
                  ? (textOptimized ?? "the optimizer rewrites your motion per provider")
                  : (imageOptimized ?? "caption + motion are combined and tuned per provider")}
              </p>
            </div>
          </div>

          {/* provider preference */}
          <div className="mt-5">
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Provider preference</Label>
            <Select value={preferred} onValueChange={setPreferred}>
              <SelectTrigger className="mt-2 border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (router decides)</SelectItem>
                {VIDEO_PROVIDER_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {sdkProviderById(id)?.label} · {PROVIDER_META[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
            <p className="text-[12px] text-muted-foreground">
              Output: <span className="font-mono text-foreground">MP4 · 24 fps</span> + poster frame ·{" "}
              {mode === "text" ? "1 clip" : "1 still → clip"}
            </p>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit} className="group gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
              {mode === "text" ? "Submit clip" : upload ? "Animate still" : "Upload first"}
            </Button>
          </div>
          {mode === "image" && upload && !imageValidation.ok && (
            <p className="mt-3 text-[12px] text-destructive">{imageValidation.reason}</p>
          )}
        </div>

        {/* history */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="History" title="Recent clips" />
          <div className="mt-4 divide-y divide-border/70">
            {!history.length && (
              <p className="py-6 text-center text-[12px] text-muted-foreground">
                No video tasks yet — compose a clip above.
              </p>
            )}
            {history.map((h) => (
              <div key={h.key} className="flex items-center gap-3 py-3">
                {h.thumb ? (
                  <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
                    <img src={h.thumb} alt={h.sub} className="size-full object-cover" />
                  </span>
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded border border-border bg-background text-chart-1">
                    <Film className="size-3.5" />
                  </span>
                )}
                <p className="min-w-0 flex-1 truncate text-[12.5px]">
                  <span className="font-medium">{sdkProviderById(h.provider)?.label ?? h.provider}</span>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{h.sub}…</span>
                </p>
                <span className="hidden rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground sm:inline">
                  {h.kind}
                </span>
                <VideoBadge status={h.status} />
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
            right={activeTask ? <VideoBadge status={activeTask.status} /> : undefined}
          />

          {activeTask && (activeTask.status === "queued" || activeTask.status === "processing") && (
            <div className="mt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
                <div className="h-full rounded-full bg-chart-1 transition-all duration-700" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Play className="size-3 text-chart-4" />
                  {activeTask.status === "processing"
                    ? `streaming · frame ${activeTask.framesRendered}/${activeTask.totalFrames}`
                    : "waiting in queue"}
                </span>
                <span>{activeTask.status === "processing" ? `${progress}%` : "0%"}</span>
              </p>
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
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* live task */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Live task" title="Submission" />
          {!activeTask ? (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
              {mode === "text"
                ? "Submit a motion prompt to watch it travel the 11-stage pipeline."
                : "Upload a still and describe the motion to watch the clip render."}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                {"imageUrl" in activeTask ? (
                  <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                    <img src={activeTask.imageUrl} alt={activeTask.imageName} className="size-full object-cover" />
                  </span>
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-background text-chart-1">
                    <Film className="size-5" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{activeTask._id}</p>
                  <p className="mt-0.5 text-[12px] text-foreground">
                    {activeTask.seconds}s · {activeTask.fps} fps · {activeTask.totalFrames} frames
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Optimized motion</p>
                <p className="mt-1.5 text-[11.5px] leading-5 text-foreground/85">{activeTask.optimizedPrompt}</p>
              </div>
              {activeTask.status === "failed" && <p className="text-[12px] text-destructive">{activeTask.error ?? "Task failed."}</p>}

              {activeTask.status === "completed" && (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Artifacts</p>
                  {[
                    { fmt: "Clip · MP4", icon: FileVideo, url: activeTask.outputUrl },
                    { fmt: "Poster", icon: Eye, url: activeTask.previewUrl },
                  ].map(({ fmt, icon: Icon, url }) => (
                    <div key={fmt} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-foreground">
                        <Icon className="size-3.5 text-chart-1" />
                        {fmt}
                      </span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{url}</span>
                    </div>
                  ))}
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-chart-2">
                    <CloudDownload className="size-3" />
                    Render complete — retained 30 days in the video bucket.
                  </p>
                </div>
              )}

              {(activeTask.status === "queued" || activeTask.status === "processing") && (
                <Button variant="outline" onClick={() => void handleCancel()} className="w-full border-border bg-background text-destructive hover:bg-destructive/5">
                  <X className="size-3.5" /> Cancel render
                </Button>
              )}
              {activeTask.status === "failed" && (
                <Button onClick={() => void handleRetry()} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                  <RefreshCw className="size-3.5" /> Retry task ({activeTask.attempts}/3)
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
                {webhookSecret ? "Secret ready — shown once." : "Generate the provider signing secret."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void handleGenerateSecret()} className="shrink-0 border-border bg-background">
                <WebhookIcon className="size-3.5" />
                {webhookSecret ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {webhookSecret && <p className="rounded-md border border-chart-1/30 bg-chart-1/5 px-3 py-2 font-mono text-[11px] text-chart-1">{webhookSecret}</p>}
            <Button
              onClick={() => void handleDeliverWebhook()}
              disabled={!activeTask || !webhookSecret || delivering}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {delivering ? <Loader2 className="size-4 animate-spin" /> : <WebhookIcon className="size-3.5" />}
              Deliver generation.completed
            </Button>
            <p className="text-[11px] leading-5 text-muted-foreground">
              HMAC-SHA256 signature verified server-side — same path as{" "}
              <span className="font-mono text-foreground/80">
                {mode === "text" ? "POST /v1/webhooks/textVideo/:taskId" : "POST /v1/webhooks/imageVideo/:taskId"}
              </span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
