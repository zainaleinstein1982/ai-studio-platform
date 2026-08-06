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

    // Atelier API Key Platform — STEP 03: scopes, limits, expiry, webhooks.
    apiKeys: defineTable({
      userId: v.id("users"),
      name: v.string(),
      prefix: v.string(), // visible prefix, e.g. "apk_live_3f2a…"
      keyHash: v.string(), // sha-256 of the full secret (secret shown once)
      scopes: v.optional(v.array(v.string())), // routes the key may call (undefined = all)
      dailyLimit: v.optional(v.number()), // max requests per calendar day
      monthlyLimit: v.optional(v.number()), // max requests per calendar month
      quota: v.optional(v.number()), // lifetime credit budget
      expiresAt: v.optional(v.number()), // key expiry (ms epoch)
      webhookSecretHash: v.optional(v.string()), // sha-256 of webhook secret
      webhookSecretPrefix: v.optional(v.string()), // e.g. "whsec_ab12…"
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_keyHash", ["keyHash"]),

    // STEP 04 · Per-provider circuit breaker state.
    circuitState: defineTable({
      provider: v.string(),
      state: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")),
      failures: v.number(),
      successCount: v.number(),
      openedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_provider", ["provider"]),

    // STEP 03 · Audit trail for key / role / org events.
    auditLogs: defineTable({
      userId: v.id("users"),
      action: v.string(), // e.g. "key.created", "key.rotated", "role.changed"
      targetType: v.string(), // "apiKey" | "user" | "organization"
      targetId: v.optional(v.string()),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user_created", ["userId", "createdAt"]),

    // STEP 02 · Organization & Team
    organizations: defineTable({
      name: v.string(),
      slug: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_createdBy", ["createdBy"]),

    organizationMembers: defineTable({
      orgId: v.id("organizations"),
      userId: v.id("users"),
      role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
      email: v.optional(v.string()),
      addedBy: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_user", ["userId"])
      .index("by_org_user", ["orgId", "userId"]),

    // STEP 02 · Email verification tokens (hashed, expiring)
    emailVerifications: defineTable({
      userId: v.id("users"),
      email: v.string(),
      tokenHash: v.string(),
      expiresAt: v.number(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // STEP 02 · Rate limiting (fixed-window counters)
    rateLimits: defineTable({
      key: v.string(), // "<name>:<bucket>:<subject>"
      count: v.number(),
      createdAt: v.number(),
    }).index("by_key", ["key"]),

    // STEP 05 · Provider SDK jobs — one row per generate() call.
    providerJobs: defineTable({
      userId: v.id("users"),
      provider: v.string(),
      model: v.string(),
      prompt: v.string(),
      imageName: v.optional(v.string()),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      durationMs: v.number(),
      outputText: v.optional(v.string()),
      outputUrl: v.optional(v.string()),
      error: v.optional(v.string()),
      attempts: v.optional(v.number()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_provider_status", ["provider", "status"]),

    // STEP 05 · Provider SDK webhook signing secrets (per provider).
    // The raw secret is stored so inbound webhook signatures can be verified
    // (like Stripe); it is only ever shown once in the console.
    providerWebhookSecrets: defineTable({
      userId: v.id("users"),
      provider: v.string(),
      secret: v.string(), // e.g. "whsec_…"
      secretPrefix: v.string(), // e.g. "whsec_ab12…"
      createdAt: v.number(),
    })
      .index("by_user_provider", ["userId", "provider"])
      .index("by_user", ["userId"]),

    // STEP 06 · Text → 3D module — one row per submitted task.
    text3dTasks: defineTable({
      userId: v.id("users"),
      provider: v.string(), // meshy | tripo | hunyuan3d
      model: v.string(),
      prompt: v.string(),
      optimizedPrompt: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      durationMs: v.number(),
      attempts: v.number(),
      error: v.optional(v.string()),
      glbUrl: v.optional(v.string()),
      fbxUrl: v.optional(v.string()),
      objUrl: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_provider_status", ["provider", "status"]),

    // STEP 07 · Image → 3D module — one row per submitted image task.
    image3dTasks: defineTable({
      userId: v.id("users"),
      provider: v.string(), // meshy | tripo | hunyuan3d
      model: v.string(),
      imageName: v.string(),
      imageUrl: v.string(), // downscaled data URL of the upload
      width: v.number(),
      height: v.number(),
      caption: v.string(), // vision caption (simulated pipeline)
      optimizedPrompt: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      durationMs: v.number(),
      attempts: v.number(),
      error: v.optional(v.string()),
      previewUrl: v.optional(v.string()),
      glbUrl: v.optional(v.string()),
      fbxUrl: v.optional(v.string()),
      objUrl: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_provider_status", ["provider", "status"]),

    // STEP 08 · Text → Video module — one row per submitted render task.
    textVideoTasks: defineTable({
      userId: v.id("users"),
      provider: v.string(), // runway | luma | pika
      model: v.string(),
      prompt: v.string(),
      optimizedPrompt: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      durationMs: v.number(),
      attempts: v.number(),
      error: v.optional(v.string()),
      // video specifics
      progress: v.number(), // 0..100 render progress
      framesRendered: v.number(),
      totalFrames: v.number(),
      fps: v.number(),
      seconds: v.number(),
      streaming: v.boolean(), // chunks delivered as frames render
      previewUrl: v.optional(v.string()), // poster frame
      outputUrl: v.optional(v.string()), // mp4 clip
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_provider_status", ["provider", "status"]),

    // STEP 08 · Image → Video module — one row per submitted render task.
    imageVideoTasks: defineTable({
      userId: v.id("users"),
      provider: v.string(), // runway | luma | pika
      model: v.string(),
      prompt: v.string(), // motion prompt
      optimizedPrompt: v.string(),
      imageName: v.string(),
      imageUrl: v.string(), // downscaled data URL of the still
      width: v.number(),
      height: v.number(),
      caption: v.string(), // vision caption of the still
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      durationMs: v.number(),
      attempts: v.number(),
      error: v.optional(v.string()),
      // video specifics
      progress: v.number(), // 0..100 render progress
      framesRendered: v.number(),
      totalFrames: v.number(),
      fps: v.number(),
      seconds: v.number(),
      streaming: v.boolean(),
      previewUrl: v.optional(v.string()),
      outputUrl: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_provider_status", ["provider", "status"]),

    // STEP 09 · Storage service — registered objects (S3-compatible buckets).
    storageObjects: defineTable({
      userId: v.id("users"),
      url: v.string(), // s3://atelier-assets/<bucket>/<key>
      bucket: v.string(),
      key: v.string(),
      kind: v.string(), // image | video | glb | preview | other
      sizeBytes: v.number(),
      source: v.string(), // text3d | image3d | textVideo | imageVideo | sdk | manual
      createdAt: v.number(),
      accessedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_bucket", ["userId", "bucket"])
      .index("by_user_url", ["userId", "url"]),

    // STEP 09 · Storage cache — per-kind tiers (image · video · glb · preview).
    storageCache: defineTable({
      userId: v.id("users"),
      key: v.string(), // "<bucket>/<key>"
      url: v.string(),
      bucket: v.string(),
      kind: v.string(), // image | video | glb | preview | other
      sizeBytes: v.number(),
      hits: v.number(),
      lastAccessAt: v.optional(v.number()),
      expiresAt: v.number(),
      createdAt: v.number(),
      evicted: v.boolean(),
    })
      .index("by_user_kind", ["userId", "kind"])
      .index("by_user_key", ["userId", "key"])
      .index("by_user_created", ["userId", "createdAt"]),

    // STEP 10 · Queue system — jobs (Redis/Celery-style priority queue).
    queueJobs: defineTable({
      userId: v.id("users"),
      queue: v.string(), // gateway | text3d | image3d | video | sdk | storage
      priority: v.union(v.literal("high"), v.literal("normal"), v.literal("low")),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("dead"),
      ),
      attempts: v.number(),
      maxAttempts: v.number(),
      payload: v.string(),
      createdAt: v.number(),
      dueAt: v.number(),
      claimedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      backoffMs: v.number(),
      forceFailure: v.optional(v.boolean()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_user_queue", ["userId", "queue"]),

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
      // STEP 04 · gateway mechanics
      stream: v.optional(v.boolean()), // deliver the response in chunks
      simulateFailure: v.optional(v.boolean()), // dev tool: force provider outage
      attempts: v.optional(v.number()), // provider attempts taken
      events: v.optional(
        v.array(
          v.object({
            stage: v.string(), // accepted|queued|dequeued|attempt|retry|chunk|completed|failed
            at: v.number(),
            detail: v.optional(v.string()),
          }),
        ),
      ),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_apiKey_created", ["apiKeyId", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
