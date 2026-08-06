// STEP 12 · Billing — Convex surface.
//
// Credit accounting on top of the pure ledger in ./billing/core.ts:
//   · ensureAccount / account — balance & plan
//   · purchasePackage — credit top-ups → paid invoices
//   · setPlan — prorated plan switches → plan invoices
//   · overview — the full Billing tab payload (cycle, usage, invoices)
//
// Real money plugs in during Deployment via a payment provider (Stripe or
// Autumn): purchases become checkout sessions and inbound webhooks mark
// invoices paid. Here payments are simulated as instant-paid so the whole
// ledger lifecycle stays testable end to end.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { PLANS, STARTER_CREDITS, type GatewayKind } from "./catalog";
import { getCurrentUser } from "./users";
import { requireUser } from "./permissions";
import { creditValueDollars } from "./dashboard/core";
import {
  CHECKOUT_TTL_MS,
  CREDIT_PACKAGES,
  PAYMENT_PROVIDERS,
  checkoutExpired,
  cycleFor,
  cycleProgress,
  daysBetween,
  defaultMethod,
  isValidMethod,
  nextBillingDate,
  packageById,
  packagePriceDollars,
  planInvoice,
  providerById,
  prorateSwitch,
  renewalInfo,
  revenueTotals,
  subscriptionStatusAt,
  topupInvoice,
  usageCost,
  usdToIdr,
} from "./billing/core";
import type { Id } from "./_generated/dataModel";

/** Lazily initialise a new account with the starter allowance. */
export const ensureAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const patch: { credits?: number; plan?: string } = {};
    if (user.credits === undefined) patch.credits = STARTER_CREDITS;
    if (!user.plan) patch.plan = "starter";
    if (patch.credits !== undefined || patch.plan !== undefined) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

/** Demo top-up (a real deployment would route this through Stripe). */
export const addCredits = mutation({
  args: { amount: v.number() },
  handler: async (ctx, { amount }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    if (amount <= 0 || amount > 100000) throw new Error("Invalid amount");
    await ctx.db.patch(user._id, {
      credits: (user.credits ?? 0) + amount,
    });
  },
});

/** Per-user invoice sequence (next number = count + 1). */
async function nextInvoiceSeq(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  const existing = await ctx.db
    .query("invoices")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect();
  return existing.length + 1;
}

/** Purchase a credit pack — simulated instant payment → paid invoice. */
export const purchasePackage = mutation({
  args: { packageId: v.string() },
  handler: async (ctx, { packageId }) => {
    const user = await requireUser(ctx);
    const pkg = packageById(packageId);
    if (!pkg) throw new Error("Unknown credit package");
    const now = Date.now();
    const seq = await nextInvoiceSeq(ctx, user._id);
    const inv = topupInvoice({ pkg, seq, at: now });
    await ctx.db.insert("invoices", {
      userId: user._id,
      number: inv.number,
      kind: inv.kind,
      status: inv.status,
      description: inv.description,
      items: inv.items,
      creditsDelta: inv.creditsDelta,
      amount: inv.amount,
      paymentMethod: inv.paymentMethod,
      createdAt: inv.createdAt,
      paidAt: inv.paidAt,
    });
    await ctx.db.patch(user._id, { credits: (user.credits ?? 0) + pkg.credits });
    return { number: inv.number, credits: pkg.credits, amount: inv.amount };
  },
});

/** Switch plans with prorated allowance + a plan invoice on the ledger. */
export const setPlan = mutation({
  args: { plan: v.string() },
  handler: async (ctx, { plan }) => {
    const user = await requireUser(ctx);
    const to = PLANS.find((p) => p.id === plan);
    if (!to) throw new Error("Unknown plan");
    const from = PLANS.find((p) => p.id === (user.plan ?? "starter")) ?? PLANS[0];
    if (from.id === to.id) {
      return { plan: to.id, credits: user.credits ?? 0, creditDelta: 0, prorationNote: "Already on this plan", invoiceNumber: null };
    }

    const now = Date.now();
    const cycle = cycleFor(now);
    const pr = prorateSwitch(from, to, cycle.start, now, cycle.end);
    const next = Math.max(0, (user.credits ?? 0) + pr.creditDelta);
    const seq = await nextInvoiceSeq(ctx, user._id);
    const inv = planInvoice({
      planName: to.name,
      planId: to.id,
      price: to.price,
      credits: pr.toCredits,
      periodStart: cycle.start,
      periodEnd: cycle.end,
      seq,
      at: now,
    });
    await ctx.db.insert("invoices", {
      userId: user._id,
      number: inv.number,
      kind: inv.kind,
      status: inv.status,
      description: inv.description,
      items: inv.items,
      creditsDelta: inv.creditsDelta,
      amount: inv.amount,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      planId: inv.planId,
      paymentMethod: inv.paymentMethod,
      createdAt: inv.createdAt,
      paidAt: inv.paidAt,
    });
    await ctx.db.patch(user._id, { plan: to.id, credits: next });
    await upsertSubscription(ctx, user._id, to.id, now);

    return {
      plan: to.id,
      credits: next,
      creditDelta: pr.creditDelta,
      prorationNote: pr.note,
      invoiceNumber: inv.number,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Payment checkouts (Stripe · Midtrans · Xendit)                      */
/* ------------------------------------------------------------------ */

/** Step 1 — create a pending top-up invoice for a checkout session. */
export const prepareCheckout = mutation({
  args: { packageId: v.string(), provider: v.string(), method: v.optional(v.string()) },
  handler: async (ctx, { packageId, provider, method }) => {
    const user = await requireUser(ctx);
    const pkg = packageById(packageId);
    if (!pkg) throw new Error("Unknown credit package");
    const prov = providerById(provider);
    if (!prov) throw new Error("Unknown payment provider");
    const chosen = method ? (isValidMethod(prov, method) ? method : defaultMethod(prov)) : defaultMethod(prov);
    const now = Date.now();
    const seq = await nextInvoiceSeq(ctx, user._id);
    const inv = topupInvoice({ pkg, seq, at: now });
    await ctx.db.insert("invoices", {
      userId: user._id,
      number: inv.number,
      kind: inv.kind,
      status: "pending", // paid only after the provider settles
      description: inv.description,
      items: inv.items,
      creditsDelta: inv.creditsDelta,
      amount: inv.amount,
      paymentProvider: prov.id,
      paymentMethod: `${prov.name} · ${chosen}`,
      currency: prov.currency,
      method: chosen,
      createdAt: inv.createdAt,
    });
    return {
      invoiceNumber: inv.number,
      amount: inv.amount,
      credits: pkg.credits,
      provider: prov.id,
      method: chosen,
      currency: prov.currency,
      displayAmount: prov.currency === "idr" ? usdToIdr(inv.amount) : inv.amount,
    };
  },
});

/** Step 2 — persist the hosted session returned by the provider. */
export const recordCheckout = mutation({
  args: {
    invoiceNumber: v.string(),
    provider: v.string(),
    method: v.string(),
    externalId: v.string(),
    payUrl: v.string(),
    mode: v.string(),
  },
  handler: async (ctx, { invoiceNumber, provider, method, externalId, payUrl, mode }) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db
      .query("invoices")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("number"), invoiceNumber))
      .first();
    if (!inv) throw new Error("Invoice not found");
    await ctx.db.patch(inv._id, {
      paymentId: externalId,
      payUrl,
      mode,
      paymentProvider: provider,
      method,
      paymentMethod: `${providerById(provider)?.name ?? provider} · ${method}`,
    });
    return { ok: true, invoiceNumber, paymentId: externalId };
  },
});

/** Demo settle — the console equivalent of a paid provider webhook. */
export const confirmCheckout = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db
      .query("invoices")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("paymentId"), sessionId))
      .first();
    if (!inv) throw new Error("Checkout session not found");
    if (inv.status === "paid") {
      return { number: inv.number, credits: inv.creditsDelta, alreadyPaid: true };
    }
    const now = Date.now();
    await ctx.db.patch(inv._id, { status: "paid", paidAt: now });
    await ctx.db.patch(user._id, { credits: (user.credits ?? 0) + inv.creditsDelta });
    return {
      number: inv.number,
      credits: inv.creditsDelta,
      provider: inv.paymentProvider ?? "stripe",
      method: inv.method ?? "card",
      mode: inv.mode ?? "simulated",
      alreadyPaid: false,
    };
  },
});

/** Mark an abandoned checkout failed. */
export const cancelCheckout = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db
      .query("invoices")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("paymentId"), sessionId))
      .first();
    if (!inv) throw new Error("Checkout session not found");
    if (inv.status === "paid") return { ok: true, alreadyPaid: true };
    await ctx.db.patch(inv._id, { status: "failed" });
    return { ok: true };
  },
});

/**
 * Reconcile a normalized provider webhook event (idempotent). Called by the
 * /v1/billing/webhooks/:provider HTTP route after signature verification.
 */
export const applyPaymentEvent = mutation({
  args: {
    provider: v.string(),
    externalId: v.string(),
    event: v.string(),
    status: v.union(v.literal("paid"), v.literal("failed"), v.literal("ignored")),
    invoiceRef: v.optional(v.string()),
    amount: v.optional(v.number()),
    method: v.optional(v.string()),
  },
  handler: async (ctx, { provider, externalId, event, status, invoiceRef, method }) => {
    const user = await requireUser(ctx);
    if (status === "ignored") return { ok: true, ignored: true, event };

    const inv = await ctx.db
      .query("invoices")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .filter((q) =>
        q.or(
          q.eq(q.field("paymentId"), externalId),
          invoiceRef ? q.eq(q.field("number"), invoiceRef) : q.neq(q.field("number"), "__none__"),
        ),
      )
      .first();
    if (!inv) throw new Error("Invoice not found for webhook");
    if (inv.status === "paid") return { ok: true, number: inv.number, alreadyPaid: true, event };

    const now = Date.now();
    const patch: Record<string, unknown> = {
      paymentId: inv.paymentId ?? externalId,
      paymentProvider: provider,
      method: method ?? inv.method,
      mode: "live",
    };
    if (status === "paid") {
      patch.status = "paid";
      patch.paidAt = now;
      patch.paymentMethod = `${providerById(provider)?.name ?? provider} · ${method ?? inv.method ?? "card"}`;
      await ctx.db.patch(user._id, { credits: (user.credits ?? 0) + inv.creditsDelta });
    } else {
      patch.status = "failed";
    }
    await ctx.db.patch(inv._id, patch);
    return { ok: true, number: inv.number, status, event };
  },
});

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

/** Upsert the user's subscription after a plan change. */
async function upsertSubscription(
  ctx: MutationCtx,
  userId: Id<"users">,
  planId: string,
  now: number,
  opts: { cancelAtPeriodEnd?: boolean } = {},
) {
  const cycle = cycleFor(now);
  const renewsAt = nextBillingDate(now);
  const existing = await ctx.db.query("subscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  const base = {
    planId,
    currentPeriodStart: cycle.start,
    currentPeriodEnd: cycle.end,
    renewsAt,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...base,
      provider: existing.provider,
      status: opts.cancelAtPeriodEnd ? "canceled" : "active",
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
    });
    return existing._id;
  }
  return await ctx.db.insert("subscriptions", {
    userId,
    provider: "stripe",
    status: opts.cancelAtPeriodEnd ? "canceled" : "active",
    cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    ...base,
    createdAt: now,
  });
}

export const cancelSubscription = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    await upsertSubscription(ctx, user._id, user.plan ?? "starter", now, { cancelAtPeriodEnd: true });
    return { ok: true, cancelAtPeriodEnd: true };
  },
});

export const reactivateSubscription = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    await upsertSubscription(ctx, user._id, user.plan ?? "starter", now);
    return { ok: true, cancelAtPeriodEnd: false };
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Simple account query — credits + plan. */
export const account = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      credits: user.credits ?? 0,
      plan: user.plan ?? "starter",
    };
  },
});

/** Full Billing tab payload: cycle, usage metering, packages, invoices. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const now = Date.now();
    const cycle = cycleFor(now);
    const plan = PLANS.find((p) => p.id === (user.plan ?? "starter")) ?? PLANS[0];
    const perCredit = creditValueDollars(plan);

    const [invoices, requests, subscription] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(80),
      ctx.db
        .query("gatewayRequests")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(500),
      ctx.db.query("subscriptions").withIndex("by_user", (q) => q.eq("userId", user._id)).first(),
    ]);

    // Usage metering — completed calls inside the current cycle.
    const completed = requests.filter(
      (r) => r.status === "completed" && r.createdAt >= cycle.start && r.createdAt < cycle.end,
    );
    const creditsUsed = completed.reduce((sum, r) => sum + r.credits, 0);
    const byProvider: Record<string, number> = {};
    const byKind: Record<string, { count: number; credits: number }> = {};
    for (const r of completed) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.credits;
      const bucket = byKind[r.kind] ?? { count: 0, credits: 0 };
      bucket.count += 1;
      bucket.credits += r.credits;
      byKind[r.kind] = bucket;
    }

    return {
      balance: user.credits ?? 0,
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        credits: plan.credits,
        tagline: plan.tagline,
        features: plan.features,
      },
      perCredit,
      cycle: {
        start: cycle.start,
        end: cycle.end,
        days: cycle.days,
        progress: cycleProgress(cycle.start, now, cycle.end),
        nextBilling: nextBillingDate(now),
      },
      usage: {
        count: completed.length,
        creditsUsed,
        cost: usageCost(creditsUsed, perCredit),
        byProvider: Object.entries(byProvider)
          .map(([provider, credits]) => ({ provider, credits }))
          .sort((a, b) => b.credits - a.credits),
        byKind: Object.entries(byKind).map(([kind, s]) => ({
          kind: kind as GatewayKind,
          ...s,
        })),
      },
      packages: CREDIT_PACKAGES.map((p) => ({
        id: p.id,
        credits: p.credits,
        price: p.price,
        priceDollars: packagePriceDollars(p),
        note: p.note,
      })),
      invoices: invoices.map((i) => ({
        number: i.number,
        kind: i.kind,
        status: i.status,
        description: i.description,
        items: i.items,
        creditsDelta: i.creditsDelta,
        amount: i.amount,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        planId: i.planId,
        paymentProvider: i.paymentProvider ?? null,
        paymentId: i.paymentId ?? null,
        payUrl: i.payUrl ?? null,
        mode: i.mode ?? null,
        currency: i.currency ?? null,
        method: i.method ?? null,
        createdAt: i.createdAt,
        paidAt: i.paidAt,
      })),
      providers: PAYMENT_PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        region: p.region,
        currency: p.currency,
        feePct: p.feePct,
        blurb: p.blurb,
        methods: p.methods.map((m) => ({ id: m.id, label: m.label, kind: m.kind })),
      })),
      subscription: (() => {
        const renewsAt = subscription?.renewsAt ?? nextBillingDate(now);
        const status = subscription
          ? subscriptionStatusAt({
              renewsAt: subscription.renewsAt,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              now,
            })
          : "active";
        const next = renewalInfo({ planPrice: plan.price, periodStart: cycle.start, now });
        return {
          planId: plan.id,
          planName: plan.name,
          price: plan.price,
          provider: subscription?.provider ?? "stripe",
          status,
          renewsAt,
          cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
          daysLeft: Math.max(0, daysBetween(now, renewsAt)),
          nextAmount: next.nextAmount,
        };
      })(),
      checkouts: invoices
        .filter((i) => i.status === "pending")
        .map((i) => ({
          number: i.number,
          provider: i.paymentProvider ?? "stripe",
          method: i.method ?? "card",
          mode: i.mode ?? "simulated",
          amount: i.amount,
          credits: i.creditsDelta,
          currency: i.currency ?? "usd",
          payUrl: i.payUrl ?? null,
          paymentId: i.paymentId ?? null,
          createdAt: i.createdAt,
          expired: checkoutExpired({ expiresAt: i.createdAt + CHECKOUT_TTL_MS }, now),
        })),
      revenue: revenueTotals(invoices, { days: 14, now }),
      payment: {
        provider: providerById(invoices.find((i) => i.status === "paid")?.paymentProvider ?? "stripe")?.name ?? "Stripe",
        card: "•••• 4242",
        exp: "12/28",
        ready: true,
        note: "Checkout sessions are created via Stripe, Midtrans, or Xendit — add the provider keys in Deployment to charge for real.",
      },
    };
  },
});

/** Invoice history, newest first. */
export const listInvoices = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 40 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("invoices")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});
