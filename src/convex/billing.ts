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
import { creditValueDollars, revenueMetrics } from "./dashboard/core";
import {
  CREDIT_PACKAGES,
  cycleFor,
  cycleProgress,
  nextBillingDate,
  packageById,
  packagePriceDollars,
  planInvoice,
  prorateSwitch,
  topupInvoice,
  usageCost,
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

    const [invoices, requests] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(40),
      ctx.db
        .query("gatewayRequests")
        .withIndex("by_user_created", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(500),
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
      revenue: revenueMetrics(plan, creditsUsed),
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
        createdAt: i.createdAt,
        paidAt: i.paidAt,
      })),
      payment: {
        provider: "stripe",
        card: "•••• 4242",
        exp: "12/28",
        ready: true,
        note: "Stripe-ready — wire AUTUMN_API_KEY + STRIPE_* keys in Deployment to charge cards for real.",
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
