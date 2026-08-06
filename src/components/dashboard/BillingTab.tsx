import { api } from "@/convex/_generated/api";
import { PLANS, planById, type PlanId } from "@/convex/catalog";
import { useMutation, useQuery } from "convex/react";
import { BadgeCheck, CreditCard, Loader2, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionTitle, fmtShortTime, kindLabel, providerLabel } from "./bits";
import { cn } from "@/lib/utils";

export function BillingTab() {
  const stats = useQuery(api.gateway.stats);
  const recent = useQuery(api.gateway.list, { limit: 8 });
  const addCredits = useMutation(api.billing.addCredits);
  const setPlan = useMutation(api.billing.setPlan);

  const [switching, setSwitching] = useState<PlanId | null>(null);
  const [toppingUp, setToppingUp] = useState(false);

  if (!stats) {
    return (
      <div className="grid gap-5">
        <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    );
  }

  const plan = planById(stats.plan);
  const maxProvider = Math.max(1, ...stats.byProvider.map((p) => p.credits));
  const charges = (recent ?? []).filter((r) => r.status === "completed");

  async function handleSwitch(p: PlanId) {
    setSwitching(p);
    try {
      await setPlan({ plan: p });
      toast.success(`Switched to ${PLANS.find((x) => x.id === p)?.name} — credit allowance refreshed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch plan.");
    } finally {
      setSwitching(null);
    }
  }

  async function handleTopUp() {
    setToppingUp(true);
    try {
      await addCredits({ amount: 100 });
      toast.success("Added 100 credits to your balance.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Top-up failed.");
    } finally {
      setToppingUp(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* balance */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_220px_at_85%_-20%,oklch(0.87_0.05_75/0.5),transparent_65%)]"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Credit balance · {plan ? `${plan.name} plan` : "Starter plan"}
            </p>
            <p className="mt-3 font-display text-5xl font-light tracking-tight text-chart-1">
              {stats.credits.toLocaleString()}
              <span className="ml-2 text-lg text-muted-foreground">credits</span>
            </p>
            <p className="mt-2 max-w-md text-[12.5px] leading-6 text-muted-foreground">
              One credit ≈ one lightweight gateway unit. Text is 1 credit; video routes are
              the most expensive. Balance is charged on completion — failed calls cost nothing.
            </p>
          </div>
          <Button
            onClick={() => void handleTopUp()}
            disabled={toppingUp}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {toppingUp ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add 100 credits
          </Button>
        </div>
      </div>

      {/* plans */}
      <div>
        <SectionTitle kicker="Plans" title="Choose your allowance" />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const current = p.id === stats.plan;
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
              </div>
            );
          })}
        </div>
      </div>

      {/* usage breakdown + ledger */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <SectionTitle kicker="Usage" title="Spend by provider" />
          {stats.byProvider.length === 0 ? (
            <p className="mt-5 text-[12.5px] text-muted-foreground">
              No completed calls yet — spend appears here once you send requests.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {stats.byProvider.map((p) => (
                <div key={p.provider}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium capitalize text-foreground">
                      {providerLabel(p.provider)}
                    </span>
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
          <SectionTitle kicker="Ledger" title="Recent charges" />
          <div className="mt-4 divide-y divide-border/70">
            {charges.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                Nothing billed yet.
              </p>
            ) : (
              charges.map((r) => (
                <div key={r._id} className="flex items-center gap-3 py-2.5">
                  <CreditCard className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-foreground">
                      {kindLabel(r.kind)}
                      <span className="mx-1.5 text-muted-foreground/60">·</span>
                      <span className="text-muted-foreground">{providerLabel(r.provider)}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{fmtShortTime(r.createdAt)}</p>
                  </div>
                  <span className="font-mono text-[12px] text-foreground">−{r.credits} cr</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <Sparkles className="size-3.5 text-chart-1" />
        Demo metering — production billing plugs into Stripe via a payment webhook during Deployment.
      </p>
    </div>
  );
}
