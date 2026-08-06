import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CircleDot,
  Clock,
  Cpu,
  Flame,
  ListOrdered,
  Loader2,
  Plus,
  RefreshCw,
  Skull,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SectionTitle, StatCard, fmtShortTime } from "./bits";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { QueuePriority } from "@/convex/queue/core";

const QUEUE_OPTIONS = [
  { id: "gateway", label: "Gateway" },
  { id: "text3d", label: "Text → 3D" },
  { id: "image3d", label: "Image → 3D" },
  { id: "video", label: "Video" },
  { id: "sdk", label: "SDK" },
  { id: "storage", label: "Storage" },
];

const PRIORITY_CFG: Record<QueuePriority, { label: string; cls: string }> = {
  high: { label: "High", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  normal: { label: "Normal", cls: "border-border bg-muted text-muted-foreground" },
  low: { label: "Low", cls: "border-chart-3/40 bg-chart-3/10 text-chart-3" },
};

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  queued: { label: "Queued", cls: "border-chart-5/50 bg-chart-5/10 text-chart-5", dot: "bg-chart-5", pulse: true },
  processing: { label: "Processing", cls: "border-chart-4/50 bg-chart-4/10 text-chart-4", dot: "bg-chart-4", pulse: true },
  completed: { label: "Completed", cls: "border-chart-2/50 bg-chart-2/10 text-chart-2", dot: "bg-chart-2" },
  failed: { label: "Failed · retrying", cls: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  dead: { label: "Dead letter", cls: "border-foreground/25 bg-foreground/5 text-foreground/75", dot: "bg-foreground/60" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.queued;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", cfg.cls)}>
      <span className={cn("size-1.5 rounded-full", cfg.dot, cfg.pulse && "animate-pulse")} />
      {cfg.label}
    </span>
  );
}

const PAYLOAD_IDEAS = [
  "render a coastal road dolly at dusk, 8s",
  "reconstruct a vase from a photo reference",
  "caption this still and optimize the prompt",
  "generate a dreamlike morph of clouds to waves",
  "issue a signed URL for the video bucket",
];

export function QueueTab() {
  const overview = useQuery(api.queue.overview);
  const jobs = useQuery(api.queue.list, { limit: 60 });
  const enqueue = useMutation(api.queue.enqueue);
  const retry = useMutation(api.queue.retry);
  const purgeDead = useMutation(api.queue.purgeDead);

  const [queue, setQueue] = useState("gateway");
  const [priority, setPriority] = useState<QueuePriority>("normal");
  const [delay, setDelay] = useState("0");
  const [payload, setPayload] = useState(PAYLOAD_IDEAS[0]);
  const [forceFailure, setForceFailure] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const now = useNow(1000);

  async function handleEnqueue() {
    if (!payload.trim()) {
      toast.error("Payload is empty.");
      return;
    }
    setEnqueueing(true);
    try {
      await enqueue({
        queue,
        priority,
        payload: payload.trim(),
        delayMs: Number(delay),
        forceFailure,
      });
      toast.success(`Enqueued ${QUEUE_OPTIONS.find((q) => q.id === queue)?.label} job · ${priority} priority.`);
      if (forceFailure) {
        toast.info("force_failure=true — this job will fail into the dead letter queue.");
      }
      if (Number(delay) > 0) setPayload(PAYLOAD_IDEAS[(PAYLOAD_IDEAS.indexOf(payload) + 1) % PAYLOAD_IDEAS.length]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enqueue failed");
    } finally {
      setEnqueueing(false);
    }
  }

  if (!overview) {
    return (
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[118px] animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  const s = overview.stats;
  const dead = (jobs ?? []).filter((j) => j.status === "dead");

  return (
    <div className="space-y-6">
      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending" value={s.queued + s.failed} sub={`${s.delayed} delayed (future due)`} accent />
        <StatCard label="In flight" value={s.processing} sub={`${overview.config.concurrency} worker slots`} />
        <StatCard label="Completed" value={s.completed.toLocaleString()} sub={s.successRate != null ? `${s.successRate}% success rate` : "no settled jobs yet"} />
        <StatCard label="Dead letter" value={s.dead} sub={s.avgWaitMs != null ? `avg wait ${(s.avgWaitMs / 1000).toFixed(1)}s` : "no backlog data"} />
      </div>

      {/* workers */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Celery-style workers"
          title="Worker pool"
          right={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-chart-2/40 bg-chart-2/10 px-2.5 py-1 text-[11px] text-chart-2">
              <Cpu className="size-3" /> Redis backend · {overview.config.concurrency} slots
            </span>
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview.workers.map((w) => (
            <div
              key={w.id}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                w.busy ? "border-chart-4/40 bg-chart-4/5" : "border-border/70 bg-background",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border",
                  w.busy ? "border-chart-4/50 bg-chart-4/10 text-chart-4" : "border-border bg-muted text-muted-foreground",
                )}
              >
                {w.busy ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDot className="size-3.5" />}
              </span>
              <div>
                <p className="font-mono text-[12px] font-medium text-foreground">worker-{w.id}</p>
                <p className={cn("text-[10.5px]", w.busy ? "text-chart-4" : "text-muted-foreground")}>
                  {w.busy ? "processing…" : "idle"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11.5px] leading-5 text-muted-foreground">
          The scheduler tick claims due jobs up to the free slots — strict priority first
          (high → normal → low), FIFO within a priority. Failed jobs wait out an exponential
          backoff (1.2s → 2.4s → 4.8s…) before being reclaimed.
        </p>
      </div>

      {/* enqueue */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle kicker="Produce" title="Enqueue a job" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Queue</Label>
            <Select value={queue} onValueChange={setQueue}>
              <SelectTrigger className="mt-1.5 border-border bg-background text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUEUE_OPTIONS.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as QueuePriority)}>
              <SelectTrigger className="mt-1.5 border-border bg-background text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Delay (ms)</Label>
            <Select value={delay} onValueChange={setDelay}>
              <SelectTrigger className="mt-1.5 border-border bg-background text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None</SelectItem>
                <SelectItem value="3000">3 seconds</SelectItem>
                <SelectItem value="10000">10 seconds</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex cursor-pointer items-center gap-2.5">
              <Switch checked={forceFailure} onCheckedChange={setForceFailure} />
              <span className="text-[12px] text-muted-foreground">
                <Flame className="mr-1 inline size-3 text-destructive" />
                force_failure (→ DLQ)
              </span>
            </label>
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Payload</Label>
          <Input
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1.5 border-border bg-background text-[12.5px]"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PAYLOAD_IDEAS.map((p) => (
              <button
                key={p}
                onClick={() => setPayload(p)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ListOrdered className="size-2.5" />
                {p.slice(0, 30)}…
              </button>
            ))}
          </div>
          <Button onClick={() => void handleEnqueue()} disabled={enqueueing} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {enqueueing ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Enqueue job
          </Button>
        </div>
      </div>

      {/* jobs */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle kicker="Ledger" title="Jobs" />
        <div className="mt-4 divide-y divide-border/70">
          {!jobs?.length && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              No jobs yet — enqueue one above to watch the scheduler drain it.
            </p>
          )}
          {(jobs ?? []).map((j) => {
            const pri = PRIORITY_CFG[j.priority as QueuePriority] ?? PRIORITY_CFG.normal;
            return (
              <div key={j._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="w-28 shrink-0">
                  <p className="text-[12px] font-medium text-foreground">
                    {QUEUE_OPTIONS.find((q) => q.id === j.queue)?.label ?? j.queue}
                  </p>
                  <p className="mt-0.5 font-mono text-[9.5px] text-muted-foreground">{fmtShortTime(j.createdAt)}</p>
                </div>
                <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-medium", pri.cls)}>{pri.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11.5px] text-foreground/85">{j.payload}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    attempt {j.attempts}/{j.maxAttempts}
                    {j.dueAt > now && j.status !== "completed" && j.status !== "dead" ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-chart-5">
                        <Clock className="size-2.5" /> due in {Math.max(0, Math.round(j.dueAt - now) / 1000)}s
                      </span>
                    ) : null}
                    {j.lastError ? <span className="ml-2 text-destructive">· {j.lastError}</span> : null}
                  </p>
                </div>
                <StatusBadge status={j.status} />
                {(j.status === "dead" || j.status === "failed") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void retry({ jobId: j._id })
                        .then(() => toast.success("Job requeued."))
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Requeue failed"))
                    }
                    className="border-border bg-background"
                  >
                    <RefreshCw className="size-3" /> Requeue
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* DLQ */}
      <div className="rounded-lg border border-destructive/25 bg-card p-6">
        <SectionTitle
          kicker="Dead letter queue"
          title={`${dead.length} dead job${dead.length === 1 ? "" : "s"}`}
          right={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const j of dead) {
                    void retry({ jobId: j._id }).catch(() => {});
                  }
                  if (dead.length > 0) toast.success(`Requeued ${dead.length} dead job${dead.length === 1 ? "" : "s"}.`);
                }}
                disabled={dead.length === 0}
                className="border-border bg-background"
              >
                <ArrowDownToLine className="size-3.5" /> Requeue all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void purgeDead()
                    .then((res) => toast.success(`Purged ${res.purged} dead job${res.purged === 1 ? "" : "s"}.`))
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Purge failed"))
                }
                disabled={dead.length === 0}
                className="border-border bg-background text-muted-foreground"
              >
                <Skull className="size-3.5" /> Purge
              </Button>
            </div>
          }
        />
        {dead.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
            Nothing in the dead letter queue — enqueue a job with force_failure to watch it retry (1.2s → 2.4s) and land here after 3 attempts.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border/70">
            {dead.map((j) => (
              <div key={j._id} className="flex flex-wrap items-center gap-3 py-3">
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11.5px] text-foreground/85">{j.payload}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {j.queue} · {j.attempts}/{j.maxAttempts} attempts · {j.lastError ?? "max retries exceeded"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void retry({ jobId: j._id })
                      .then(() => toast.success("Dead letter requeued."))
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Requeue failed"))
                  }
                  className="border-border bg-background"
                >
                  <RefreshCw className="size-3" /> Requeue
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Timer className="size-3" />
          maxAttempts = {overview.config.maxAttempts} · backoff {overview.config.baseBackoffMs}ms base, exponential, capped at{" "}
          {overview.config.maxBackoffMs / 1000}s — equivalent to a Celery task that has exhausted its retry policy.
        </p>
      </div>
    </div>
  );
}
