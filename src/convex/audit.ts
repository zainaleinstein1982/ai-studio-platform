// STEP 03 · Audit log — an immutable trail of security-sensitive events.
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

export interface AuditEvent {
  action: string;
  targetType: string;
  targetId?: string;
  detail?: string;
}

export const ACTIONS = {
  KEY_CREATED: "key.created",
  KEY_UPDATED: "key.updated",
  KEY_ROTATED: "key.rotated",
  KEY_REVOKED: "key.revoked",
  KEY_EXPIRED: "key.expired",
  WEBHOOK_REGENERATED: "webhook.regenerated",
  ROLE_CHANGED: "role.changed",
  ORG_CREATED: "org.created",
  ORG_MEMBER_INVITED: "org.member_invited",
  ORG_MEMBER_REMOVED: "org.member_removed",
} as const;

/** Append an audit entry for a user. Call from any mutation with a ctx. */
export async function logAudit(
  ctx: MutationCtx,
  userId: string,
  event: AuditEvent,
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    userId: userId as never,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    detail: event.detail,
    createdAt: Date.now(),
  });
}

/** Recent audit entries for the signed-in user. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 40 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});
