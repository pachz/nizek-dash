import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { nizekId: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!task) return null;
    const project = await ctx.db
      .query("projects")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", task.projectId))
      .unique();
    let extras: {
      questions: Array<{ question: string; answer: string }>;
      attachments: Array<{ name: string; url: string }>;
      comments: Array<{
        author: string;
        body: string;
        at?: string | null;
        imageUrl?: string | null;
      }>;
      proofOfWork: Array<{
        name: string;
        url?: string | null;
        author?: string | null;
        at?: string | null;
      }>;
      activity: Array<{
        action: string;
        author: string;
        summary: string;
        at?: string | null;
      }>;
    } | null = null;
    if (task.detailExtras) {
      try {
        extras = JSON.parse(task.detailExtras) as NonNullable<typeof extras>;
      } catch {
        extras = null;
      }
    }
    return {
      ...task,
      projectName: project?.name ?? task.projectId,
      projectColor: project?.color ?? "#64748b",
      teamName: project?.teamName ?? null,
      panelUrl: `https://panel.nizek.com/dashboard/projects/${task.projectId}/tasks/${task.nizekId}`,
      extras,
    };
  },
});

/** Cache Panel-parsed extras (Q&A, attachments, comments, activity). */
export const saveExtras = mutation({
  args: {
    nizekId: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    extrasJson: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!task) throw new Error("Task not found");
    // Validate JSON shape lightly
    JSON.parse(args.extrasJson);
    await ctx.db.patch(task._id, {
      detailExtras: args.extrasJson,
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
    });
    return { ok: true as const };
  },
});

export const listForBoard = query({
  args: {
    search: v.optional(v.string()),
    stages: v.optional(v.array(v.string())),
    types: v.optional(v.array(v.string())),
    priorities: v.optional(v.array(v.string())),
    assignees: v.optional(v.array(v.string())),
    activeSprintOnly: v.optional(v.boolean()),
    /** Client-side project filter. When omitted, all synced projects are included. */
    projectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db.query("projects").take(100);
    const enabled =
      args.projectIds !== undefined
        ? new Set(args.projectIds)
        : new Set(projects.map((p) => p.nizekId));
    const projectMeta = new Map(
      projects.map((p) => [
        p.nizekId,
        { name: p.name, color: p.color, teamName: p.teamName },
      ]),
    );

    // Cap read — board is a finite set of team tasks
    const tasks = await ctx.db.query("tasks").take(2000);
    const search = args.search?.trim().toLowerCase() ?? "";
    const stageSet = args.stages?.length ? new Set(args.stages) : null;
    const typeSet = args.types?.length ? new Set(args.types) : null;
    const prioritySet = args.priorities?.length
      ? new Set(args.priorities)
      : null;
    const assigneeSet = args.assignees?.length
      ? new Set(args.assignees)
      : null;

    const filtered = tasks.filter((t) => {
      if (!enabled.has(t.projectId)) return false;
      if (stageSet && !stageSet.has(t.stage)) return false;
      if (typeSet && !typeSet.has(t.taskType)) return false;
      if (prioritySet && !prioritySet.has(t.priority)) return false;
      if (assigneeSet) {
        const key = t.assigneeName ?? "Unassigned";
        if (!assigneeSet.has(key)) return false;
      }
      if (args.activeSprintOnly) {
        const st = t.sprintStatus;
        if (st !== "ACTIVE" && st !== "IN_PROGRESS") return false;
      }
      if (search) {
        const hay = `${t.title} ${t.taskNumber} ${t.assigneeName ?? ""} ${projectMeta.get(t.projectId)?.name ?? ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return filtered
      .map((t) => ({
        ...t,
        projectName: projectMeta.get(t.projectId)?.name ?? t.projectId,
        projectColor: projectMeta.get(t.projectId)?.color ?? "#64748b",
        teamName: projectMeta.get(t.projectId)?.teamName ?? null,
      }))
      .sort((a, b) => a.order - b.order || a.taskNumber - b.taskNumber);
  },
});

export const filterOptions = query({
  args: {
    projectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db.query("projects").take(100);
    const enabled =
      args.projectIds !== undefined
        ? new Set(args.projectIds)
        : new Set(projects.map((p) => p.nizekId));
    const tasks = await ctx.db.query("tasks").take(2000);
    const relevant = tasks.filter((t) => enabled.has(t.projectId));
    return {
      stages: [...new Set(relevant.map((t) => t.stage))].sort(),
      types: [...new Set(relevant.map((t) => t.taskType))].sort(),
      priorities: [...new Set(relevant.map((t) => t.priority))].sort(),
      assignees: [
        ...new Set(relevant.map((t) => t.assigneeName ?? "Unassigned")),
      ].sort(),
    };
  },
});
