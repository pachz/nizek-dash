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

/**
 * Upsert Panel projects/tasks. Never hard-deletes — rows missing from the
 * payload are soft-deleted (`deletedAt`). Returning rows clear `deletedAt`.
 * Preserves local-only fields like `tasks.detailExtras`.
 */
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
    const now = Date.now();
    const seenProjects = new Set<string>();
    const seenTasks = new Set<string>();

    for (const p of args.projects) {
      seenProjects.add(p.nizekId);
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", p.nizekId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...p,
          deletedAt: undefined,
        });
      } else {
        await ctx.db.insert("projects", p);
      }
    }

    const oldProjects = await ctx.db.query("projects").take(200);
    for (const p of oldProjects) {
      if (!seenProjects.has(p.nizekId) && p.deletedAt == null) {
        await ctx.db.patch(p._id, { deletedAt: now });
      }
    }

    for (const t of args.tasks) {
      seenTasks.add(t.nizekId);
      const existing = await ctx.db
        .query("tasks")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", t.nizekId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...t,
          deletedAt: undefined,
        });
      } else {
        await ctx.db.insert("tasks", t);
      }
    }

    const oldTasks = await ctx.db.query("tasks").take(5000);
    for (const t of oldTasks) {
      if (!seenTasks.has(t.nizekId) && t.deletedAt == null) {
        await ctx.db.patch(t._id, { deletedAt: now });
      }
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

export const patchTask = internalMutation({
  args: {
    nizekId: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    title: v.optional(v.string()),
    stage: v.optional(v.string()),
    priority: v.optional(v.string()),
    estimatedMinutes: v.optional(v.union(v.number(), v.null())),
    assigneeName: v.optional(v.union(v.string(), v.null())),
    assigneeImage: v.optional(v.union(v.string(), v.null())),
    sprintName: v.optional(v.union(v.string(), v.null())),
    sprintStatus: v.optional(v.union(v.string(), v.null())),
    stageEnteredAt: v.optional(v.union(v.string(), v.null())),
    startedAt: v.optional(v.union(v.string(), v.null())),
    detailExtras: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!task) return null;
    const cleaned: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(args)) {
      if (k === "nizekId" || val === undefined) continue;
      cleaned[k] = val;
    }
    if (Object.keys(cleaned).length === 0) return task._id;
    await ctx.db.patch(task._id, cleaned);
    return task._id;
  },
});
