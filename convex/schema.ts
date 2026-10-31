import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  settings: defineTable({
    key: v.literal("main"),
    cookieHeader: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    centrifugoToken: v.optional(v.string()),
    centrifugoExpiresAt: v.optional(v.number()),
    centrifugoSub: v.optional(v.string()),
    sessionEmail: v.optional(v.string()),
    sessionName: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastRotateAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    githubToken: v.optional(v.string()),
    lastCommitSyncAt: v.optional(v.number()),
    lastCommitError: v.optional(v.string()),
    lastMatchAt: v.optional(v.number()),
    lastMatchError: v.optional(v.string()),
    lastChatSyncAt: v.optional(v.number()),
    lastChatError: v.optional(v.string()),
  }).index("by_key", ["key"]),

  projects: defineTable({
    nizekId: v.string(),
    name: v.string(),
    teamName: v.optional(v.string()),
    enabled: v.boolean(),
    taskCount: v.number(),
    color: v.string(),
    /** Soft-delete — set on sync when missing from Panel; never hard-deleted. */
    deletedAt: v.optional(v.number()),
  }).index("by_nizekId", ["nizekId"]),

  tasks: defineTable({
    nizekId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    taskNumber: v.number(),
    taskType: v.string(),
    stage: v.string(),
    order: v.number(),
    priority: v.string(),
    estimatedMinutes: v.optional(v.union(v.number(), v.null())),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    assigneeName: v.optional(v.union(v.string(), v.null())),
    assigneeImage: v.optional(v.union(v.string(), v.null())),
    sprintId: v.optional(v.union(v.string(), v.null())),
    sprintName: v.optional(v.union(v.string(), v.null())),
    sprintStatus: v.optional(v.union(v.string(), v.null())),
    stageEnteredAt: v.optional(v.union(v.string(), v.null())),
    startedAt: v.optional(v.union(v.string(), v.null())),
    /** JSON blob: questions, attachments, comments, proofOfWork, activity */
    detailExtras: v.optional(v.string()),
    /** Soft-delete — set on sync when missing from Panel; never hard-deleted. */
    deletedAt: v.optional(v.number()),
  })
    .index("by_nizekId", ["nizekId"])
    .index("by_project", ["projectId"])
    .index("by_stage", ["stage"]),

  gitRepos: defineTable({
    owner: v.string(),
    name: v.string(),
    fullName: v.string(),
    enabled: v.boolean(),
    projectIds: v.array(v.string()),
    defaultBranch: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** ISO timestamp cursor — commits authored after this are fetched next */
    syncSince: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  }).index("by_fullName", ["fullName"]),

  commits: defineTable({
    repoId: v.id("gitRepos"),
    sha: v.string(),
    message: v.string(),
    authorName: v.string(),
    authorEmail: v.optional(v.string()),
    authoredAt: v.string(),
    htmlUrl: v.string(),
    branches: v.array(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_repo_sha", ["repoId", "sha"])
    .index("by_repo_authoredAt", ["repoId", "authoredAt"])
    .index("by_authoredAt", ["authoredAt"]),

  commitMatches: defineTable({
    commitId: v.id("commits"),
    taskNizekId: v.string(),
    projectId: v.string(),
    confidence: v.number(),
    reason: v.string(),
    method: v.union(v.literal("heuristic"), v.literal("ai")),
    status: v.union(
      v.literal("suggested"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    model: v.optional(v.string()),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_commit", ["commitId"])
    .index("by_task", ["taskNizekId"])
    .index("by_status", ["status"])
    .index("by_commit_task", ["commitId", "taskNizekId"]),

  chatThreads: defineTable({
    threadKey: v.string(),
    kind: v.string(),
    name: v.string(),
    subtitle: v.optional(v.union(v.string(), v.null())),
    projectId: v.optional(v.union(v.string(), v.null())),
    conversationId: v.optional(v.union(v.string(), v.null())),
    logoUrl: v.optional(v.union(v.string(), v.null())),
    peerImageUrl: v.optional(v.union(v.string(), v.null())),
    lastMessage: v.optional(v.union(v.string(), v.null())),
    lastAuthor: v.optional(v.union(v.string(), v.null())),
    lastAt: v.optional(v.union(v.string(), v.null())),
    unread: v.number(),
    avatar: v.optional(v.union(v.string(), v.null())),
    initials: v.optional(v.union(v.string(), v.null())),
    inactive: v.optional(v.boolean()),
    readOnly: v.optional(v.boolean()),
    syncedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_threadKey", ["threadKey"])
    .index("by_lastAt", ["lastAt"]),

  chatMessages: defineTable({
    nizekId: v.string(),
    threadKey: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    authorImageUrl: v.optional(v.union(v.string(), v.null())),
    body: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    edited: v.boolean(),
    replyToId: v.optional(v.union(v.string(), v.null())),
    /** JSON: ChatAttachment[] */
    attachmentsJson: v.string(),
    /** JSON: ChatReaction[] */
    reactionsJson: v.string(),
    kind: v.string(),
    important: v.boolean(),
    /** JSON blob for task / activity extras */
    extrasJson: v.optional(v.string()),
    syncedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_nizekId", ["nizekId"])
    .index("by_thread_createdAt", ["threadKey", "createdAt"])
    .index("by_thread", ["threadKey"])
    .index("by_createdAt", ["createdAt"]),

  /** Cached AI digests keyed by business-day window. */
  summaries: defineTable({
    windowKey: v.string(),
    fromIso: v.string(),
    toIso: v.string(),
    days: v.array(v.string()),
    headline: v.string(),
    narrative: v.string(),
    /** Full structured SummaryPayload JSON */
    payloadJson: v.string(),
    statsJson: v.string(),
    model: v.string(),
    generatedAt: v.number(),
    /** Counts fed into the model / KPIs */
    inputCounts: v.object({
      commits: v.number(),
      messages: v.number(),
      tasks: v.number(),
      projects: v.number(),
    }),
  }).index("by_windowKey", ["windowKey"]),
});
