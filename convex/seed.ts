import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { colorForId } from "./lib/parse";

export const importExport = mutation({
  args: {
    projects: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        teamName: v.optional(v.union(v.string(), v.null())),
        taskCount: v.optional(v.number()),
        enabled: v.optional(v.boolean()),
      }),
    ),
    tasks: v.array(
      v.object({
        id: v.string(),
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
        projectId: v.string(),
        sprintId: v.optional(v.union(v.string(), v.null())),
        sprintName: v.optional(v.union(v.string(), v.null())),
        sprintStatus: v.optional(v.union(v.string(), v.null())),
        stageEnteredAt: v.optional(v.union(v.string(), v.null())),
        startedAt: v.optional(v.union(v.string(), v.null())),
      }),
    ),
    user: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingProjects = await ctx.db.query("projects").take(200);
    for (const p of existingProjects) await ctx.db.delete(p._id);
    const existingTasks = await ctx.db.query("tasks").take(5000);
    for (const t of existingTasks) await ctx.db.delete(t._id);

    for (const p of args.projects) {
      await ctx.db.insert("projects", {
        nizekId: p.id,
        name: p.name.startsWith("cm") ? p.name : p.name,
        teamName: p.teamName ?? undefined,
        enabled: p.enabled ?? true,
        taskCount: p.taskCount ?? 0,
        color: colorForId(p.id),
      });
    }

    for (const t of args.tasks) {
      await ctx.db.insert("tasks", {
        nizekId: t.id,
        projectId: t.projectId,
        title: t.title,
        description: t.description ?? null,
        taskNumber: t.taskNumber,
        taskType: t.taskType,
        stage: t.stage,
        order: t.order,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes ?? null,
        assigneeId: t.assigneeId ?? null,
        assigneeName: t.assigneeName ?? null,
        assigneeImage: t.assigneeImage ?? null,
        sprintId: t.sprintId ?? null,
        sprintName: t.sprintName ?? null,
        sprintStatus: t.sprintStatus ?? null,
        stageEnteredAt: t.stageEnteredAt ?? null,
        startedAt: t.startedAt ?? null,
      });
    }

    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch = {
      sessionName: args.user?.name,
      sessionEmail: args.user?.email,
      lastSyncAt: Date.now(),
      lastError: undefined,
    };
    if (settings) await ctx.db.patch(settings._id, patch);
    else
      await ctx.db.insert("settings", {
        key: "main",
        ...patch,
        deviceId: crypto.randomUUID(),
      });

    return { projects: args.projects.length, tasks: args.tasks.length };
  },
});
