import { api } from "@/convex/_generated/api";
import { formatDollars, formatIdr } from "@/convex/billing/core";
import { PLANS, type PlanId } from "@/convex/catalog";
import { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Ban,
  Banknote,
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Globe2,
  Landmark,
  Loader2,
  QrCode,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  past_due: { label: "Past due", cls: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
  canceled: { label: "Canceled", cls: "border-border bg-muted text-muted-foreground" },
  expired: { label: "Expired", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

const MODE_BADGE: Record<string, { label: string; cls: string }> = {
  live: { label: "Live", cls: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  sandbox: { label: "Sandbox", cls: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
  simulated: { label: "Simulated", cls: "border-border bg-muted text-muted-foreground" },
};

const INV_KIND_LABEL: Record<string, string> = {
  plan: "Plan",
  topup: "Top-up",
  usage: "Usage",
  adjustment: "Adjustment",
};

const METHOD_ICON: Record<string, typeof CreditCard> = {
  card: CreditCard,
  ewallet: Wallet,
  qris: QrCode,
  va: Landmark,
  bank: Banknote,
};

type CheckoutResult = NonNullable<FunctionReturnType<typeof api.billing.payments.createCheckout>>;

function formatCurrency(amount: number, currency: string): string {
  return currency === "idr" ? formatIdr(amount) : formatDollars(amount);
}

function RevenueTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number; dataKey?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] shadow-lg">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="text-foreground">
          {p.dataKey === "net" ? "net" : "gross"} {formatDollars(p.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

export function BillingTab() {
  const view = useQuery(api.billing.overview);
  const setPlan = useMutation(api.billing.setPlan);
  const confirmCheckout = useMutation(api.billing.confirmCheckout);
  const cancelCheckout = useMutation(api.billing.cancelCheckout);
  const cancelSubscription = useMutation(api.billing.cancelSubscription);
  const reactivateSubscription = useMutation(api.billing.reactivateSubscription);
  const createCheckout = useAction(api.billing.payments.createCheckout);
  const now = useNow(30_000);

  const [switching, setSwitching] = useState<PlanId | null>(null);
  const [subBusy, setSubBusy] = useState<"cancel" | "reactivate" | null>(null);
  const [pending, setPending] = useState<{
    pkg: { id: string; credits: number; price: string; priceDollars: number };
    provider: string;
    method: string;
  } | null>(null);
  const [session, setSession] = useState<CheckoutResult | null>(null);
  const [paying, setPaying] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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

  const { balance, plan, perCredit, cycle, usage, invoices, packages, providers, subscription, checkouts, revenue, payment } = view;
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
  const subBadge = SUB_STATUS[subscription.status] ?? SUB_STATUS.active;
  const pendingCount = checkouts.filter((c) => !c.expired).length;

  const activeProvider = providers.find((p) => p.id === pending?.provider);

  function copyText(text: string, key: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    });
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

  function openCheckout(pkg: { id: string; credits: number; price: string; priceDollars: number }) {
    setSession(null);
    setPending({ pkg, provider: "stripe", method: "card" });
  }

  async function handlePay() {
    if (!pending) return;
    setPaying(true);
    try {
      const res = await createCheckout({
        packageId: pending.pkg.id,
        provider: pending.provider,
        method: pending.method,
      });
      setSession(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setPaying(false);
    }
  }

  async function handleSettle(sessionId: string) {
    setSettling(sessionId);
    try {
      const res = await confirmCheckout({ sessionId });
      if (res.alreadyPaid) {
        toast.info("Session already paid.");
      } else {
        toast.success(`Invoice ${res.number} paid — ${res.credits.toLocaleString()} credits added via ${res.provider}.`);
      }
      setPending(null);
      setSession(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not settle checkout.");
    } finally {
      setSettling(null);
    }
  }

  async function handleAbandon(sessionId: string, fromList: boolean) {
    setSettling(sessionId);
    try {
      await cancelCheckout({ sessionId });
      toast.info("Checkout marked failed.");
      if (!fromList) {
        setPending(null);
        setSession(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel checkout.");
    } finally {
      setSettling(null);
    }
  }

  async function handleSubscription(action: "cancel" | "reactivate") {
    setSubBusy(action);
    try {
      if (action === "cancel") {
        await cancelSubscription();
        toast.success("Subscription will not renew — you keep access until the cycle ends.");
      } else {
        await reactivateSubscription();
        toast.success("Subscription reactivated — renews on schedule.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update subscription.");
    } finally {
      setSubBusy(null);
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
              <Globe2 className="size-3" />
              {payment.provider}
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

      {/* ── subscription ─────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Subscription"
          title="Recurring plan"
          right={
            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", subBadge.cls)}>
              {subBadge.label}
            </span>
          }
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-md border border-border bg-background">
              <RefreshCw className="size-5 text-chart-1" />
            </span>
            <div>
              <p className="text-[13px] font-medium text-foreground">
                {subscription.planName} · {subscription.price}/mo
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  via {subscription.provider}
                </span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {subscription.cancelAtPeriodEnd
                  ? `Access ends ${new Date(subscription.renewsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : `Renews ${new Date(subscription.renewsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${subscription.daysLeft} days left · ${formatDollars(subscription.nextAmount)}`}
              </p>
            </div>
          </div>
          {subscription.cancelAtPeriodEnd ? (
            <Button
              variant="outline"
              size="sm"
              disabled={subBusy !== null}
              onClick={() => void handleSubscription("reactivate")}
              className="border-border bg-background"
            >
              {subBusy === "reactivate" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Reactivate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={subBusy !== null || subscription.status !== "active"}
              onClick={() => void handleSubscription("cancel")}
              className="border-border bg-background text-muted-foreground hover:text-destructive"
            >
              {subBusy === "cancel" ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
              Cancel renewal
            </Button>
          )}
        </div>
      </div>

      {/* ── credit packages ──────────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="Top-up"
          title="Buy credits"
          right={
            pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-chart-4">
                <span className="size-1.5 animate-pulse rounded-full bg-chart-4" />
                {pendingCount} open checkout{pendingCount === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
        />
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
                  onClick={() => openCheckout(p)}
                  className="border-border bg-background"
                >
                  Buy
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── payment providers ────────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="Payment methods"
          title="Accept on checkout"
          right={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-chart-2" />
              Stripe · Midtrans · Xendit
            </span>
          }
        />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {providers.map((p) => (
            <div key={p.id} className="rounded-lg border border-border bg-card p-5 transition-all hover:border-foreground/25">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-normal tracking-tight">{p.name}</p>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {p.currency}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {p.region} · {p.blurb} · {p.feePct}% fee
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.methods.slice(0, 6).map((m) => {
                  const Icon = METHOD_ICON[m.kind] ?? CreditCard;
                  return (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10.5px] text-muted-foreground"
                    >
                      <Icon className="size-3" />
                      {m.label}
                    </span>
                  );
                })}
                {p.methods.length > 6 && (
                  <span className="inline-flex items-center px-1 text-[10.5px] text-muted-foreground/60">
                    +{p.methods.length - 6}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── open checkouts ───────────────────────────────────── */}
      {checkouts.length > 0 && (
        <div>
          <SectionTitle kicker="Awaiting payment" title="Open checkouts" />
          <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
            {checkouts.map((c) => (
              <div key={c.number} className="grid items-center gap-x-6 gap-y-2 px-5 py-3.5 sm:grid-cols-[130px_auto_1fr_auto]">
                <p className="font-mono text-[11.5px] text-chart-1">{c.number}</p>
                <div className="flex items-center gap-1.5">
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", MODE_BADGE[c.mode]?.cls ?? MODE_BADGE.simulated.cls)}>
                    {MODE_BADGE[c.mode]?.label ?? "Simulated"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {c.provider} · {c.method}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] text-foreground">
                    {c.credits.toLocaleString()} credits · {formatCurrency(c.amount, c.currency)}
                  </p>
                  <p className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                    {c.payUrl ?? c.paymentId ?? "—"} · {fmtShortTime(c.createdAt)}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {!c.expired && c.paymentId ? (
                    <>
                      <Button variant="outline" size="sm" disabled={settling === c.paymentId} onClick={() => void handleSettle(c.paymentId!)} className="border-chart-2/40 bg-chart-2/5 text-chart-2 hover:bg-chart-2/10">
                        {settling === c.paymentId ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Mark paid
                      </Button>
                      <Button variant="ghost" size="sm" disabled={settling === c.paymentId} onClick={() => void handleAbandon(c.paymentId!, true)} className="text-muted-foreground hover:text-destructive">
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <span className="text-[10.5px] text-muted-foreground/60">expired</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* ── revenue dashboard ────────────────────────────────── */}
      <div>
        <SectionTitle
          kicker="Revenue dashboard"
          title="Last 14 days"
          right={
            <span className="font-mono text-[11px] text-muted-foreground">
              {revenue.paidCount} paid invoice{revenue.paidCount === 1 ? "" : "s"}
            </span>
          }
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Gross</p>
            <p className="mt-1.5 font-display text-3xl font-light tracking-tight text-chart-1">{formatDollars(revenue.gross)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">billed this window</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Fees</p>
            <p className="mt-1.5 font-display text-3xl font-light tracking-tight text-muted-foreground">{formatDollars(revenue.fees)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">provider processing</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Net</p>
            <p className="mt-1.5 font-display text-3xl font-light tracking-tight text-chart-2">{formatDollars(revenue.net)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">after fees</p>
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-6 lg:col-span-2">
            <SectionTitle
              kicker="Daily"
              title="Gross vs net"
              right={
                <span className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-chart-1" /> gross
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-chart-2" /> net
                  </span>
                </span>
              }
            />
            {revenue.gross === 0 ? (
              <p className="mt-8 rounded-md border border-dashed border-border px-4 py-10 text-center text-[12px] text-muted-foreground">
                Paid invoices will appear here as revenue accrues.
              </p>
            ) : (
              <div className="mt-6 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenue.series} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barGap={2}>
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "oklch(0.52 0.016 75)" }}
                      interval={2}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "oklch(0.52 0.016 75)" }}
                    />
                    <Tooltip cursor={{ fill: "oklch(0.92 0.015 84 / 0.5)" }} content={<RevenueTooltip />} />
                    <Bar dataKey="gross" radius={[3, 3, 0, 0]} fill="oklch(0.585 0.075 55)" maxBarSize={16} />
                    <Bar dataKey="net" radius={[3, 3, 0, 0]} fill="oklch(0.6 0.1 145)" maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-6">
              <SectionTitle kicker="Split" title="By provider" />
              {revenue.byProvider.length === 0 ? (
                <p className="mt-4 text-[12px] text-muted-foreground">No revenue yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {revenue.byProvider.map((p) => (
                    <div key={p.provider}>
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="capitalize text-muted-foreground">{p.provider}</span>
                        <span className="font-mono text-foreground">{formatDollars(p.gross)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60">
                        <div
                          className="h-full rounded-full bg-chart-1/80 transition-all duration-700"
                          style={{ width: `${Math.max(2, (p.gross / Math.max(1, revenue.gross)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-6">
              <SectionTitle kicker="Split" title="By kind" />
              {revenue.byKind.length === 0 ? (
                <p className="mt-4 text-[12px] text-muted-foreground">No revenue yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {revenue.byKind.map((k) => (
                    <div key={k.kind} className="flex items-center justify-between text-[11.5px]">
                      <span className="text-muted-foreground">{INV_KIND_LABEL[k.kind] ?? k.kind}</span>
                      <span className="font-mono text-foreground">
                        {formatDollars(k.gross)} · {k.count}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
                        {inv.paymentProvider && (
                          <span className="rounded-full border border-border px-1.5 py-px text-[9.5px] uppercase">
                            {inv.paymentProvider}
                            {inv.mode ? ` · ${inv.mode}` : ""}
                          </span>
                        )}
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
        Checkout sessions are created via Stripe, Midtrans, or Xendit — paste STRIPE_SECRET_KEY, MIDTRANS_SERVER_KEY, or
        XENDIT_API_KEY in the project keys to charge for real; inbound webhooks reconcile invoices automatically.
      </p>

      {/* ── checkout dialog ──────────────────────────────────── */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && (setPending(null), setSession(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {session ? "Complete payment" : `Buy ${pending?.pkg.credits.toLocaleString()} credits`}
            </DialogTitle>
            <DialogDescription>
              {session
                ? `Invoice ${session.invoiceNumber} · ${formatCurrency(session.displayAmount, session.currency)}`
                : `Charge ${pending?.pkg.price} — pay with a provider below.`}
            </DialogDescription>
          </DialogHeader>

          {!session && pending ? (
            <div className="mt-2 space-y-5">
              {/* provider picker */}
              <div className="grid grid-cols-3 gap-2">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPending({ ...pending, provider: p.id, method: p.methods[0]?.id ?? "card" })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-all",
                      pending.provider === p.id
                        ? "border-chart-1/60 bg-chart-1/5"
                        : "border-border bg-background hover:border-foreground/25",
                    )}
                  >
                    <span className="text-[12px] font-medium text-foreground">{p.name}</span>
                    <span className="font-mono text-[9.5px] uppercase text-muted-foreground">{p.currency}</span>
                  </button>
                ))}
              </div>

              {/* method picker */}
              {activeProvider && (
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {activeProvider.name} methods
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeProvider.methods.map((m) => {
                      const Icon = METHOD_ICON[m.kind] ?? CreditCard;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setPending({ ...pending, method: m.id })}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-all",
                            pending.method === m.id
                              ? "border-chart-1/60 bg-chart-1/5 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:border-foreground/25",
                          )}
                        >
                          <Icon className="size-3" />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-border/70 pt-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">Total due · {pending.pkg.price}</p>
                  <p className="font-display text-2xl font-light tracking-tight text-foreground">
                    {formatCurrency(
                      activeProvider?.currency === "idr" ? pending.pkg.priceDollars * 16000 : pending.pkg.priceDollars,
                      activeProvider?.currency ?? "usd",
                    )}
                  </p>
                </div>
                <Button onClick={() => void handlePay()} disabled={paying}>
                  {paying ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                  {paying ? "Creating session…" : "Pay"}
                </Button>
              </div>
            </div>
          ) : session ? (
            <div className="mt-2 space-y-5">
              <div className={cn("inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-medium", MODE_BADGE[session.mode]?.cls ?? MODE_BADGE.simulated.cls)}>
                {MODE_BADGE[session.mode]?.label ?? "Simulated"} checkout
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {session.provider} · {session.method} · {formatCurrency(session.displayAmount, session.currency)}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{session.payUrl}</p>
                  <button
                    onClick={() => copyText(session.payUrl, "payurl")}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Copy pay URL"
                  >
                    {copied === "payurl" ? <Check className="size-3.5 text-chart-2" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                {session.mode === "simulated"
                  ? "Simulated mode — no provider keys configured. Click “Mark as paid” to settle like a paid webhook."
                  : "Open the hosted page to pay. A provider webhook reconciles the invoice automatically."}
              </p>
              <div className="flex items-center justify-between border-t border-border/70 pt-4">
                <Button variant="ghost" size="sm" disabled={settling === session.sessionId} onClick={() => void handleAbandon(session.sessionId, false)} className="text-muted-foreground hover:text-destructive">
                  Cancel session
                </Button>
                <Button size="sm" disabled={settling === session.sessionId} onClick={() => void handleSettle(session.sessionId)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  {settling === session.sessionId ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Mark as paid
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
