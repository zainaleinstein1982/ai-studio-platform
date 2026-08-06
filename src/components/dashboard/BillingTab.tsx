import { api } from "@/convex/_generated/api";
import { formatDollars } from "@/convex/billing/core";
import { PLANS, type PlanId } from "@/convex/catalog";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  CalendarClock,
  CreditCard,
  Loader2,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionTitle, fmtShortTime, kindLabel, providerLabel } from "./bits";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  plan: { label: "Plan", cls: "border-chart-1/40 bg-chart-1/10 text-chart-1" },
  topup: { label: "Top-up", cls: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  usage: { label: "Usage", cls: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
  adjustment: { label: "Adjustment", cls: "border-border bg-muted text-muted-foreground" },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  pending: { label: "Pending", cls: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
  failed: { label: "Failed", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

export function BillingTab() {
  const view = useQuery(api.billing.overview);
  const purchasePackage = useMutation(api.billing.purchasePackage);
  const setPlan = useMutation(api.billing.setPlan);
  const now = useNow(30_000);

  const [buying, setBuying] = useState<string | null>(null);
  const [switching, setSwitching] = useState<PlanId | null>(null);

  if (!view) {
    return (
      <div className="grid gap-5">
        <div className="h-44 animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  const { balance, plan, perCredit, cycle, usage, invoices, packages, payment } = view;
  const maxProvider = Math.max(1, ...usage.byProvider.map((p) => p.credits));
  const maxKind = Math.max(1, ...usage.byKind.map((k) => k.credits));
  const estValue = formatDollars(balance * perCredit);
  const monthLabel = new Date(cycle.start).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const dayOfCycle = Math.min(cycle.days, Math.max(1, Math.floor((now - cycle.start) / 86_400_000) + 1));
  const renews = new Date(cycle.nextBilling).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  async function handleBuy(packageId: string) {
    setBuying(packageId);
    try {
      const res = await purchasePackage({ packageId });
      toast.success(`Added ${res.credits.toLocaleString()} credits — invoice ${res.number} paid.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Purchase failed.");
    } finally {
      setBuying(null);
    }
  }

  async function handleSwitch(p: PlanId) {
    setSwitching(p);
    try {
      const res = await setPlan({ plan: p });
      if (res.invoiceNumber) {
        toast.success(`Switched to ${PLANS.find((x) => x.id === p)?.name} — ${res.prorationNote} (invoice ${res.invoiceNumber}).`);
      } else {
        toast.success(res.prorationNote);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch plan.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── balance hero ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_220px_at_85%_-20%,oklch(0.87_0.05_75/0.5),transparent_65%)]"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Credit balance · {plan.name} plan
            </p>
            <p className="mt-3 font-display text-5xl font-light tracking-tight text-chart-1">
              {balance.toLocaleString()}
              <span className="ml-2 text-lg text-muted-foreground">credits</span>
            </p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              ≈ {estValue} at {formatDollars(perCredit)}/credit
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
              <Zap className="size-3 text-chart-1" />
              {plan.price}/mo allowance
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
              <CreditCard className="size-3" />
              {payment.card}
            </span>
          </div>
        </div>

        {/* billing cycle meter */}
        <div className="relative mt-6">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-muted-foreground">
              {monthLabel} · day {dayOfCycle} of {cycle.days}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="size-3.5" />
              renews {renews}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
            <div
              className="h-full rounded-full bg-chart-1/80 transition-all duration-700"
              style={{ width: `${Math.max(2, cycle.progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── credit packages ──────────────────────────────────── */}
      <div>
        <SectionTitle kicker="Top-up" title="Buy credits" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {packages.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-all hover:border-foreground/25"
            >
              <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {p.note}
              </p>
              <p className="mt-2 font-display text-3xl font-light tracking-tight text-foreground">
                {p.credits.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">credits</p>
              <div className="mt-4 flex items-end justify-between gap-2">
                <p className="font-display text-2xl font-light tracking-tight text-chart-1">{p.price}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={buying === p.id}
                  onClick={() => void handleBuy(p.id)}
                  className="border-border bg-background"
                >
                  {buying === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Buy
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── plans ────────────────────────────────────────────── */}
      <div>
        <SectionTitle kicker="Plans" title="Choose your allowance" />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const current = p.id === plan.id;
            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col rounded-lg border bg-card p-6 transition-all",
                  current
                    ? "border-chart-1/50 shadow-[0_0_0_1px_oklch(0.885_0.011_85),0_8px_24px_-18px_oklch(0.585_0.075_55/0.5)]"
                    : "border-border hover:border-foreground/25",
                )}
              >
                {current && (
                  <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-chart-1/40 bg-chart-1/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-chart-1">
                    <BadgeCheck className="size-3" /> Current
                  </span>
                )}
                <p className="font-display text-xl font-normal tracking-tight">{p.name}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">{p.tagline}</p>
                <p className="mt-4 font-display text-3xl font-light tracking-tight">
                  {p.price}
                  <span className="ml-1 text-sm text-muted-foreground">/mo</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                      <span className="mt-1 size-1 shrink-0 rounded-full bg-chart-2" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={current ? "outline" : "default"}
                  disabled={current || switching === p.id}
                  onClick={() => void handleSwitch(p.id)}
                  className={cn(
                    "mt-6 w-full",
                    current
                      ? "border-border bg-background text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {switching === p.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : current ? (
                    "Your plan"
                  ) : (
                    `Switch to ${p.name}`
                  )}
                </Button>
                {!current && (
                  <p className="mt-2.5 text-center text-[10.5px] leading-4 text-muted-foreground">
                    Prorated to {renews} — you pay only for the days left in {monthLabel}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── usage metering ───────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Metered · this cycle"
            title="Spend by provider"
            right={
              <span className="font-mono text-[11px] text-muted-foreground">
                ≈ {formatDollars(usage.cost)} · {usage.count} calls
              </span>
            }
          />
          {usage.byProvider.length === 0 ? (
            <p className="mt-5 text-[12.5px] text-muted-foreground">
              No completed calls this cycle — metering starts with your first request.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {usage.byProvider.map((p) => (
                <div key={p.provider}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium capitalize text-foreground">{providerLabel(p.provider)}</span>
                    <span className="font-mono text-muted-foreground">{p.credits} cr</span>
                  </div>
                  <Progress
                    value={(p.credits / maxProvider) * 100}
                    className="mt-2 h-1.5 bg-muted [&>div]:bg-chart-1"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle
            kicker="Metered · this cycle"
            title="Spend by route"
            right={
              <span className="font-mono text-[11px] text-muted-foreground">
                {usage.creditsUsed.toLocaleString()} cr
              </span>
            }
          />
          {usage.byKind.length === 0 ? (
            <p className="mt-5 text-[12.5px] text-muted-foreground">
              Route-level metering appears once requests complete this cycle.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {usage.byKind.map((k) => (
                <div key={k.kind}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-foreground">{kindLabel(k.kind)}</span>
                    <span className="font-mono text-muted-foreground">
                      {k.credits} cr · {k.count}×
                    </span>
                  </div>
                  <Progress
                    value={(k.credits / maxKind) * 100}
                    className="mt-2 h-1.5 bg-muted [&>div]:bg-chart-4"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── payment method ───────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle kicker="Payment method" title="On file" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-md border border-border bg-background">
              <CreditCard className="size-5 text-chart-1" />
            </span>
            <div>
              <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                Visa {payment.card}
                <span className="rounded-full border border-chart-2/40 bg-chart-2/10 px-2 py-0.5 text-[10px] font-medium text-chart-2">
                  Primary
                </span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Expires {payment.exp} · {payment.note}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-chart-2" />
            {payment.provider.toUpperCase()} ready
          </span>
        </div>
      </div>

      {/* ── invoices ─────────────────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="Ledger"
          title="Invoices"
          right={
            <span className="font-mono text-[11px] text-muted-foreground">
              {invoices.length} record{invoices.length === 1 ? "" : "s"}
            </span>
          }
        />
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {invoices.length === 0 ? (
            <p className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              No invoices yet — buying credits or switching plans creates the first entry.
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {invoices.map((inv) => {
                const kindCfg = KIND_BADGE[inv.kind] ?? KIND_BADGE.adjustment;
                const statusCfg = STATUS_BADGE[inv.status] ?? STATUS_BADGE.paid;
                return (
                  <div
                    key={inv.number}
                    className="grid gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-card-foreground/[0.02] sm:grid-cols-[130px_auto_1fr_auto] sm:items-center"
                  >
                    <p className="font-mono text-[11.5px] text-chart-1">{inv.number}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", kindCfg.cls)}>
                        {kindCfg.label}
                      </span>
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", statusCfg.cls)}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] text-foreground">{inv.description}</p>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Receipt className="size-3" />
                        {fmtShortTime(inv.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-5">
                      <span
                        className={cn(
                          "font-mono text-[12px]",
                          inv.creditsDelta >= 0 ? "text-chart-2" : "text-foreground",
                        )}
                      >
                        {inv.creditsDelta >= 0 ? "+" : ""}
                        {inv.creditsDelta.toLocaleString()} cr
                      </span>
                      <span className="w-14 text-right font-mono text-[12px] text-foreground">
                        {formatDollars(inv.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <Sparkles className="size-3.5 text-chart-1" />
        Metered ledger ready — connect Stripe (or Autumn on top of Stripe) during Deployment to charge cards
        for real. Purchases become checkout sessions; payment webhooks mark invoices paid.
      </p>
    </div>
  );
}
