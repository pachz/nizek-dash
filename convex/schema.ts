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
  })
    .index("by_nizekId", ["nizekId"])
    .index("by_project", ["projectId"])
    .index("by_stage", ["stage"]),
});
