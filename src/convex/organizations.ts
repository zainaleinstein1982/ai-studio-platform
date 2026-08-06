// STEP 02 · Organization & Team.
// Organizations own shared workspaces; members carry org roles
// (owner > admin > member) enforced by the permission middleware.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getOrgMembership,
  requireOrgAdmin,
  requireOrgOwner,
  requireUser,
} from "./permissions";
import { enforceRateLimit } from "./rateLimit";

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const orgRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);
export type OrgRole = (typeof ORG_ROLES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Organizations                                                       */
/* ------------------------------------------------------------------ */

export const createOrg = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await requireUser(ctx);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error("Organization name must be at least 2 characters");

    await enforceRateLimit(ctx, {
      name: "org-create",
      key: user._id,
      limit: 3,
      windowMs: 60_000,
    });

    const orgId = await ctx.db.insert("organizations", {
      name: trimmed.slice(0, 60),
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.insert("organizationMembers", {
      orgId,
      userId: user._id,
      role: "owner",
      email: user.email,
      addedBy: user._id,
      createdAt: Date.now(),
    });
    return { orgId };
  },
});

export const renameOrg = mutation({
  args: { orgId: v.id("organizations"), name: v.string() },
  handler: async (ctx, { orgId, name }) => {
    await requireOrgAdmin(ctx, orgId);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error("Organization name must be at least 2 characters");
    await ctx.db.patch(orgId, { name: trimmed.slice(0, 60) });
  },
});

export const deleteOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgOwner(ctx, orgId);
    const members = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);
    await ctx.db.delete(orgId);
  },
});

/** Organizations the current user belongs to, with their role. */
export const listMyOrgs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return org
          ? { id: org._id, name: org.name, role: m.role as OrgRole, createdAt: org.createdAt }
          : null;
      }),
    );
    return orgs.filter((o): o is NonNullable<typeof o> => o !== null);
  },
});

/* ------------------------------------------------------------------ */
/* Team (members)                                                      */
/* ------------------------------------------------------------------ */

/** Members of an organization — any member can view the roster. */
export const listOrgMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const membership = await getOrgMembership(ctx, orgId);
    if (!membership) return null;
    const members = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return Promise.all(
      members.map(async (m) => {
        const u = await ctx.db.get(m.userId);
        return {
          id: m._id,
          userId: m.userId,
          name: u?.name ?? null,
          email: m.email ?? u?.email ?? null,
          role: m.role as OrgRole,
          joinedAt: m.createdAt,
        };
      }),
    );
  },
});

/** Add a user to the organization by email (org admins). */
export const inviteMember = mutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.optional(orgRoleValidator),
  },
  handler: async (ctx, { orgId, email, role = "member" }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    if (role === "owner") throw new Error("Ownership can only be transferred, not granted");

    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) throw new Error("Invalid email address");

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .first();
    if (!existing) {
      throw new Error("No Atelier account found for this email — they need to sign up first");
    }

    const dup = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", existing._id))
      .first();
    if (dup) throw new Error(`${normalized} is already a member`);

    await ctx.db.insert("organizationMembers", {
      orgId,
      userId: existing._id,
      role,
      email: normalized,
      addedBy: admin.userId,
      createdAt: Date.now(),
    });
  },
});

/** Change a member's role (org admin; only the owner may change the owner). */
export const setMemberRole = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: orgRoleValidator,
  },
  handler: async (ctx, { orgId, userId, role }) => {
    const actor = await requireOrgAdmin(ctx, orgId);
    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();
    if (!membership) throw new Error("User is not a member");

    if (membership.role === "owner" || role === "owner") {
      await requireOrgOwner(ctx, orgId);
    }
    if (membership.userId === actor.userId && role !== membership.role) {
      // Prevent demoting yourself below admin (which would lock the org).
      if (membership.role === "owner" || actor.role !== "owner") {
        throw new Error("Owner role changes require the owner");
      }
    }
    await ctx.db.patch(membership._id, { role });
  },
});

/** Remove a member (org admin; only the owner may remove the owner). */
export const removeMember = mutation({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, { orgId, userId }) => {
    const actor = await requireOrgAdmin(ctx, orgId);
    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();
    if (!membership) throw new Error("User is not a member");
    if (membership.role === "owner") {
      await requireOrgOwner(ctx, orgId);
      if (membership.userId === actor.userId) {
        throw new Error("Transfer ownership before deleting your own membership");
      }
    }
    await ctx.db.delete(membership._id);
  },
});

/** Leave an organization; the last member deletes the organization. */
export const leaveOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const user = await requireUser(ctx);
    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
      .first();
    if (!membership) throw new Error("You are not a member");

    const remaining = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    if (membership.role === "owner" && remaining.length > 1) {
      throw new Error("Transfer ownership to another member before leaving");
    }
    await ctx.db.delete(membership._id);
    if (remaining.length <= 1) {
      await ctx.db.delete(orgId);
    }
  },
});
