import { Button } from "@/components/ui/button";
import { KIND_META, PROVIDER_LABEL, type GatewayKind, type RequestStatus } from "@/convex/catalog";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

export type GatewayRequest = Doc<"gatewayRequests">;

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

export function fmtTime(ts?: number): string {
  return ts ? format(ts, "MMM d · HH:mm:ss") : "—";
}

export function fmtShortTime(ts?: number): string {
  return ts ? format(ts, "MMM d, HH:mm") : "—";
}

export function fmtMs(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

export function kindLabel(kind: GatewayKind): string {
  return KIND_META[kind].label;
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

const STATUS_CFG: Record<
  RequestStatus,
  { label: string; cls: string; dot: string; pulse: boolean }
> = {
  queued: {
    label: "Queued",
    cls: "border-chart-5/50 bg-chart-5/10 text-chart-5",
    dot: "bg-chart-5",
    pulse: true,
  },
  processing: {
    label: "Processing",
    cls: "border-chart-4/50 bg-chart-4/10 text-chart-4",
    dot: "bg-chart-4",
    pulse: true,
  },
  completed: {
    label: "Completed",
    cls: "border-chart-2/50 bg-chart-2/10 text-chart-2",
    dot: "bg-chart-2",
    pulse: false,
  },
  failed: {
    label: "Failed",
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    pulse: false,
  },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cfg.cls}`}
    >
      <span className={`size-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? "animate-pulse" : ""}`} />
      {cfg.label}
    </span>
  );
}

export function KindTag({ kind }: { kind: GatewayKind }) {
  return (
    <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground">
      {kindLabel(kind)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card                                                           */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-3 font-display text-3xl font-light tracking-tight ${
          accent ? "text-chart-1" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-8 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-card">
        <span className="font-display text-lg text-muted-foreground">∅</span>
      </div>
      <p className="mt-5 font-display text-xl font-normal tracking-tight">{title}</p>
      <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">{body}</p>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="group mt-6 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {actionLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section heading                                                     */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  kicker,
  title,
  right,
}: {
  kicker: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {kicker}
        </p>
        <h2 className="mt-1.5 font-display text-2xl font-light tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}
