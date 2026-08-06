// STEP 02 · User profile, email verification, admin user management.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { roleValidator } from "./schema";
import { requireAdmin, requireUser } from "./permissions";
import { sha256Hex } from "./keygen";
import { generateDigitToken, sendOtpEmail } from "./auth/email";

const VERIFICATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Update the signed-in user's profile (name / image). */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { name, image }) => {
    const user = await requireUser(ctx);
    const patch: { name?: string; image?: string } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name cannot be empty");
      patch.name = trimmed.slice(0, 60);
    }
    if (image !== undefined) {
      patch.image = image.trim().slice(0, 500) || undefined;
    }
    if (patch.name || patch.image) {
      await ctx.db.patch(user._id, patch);
    }
  },
});

/** Send a 6-digit verification code to the account's email address. */
export const sendVerificationEmail = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const email = user.email;
    if (!email) throw new Error("This account has no email address to verify");
    if (user.emailVerificationTime) throw new Error("Email is already verified");

    // Invalidate any previous codes for this user.
    const old = await ctx.db
      .query("emailVerifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const record of old) await ctx.db.delete(record._id);

    const token = generateDigitToken(6);
    await ctx.db.insert("emailVerifications", {
      userId: user._id,
      email,
      tokenHash: await sha256Hex(token),
      expiresAt: Date.now() + VERIFICATION_TTL_MS,
      createdAt: Date.now(),
    });
    await sendOtpEmail(email, token);
  },
});

/** Verify the email with the code sent by sendVerificationEmail. */
export const verifyEmail = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    if (user.emailVerificationTime) throw new Error("Email is already verified");

    const tokenHash = await sha256Hex(code.trim());
    const records = await ctx.db
      .query("emailVerifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const match = records.find(
      (r) => r.tokenHash === tokenHash && r.expiresAt > Date.now(),
    );
    if (!match) throw new Error("Invalid or expired verification code");

    await ctx.db.patch(user._id, { emailVerificationTime: Date.now() });
    await ctx.db.delete(match._id);
  },
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** Platform user list — admins only. */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    void admin;
    const users = await ctx.db.query("users").take(200);
    return users.map((u) => ({
      id: u._id,
      name: u.name ?? null,
      email: u.email ?? null,
      role: u.role ?? "user",
      emailVerified: Boolean(u.emailVerificationTime),
      createdAt: u._creationTime,
    }));
  },
});

/** Change a user's role — admins only. */
export const setUserRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, { userId, role }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(userId, { role });
  },
});
