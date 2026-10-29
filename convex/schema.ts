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
  }).index("by_key", ["key"]),

  projects: defineTable({
    nizekId: v.string(),
    name: v.string(),
    teamName: v.optional(v.string()),
    enabled: v.boolean(),
    taskCount: v.number(),
    color: v.string(),
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
  })
    .index("by_commit", ["commitId"])
    .index("by_task", ["taskNizekId"])
    .index("by_status", ["status"])
    .index("by_commit_task", ["commitId", "taskNizekId"]),
});
