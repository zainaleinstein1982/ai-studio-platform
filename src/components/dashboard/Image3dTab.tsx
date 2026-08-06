import { api } from "@/convex/_generated/api";
import { TEXT3D_PROVIDER_IDS, validateImage, visionCaption, removeBackground, enhanceImage, optimizeImagePrompt, routeImageProvider, type UploadedImage } from "@/convex/threeD/imagePipeline";
import { sdkProviderById } from "@/convex/providers/sdk";
import { signWebhookPayload } from "@/convex/providers/sdk";
import { useMutation, useQuery } from "convex/react";
import {
  Box,
  Check,
  CloudDownload,
  Database,
  Eye,
  File,
  FileArchive,
  FileCode2,
  Image as ImageGlyph,
  Loader2,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
  Wand2,
  Webhook as WebhookIcon,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "./bits";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { Id } from "@/convex/_generated/dataModel";

/* The 10 workflow stages from the STEP 07 spec. */
const STAGES = [
  { key: "upload", label: "Upload image", desc: "downscaled + analysed" },
  { key: "bg", label: "Background removal", desc: "subject cutout" },
  { key: "enhance", label: "Image enhancement", desc: "contrast · saturation · sharpness" },
  { key: "caption", label: "Vision caption", desc: "describe the subject" },
  { key: "optimize", label: "Prompt optimization", desc: "provider-tuned rewrite" },
  { key: "generate", label: "Generate 3D", desc: "meshy · tripo · hunyuan3d" },
  { key: "preview", label: "Preview", desc: "render thumbnail" },
  { key: "storage", label: "Storage", desc: "artifacts in the asset bucket" },
  { key: "download", label: "Download", desc: "GLB · FBX · OBJ" },
  { key: "webhook", label: "Webhook", desc: "signed delivery" },
];

const PROVIDER_META: Record<string, string> = {
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

function StatusBadge({ status }: { status: string }) {
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
  if (status === "processing") return Math.min(96, Math.round(((now - createdAt - 500) / durationMs) * 96));
  return 0;
}

/* ------------------------------------------------------------------ */
/* Browser image helpers (display + client-side stats)                 */
/* ------------------------------------------------------------------ */

const MAX_FILE_BYTES = 12 * 1024 * 1024;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode that image"));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function sampleStats(canvas: HTMLCanvasElement): { avgColor: string; brightness: number } {
  const px = document.createElement("canvas");
  px.width = 1;
  px.height = 1;
  const pctx = px.getContext("2d");
  if (!pctx) return { avgColor: "#808080", brightness: 0.5 };
  pctx.drawImage(canvas, 0, 0, 1, 1);
  const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
  return {
    avgColor: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
    brightness: (0.299 * r + 0.587 * g + 0.114 * b) / 255,
  };
}

async function downscaleImage(img: HTMLImageElement, maxDim = 512) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, width, height, ...sampleStats(canvas) };
}

/** Display-only simulation of background removal: checkerboard + radial mask. */
function bgRemovedUrl(img: HTMLImageElement, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const cell = Math.max(4, Math.floor(Math.min(w, h) / 10));
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#e7e2d8" : "#d4cec1";
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.drawImage(img, 0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return canvas.toDataURL("image/png");
}

/** Display-only simulation of enhancement: contrast + saturation boost. */
function enhancedUrl(img: HTMLImageElement, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.filter = "contrast(1.14) saturate(1.22)";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/* ------------------------------------------------------------------ */

export function Image3dTab() {
  const tasks = useQuery(api.imageTo3d.list, { limit: 10 });
  const create = useMutation(api.imageTo3d.create);
  const retryTask = useMutation(api.imageTo3d.retry);
  const cancelTask = useMutation(api.imageTo3d.cancel);
  const generateSecret = useMutation(api.sdk.generateWebhookSecret);
  const deliverWebhook = useMutation(api.imageTo3d.deliverWebhook);

  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [enhUrl, setEnhUrl] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<string>("auto");
  const [taskId, setTaskId] = useState<Id<"image3dTasks"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const task = useQuery(api.imageTo3d.get, taskId ? { taskId } : "skip");
  const now = useNow(1000);

  /* ---- live CV stage previews (pure pipeline functions) ---- */
  const validation = validateImage(upload ?? undefined);
  const caption = upload ? visionCaption(upload) : null;
  const bg = upload ? removeBackground(upload) : null;
  const enh = upload ? enhanceImage(upload) : null;
  const routed = caption ? routeImageProvider({ caption, preferredProvider: preferred === "auto" ? undefined : preferred }) : null;
  const optimized = caption && routed ? optimizeImagePrompt(caption, routed.provider) : null;

  const canSubmit = validation.ok && !submitting;

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
      const uploadState: UploadedImage = {
        name: file.name,
        dataUrl: down.dataUrl,
        width: down.width,
        height: down.height,
        avgColor: down.avgColor,
        brightness: down.brightness,
      };
      setUpload(uploadState);
      setBgUrl(bgRemovedUrl(img, down.width, down.height));
      setEnhUrl(enhancedUrl(img, down.width, down.height));
      toast.success(`Image ready — ${down.width}×${down.height} · ${Math.round((down.dataUrl.length * 0.75) / 1024)} KB`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the image");
    }
  }, []);

  async function handleSubmit() {
    if (!upload || !validation.ok) return;
    setSubmitting(true);
    try {
      const res = await create({
        imageName: upload.name,
        imageUrl: upload.dataUrl,
        width: upload.width,
        height: upload.height,
        avgColor: upload.avgColor,
        brightness: upload.brightness,
        preferredProvider: preferred === "auto" ? undefined : preferred,
      });
      setTaskId(res.taskId);
      toast.success(`Task queued via ${sdkProviderById(res.provider)?.label ?? res.provider} · ${res.model}`);
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
      const res = await deliverWebhook({ taskId, event: "generation.completed", payload, signature });
      toast.success(`Webhook verified — task reconciled (${res.status}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Webhook delivery failed");
    } finally {
      setDelivering(false);
    }
  }

  /* ---- workflow stage states ---- */
  const stageState = (key: string): "done" | "active" | "pending" | "failed" => {
    if (!task) return key === "upload" ? "active" : "pending";
    const order = STAGES.map((s) => s.key);
    const idx = order.indexOf(key);
    const terminal =
      task.status === "completed"
        ? 10
        : task.status === "failed" || task.status === "cancelled"
          ? 5
          : task.status === "processing"
            ? 6
            : 5;
    if (idx < terminal) return "done";
    if (idx === terminal) return task.status === "failed" || task.status === "cancelled" ? "failed" : "active";
    return "pending";
  };

  const progress = task ? fmtProgress(task.status, task.createdAt, task.durationMs, now) : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      {/* ── Composer ─────────────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Image → 3D module" title="Upload a reference" />

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
              "mt-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
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
              {upload ? "Replace image" : "Drop an image, or click to browse"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              PNG · JPEG · WEBP — auto-downscaled to 512px · ≤ 12 MB
            </p>
            {upload && (
              <p className="inline-flex items-center gap-1.5 rounded-full border border-chart-2/40 bg-chart-2/10 px-2.5 py-0.5 text-[11px] text-chart-2">
                <Check className="size-3" />
                {upload.name} · {upload.width}×{upload.height}
              </p>
            )}
          </div>

          {/* CV stage previews */}
          {upload && (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Original", src: upload.dataUrl, icon: ImageGlyph },
                { label: "Background removed", src: bgUrl, icon: Scissors },
                { label: "Enhanced", src: enhUrl, icon: Wand2 },
              ].map(({ label, src, icon: Icon }) => (
                <div key={label} className="overflow-hidden rounded-md border border-border/70 bg-background">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      <Icon className="size-3 text-chart-1" />
                      {label}
                    </span>
                  </div>
                  <div className="flex h-32 items-center justify-center bg-[repeating-conic-gradient(#f4f1ea_0%_25%,#ece7dc_0%_50%)] bg-[length:16px_16px] p-2">
                    {src ? (
                      <img src={src} alt={label} className="max-h-full max-w-full rounded-sm object-contain" />
                    ) : (
                      <p className="text-[10.5px] text-muted-foreground">processing…</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* stage metadata */}
          {upload && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-background p-3.5">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Background removal</p>
                <p className="mt-1.5 text-[12px] text-foreground/90">
                  {bg?.maskType === "alpha" ? "Alpha cutout" : bg?.maskType === "soft-edge" ? "Soft-edge matte" : "Chroma key"}
                  {" · "}
                  {bg?.keptPct}% subject kept
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{bg?.artifactUrl}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background p-3.5">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Enhancement</p>
                <p className="mt-1.5 text-[12px] text-foreground/90">
                  contrast ×{enh?.contrast.toFixed(2)} · saturation ×{enh?.saturation.toFixed(2)}
                </p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">sharpness {enh?.sharpness} · unsharp mask</p>
              </div>
            </div>
          )}

          {/* caption · router · optimized prompt */}
          {upload && caption && routed && optimized && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-chart-1/25 bg-chart-1/5 p-3.5">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-chart-1">
                  <Sparkles className="size-3" />
                  Vision caption
                </p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-foreground/90">{caption}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-background p-3.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Provider router</p>
                  <p className="mt-1.5 text-[12.5px] font-medium text-foreground">
                    {sdkProviderById(routed.provider)?.label} · {routed.model}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">{PROVIDER_META[routed.provider]}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background p-3.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Optimized prompt</p>
                  <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-5 text-muted-foreground">{optimized}</p>
                </div>
              </div>
            </div>
          )}

          {/* provider preference */}
          <div className="mt-5">
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Provider preference</Label>
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

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
            <p className="text-[12px] text-muted-foreground">
              Exports: <span className="font-mono text-foreground">GLB · FBX · OBJ</span> + preview render
            </p>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit} className="group gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />}
              {upload ? "Generate 3D" : "Upload first"}
            </Button>
          </div>
          {!validation.ok && upload && (
            <p className="mt-3 text-[12px] text-destructive">{validation.reason}</p>
          )}
        </div>

        {/* history */}
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="History" title="Recent image tasks" />
          <div className="mt-4 divide-y divide-border/70">
            {!tasks?.length && (
              <p className="py-6 text-center text-[12px] text-muted-foreground">
                No image-to-3D tasks yet — upload a reference above.
              </p>
            )}
            {(tasks ?? []).map((t) => (
              <div key={t._id} className="flex items-center gap-3 py-3">
                <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
                  <img src={t.imageUrl} alt={t.imageName} className="size-full object-cover" />
                </span>
                <p className="min-w-0 flex-1 truncate text-[12.5px]">
                  <span className="font-medium">{sdkProviderById(t.provider)?.label ?? t.provider}</span>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{t.imageName}</span>
                </p>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Workflow + task ──────────────────────────────────── */}
      <div className="space-y-6 xl:col-span-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Workflow" title="Pipeline" right={task ? <StatusBadge status={task.status} /> : undefined} />

          {task && (task.status === "queued" || task.status === "processing") && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full bg-chart-1 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="mt-6 space-y-1">
            {STAGES.map((s, i) => {
              const state = stageState(s.key);
              return (
                <div key={s.key} className="relative flex items-start gap-3">
                  {i < STAGES.length - 1 && (
                    <span aria-hidden className={cn("absolute left-[9px] top-6 h-[calc(100%-4px)] w-px", state === "done" ? "bg-chart-2/60" : "bg-border")} />
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
          {!task ? (
            <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
              Upload an image and hit Generate to watch it travel the 10-stage pipeline.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                  <img src={task.imageUrl} alt={task.imageName} className="size-full object-cover" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{task._id}</p>
                  <p className="mt-0.5 text-[12px] text-foreground">{task.imageName} · {task.width}×{task.height}</p>
                </div>
              </div>
              <div className="rounded-md border border-chart-1/25 bg-chart-1/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-chart-1">Vision caption</p>
                <p className="mt-1.5 text-[11.5px] leading-5 text-foreground/85">{task.caption}</p>
              </div>
              {task.status === "failed" && <p className="text-[12px] text-destructive">{task.error ?? "Task failed."}</p>}

              {task.status === "completed" && (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Exports</p>
                  {[
                    { fmt: "GLB", icon: FileCode2, url: task.glbUrl },
                    { fmt: "FBX", icon: FileArchive, url: task.fbxUrl },
                    { fmt: "OBJ", icon: File, url: task.objUrl },
                    { fmt: "Preview", icon: Eye, url: task.previewUrl },
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
                    <Database className="size-3" />
                    Stored in the image3D bucket — retained 30 days.
                  </p>
                </div>
              )}

              {(task.status === "queued" || task.status === "processing") && (
                <Button variant="outline" onClick={() => void handleCancel()} className="w-full border-border bg-background text-destructive hover:bg-destructive/5">
                  <X className="size-3.5" /> Cancel task
                </Button>
              )}
              {task.status === "failed" && (
                <Button onClick={() => void handleRetry()} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
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
                {webhookSecret ? "Secret ready — shown once." : "Generate the provider signing secret."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void handleGenerateSecret()} className="shrink-0 border-border bg-background">
                <WebhookIcon className="size-3.5" />
                {webhookSecret ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {webhookSecret && <p className="rounded-md border border-chart-1/30 bg-chart-1/5 px-3 py-2 font-mono text-[11px] text-chart-1">{webhookSecret}</p>}
            <Button onClick={() => void handleDeliverWebhook()} disabled={!taskId || !webhookSecret || delivering} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {delivering ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-3.5" />}
              Deliver generation.completed
            </Button>
            <p className="text-[11px] leading-5 text-muted-foreground">
              HMAC-SHA256 signature verified server-side — same path as{" "}
              <span className="font-mono text-foreground/80">POST /v1/webhooks/image3d/:taskId</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
