import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const patchSettings = internalMutation({
  args: {
    cookieHeader: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    centrifugoToken: v.optional(v.string()),
    centrifugoExpiresAt: v.optional(v.number()),
    centrifugoSub: v.optional(v.string()),
    sessionEmail: v.optional(v.string()),
    sessionName: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastRotateAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch: Record<string, unknown> = { ...args };
    if (args.lastError === null) patch.lastError = undefined;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("settings", {
      key: "main",
      deviceId: args.deviceId ?? crypto.randomUUID(),
      ...patch,
    });
  },
});

export const replaceAll = internalMutation({
  args: {
    projects: v.array(
      v.object({
        nizekId: v.string(),
        name: v.string(),
        teamName: v.optional(v.string()),
        enabled: v.boolean(),
        taskCount: v.number(),
        color: v.string(),
      }),
    ),
    tasks: v.array(
      v.object({
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
      }),
    ),
  },
  handler: async (ctx, args) => {
    const oldProjects = await ctx.db.query("projects").take(200);
    for (const p of oldProjects) await ctx.db.delete(p._id);
    const oldTasks = await ctx.db.query("tasks").take(5000);
    for (const t of oldTasks) await ctx.db.delete(t._id);

    for (const p of args.projects) {
      await ctx.db.insert("projects", p);
    }
    for (const t of args.tasks) {
      await ctx.db.insert("tasks", t);
    }
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (settings) {
      await ctx.db.patch(settings._id, {
        lastSyncAt: Date.now(),
        lastError: undefined,
      });
    }
  },
});
