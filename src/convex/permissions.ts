// STEP 02 · RBAC + permission middleware.
// Pure helpers are unit-testable; the ctx-bound helpers guard mutations.
import { ROLES, type Role } from "./schema";
import { getCurrentUser } from "./users";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export type { Role };

export const ROLE_RANK: Record<Role, number> = {
  [ROLES.MEMBER]: 0,
  [ROLES.USER]: 1,
  [ROLES.ADMIN]: 2,
};

export const ROLE_LABEL: Record<Role, string> = {
  [ROLES.MEMBER]: "Member",
  [ROLES.USER]: "User",
  [ROLES.ADMIN]: "Admin",
};

/** true when `role` is at least `min` in the hierarchy. */
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  return ROLE_RANK[role ?? ROLES.MEMBER] >= ROLE_RANK[min];
}

/** The current user, or throw when unauthenticated. */
export async function requireUser(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  return user;
}

/** The current user, or throw when they are not an admin. */
export async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.role !== ROLES.ADMIN) throw new Error("Forbidden: admin role required");
  return user;
}

export type OrgRole = "owner" | "admin" | "member";

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export function orgRoleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[min];
}

/** Membership doc of the current user in `orgId`, or null. */
export async function getOrgMembership(
  ctx: QueryCtx,
  orgId: string,
): Promise<{
  orgId: string;
  userId: Id<"users">;
  role: OrgRole;
  email?: string;
} | null> {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const membership = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId as Id<"organizations">).eq("userId", user._id))
    .first();
  if (!membership) return null;
  return {
    orgId: membership.orgId,
    userId: membership.userId,
    role: membership.role as OrgRole,
    email: membership.email,
  };
}

/** Throw unless the current user belongs to the organization. */
export async function requireOrgMembership(ctx: QueryCtx, orgId: string) {
  const membership = await getOrgMembership(ctx, orgId);
  if (!membership) throw new Error("Forbidden: not a member of this organization");
  return membership;
}

/** Throw unless the current user can administer the organization. */
export async function requireOrgAdmin(ctx: QueryCtx, orgId: string) {
  const membership = await requireOrgMembership(ctx, orgId);
  if (!orgRoleAtLeast(membership.role, "admin")) {
    throw new Error("Forbidden: organization admin required");
  }
  return membership;
}

/** Throw unless the current user owns the organization. */
export async function requireOrgOwner(ctx: QueryCtx, orgId: string) {
  const membership = await requireOrgMembership(ctx, orgId);
  if (membership.role !== "owner") throw new Error("Forbidden: organization owner required");
  return membership;
}
