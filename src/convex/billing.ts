// Billing — credit balance, plans, and usage accounting.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { PLANS, STARTER_CREDITS } from "./catalog";
import { getCurrentUser } from "./users";

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

/** Switch plan — grants the plan's credit allowance. */
export const setPlan = mutation({
  args: { plan: v.string() },
  handler: async (ctx, { plan }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const known = PLANS.some((p) => p.id === plan);
    if (!known) throw new Error("Unknown plan");
    await ctx.db.patch(user._id, {
      plan,
      credits: PLANS.find((p) => p.id === plan)!.credits,
    });
  },
});

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
