import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { kindValidator, statusValidator } from "./catalog";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // Atelier platform billing fields
      credits: v.optional(v.number()), // credit balance (1 credit ≈ 1 simulated unit)
      plan: v.optional(v.string()), // billing plan id: starter | pro | scale
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Atelier API Key Platform — live keys issued to users.
    apiKeys: defineTable({
      userId: v.id("users"),
      name: v.string(),
      prefix: v.string(), // visible prefix, e.g. "apk_live_3f2a…"
      keyHash: v.string(), // sha-256 of the full secret (secret shown once)
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // Atelier AI Gateway — every routed request, from queue to billing.
    gatewayRequests: defineTable({
      userId: v.id("users"),
      apiKeyId: v.optional(v.id("apiKeys")), // key the request was routed through
      kind: kindValidator,
      provider: v.string(),
      model: v.string(),
      prompt: v.string(),
      imageUrl: v.optional(v.string()),
      imageName: v.optional(v.string()),
      status: statusValidator, // queued → processing → completed | failed
      responseText: v.optional(v.string()),
      latencyMs: v.optional(v.number()),
      credits: v.number(), // cost charged on completion
      error: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
