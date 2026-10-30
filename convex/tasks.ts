import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isLive } from "./lib/softDelete";

export const get = query({
  args: { nizekId: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!task || !isLive(task)) return null;
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
    if (!task || !isLive(task)) throw new Error("Task not found");
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
    const projects = (await ctx.db.query("projects").take(200)).filter(isLive);
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
    const tasks = (await ctx.db.query("tasks").take(5000)).filter(isLive);
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
    const projects = (await ctx.db.query("projects").take(200)).filter(isLive);
    const enabled =
      args.projectIds !== undefined
        ? new Set(args.projectIds)
        : new Set(projects.map((p) => p.nizekId));
    const tasks = (await ctx.db.query("tasks").take(5000)).filter(isLive);
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

const RELEASE_STAGES = new Set(["DONE", "SHIPPED", "COMPLETED"]);

function isMainishBranch(name: string) {
  const n = name.toLowerCase();
  return n === "main" || n === "master";
}

/** Commit is on main (or master / default production branch). */
function onMainBranch(branches: string[], defaultBranch?: string) {
  if (branches.some(isMainishBranch)) return true;
  if (defaultBranch && isMainishBranch(defaultBranch)) {
    return branches.includes(defaultBranch);
  }
  return false;
}

/**
 * Release bundle: finished tasks in the window + commits that landed on main
 * for repos linked to the project. Tasks matched to those main commits are
 * included even if their stage date is outside the window.
 */
export const listForRelease = query({
  args: {
    projectId: v.string(),
    fromIso: v.string(),
    toIso: v.string(),
    /** When true, keep finished tasks that have no usable date. */
    includeUndated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const empty = {
      tasks: [] as Array<{
        nizekId: string;
        projectId: string;
        projectName: string;
        projectColor: string;
        teamName: string | null;
        title: string;
        description: string | null;
        taskNumber: number;
        taskType: string;
        stage: string;
        priority: string;
        assigneeName: string | null;
        sprintName: string | null;
        stageEnteredAt: string | null;
        startedAt: string | null;
        viaMainCommit: boolean;
      }>,
      commits: [] as Array<{
        _id: string;
        sha: string;
        message: string;
        subject: string;
        authorName: string;
        authoredAt: string;
        htmlUrl: string;
        repoFullName: string;
        branches: string[];
        matchedTasks: Array<{
          taskNizekId: string;
          taskTitle?: string;
          taskCode?: string;
          status: "accepted" | "suggested";
          confidence: number;
        }>;
      }>,
    };

    const project = await ctx.db
      .query("projects")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.projectId))
      .unique();
    if (!project || !isLive(project)) return empty;

    const fromMs = Date.parse(args.fromIso);
    const toMs = Date.parse(args.toIso);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return empty;

    const includeUndated = args.includeUndated === true;
    const fromIso = args.fromIso;
    const toIso = args.toIso;

    const repos = (await ctx.db.query("gitRepos").take(200)).filter(
      (r) => isLive(r) && r.projectIds.includes(args.projectId),
    );
    const repoMap = new Map(repos.map((r) => [r._id, r]));

    const commitRows = (
      await ctx.db
        .query("commits")
        .withIndex("by_authoredAt")
        .order("desc")
        .take(4000)
    ).filter(isLive);

    type MatchInfo = {
      taskNizekId: string;
      taskTitle?: string;
      taskCode?: string;
      status: "accepted" | "suggested";
      confidence: number;
    };

    const mainCommits: Array<{
      _id: string;
      sha: string;
      message: string;
      subject: string;
      authorName: string;
      authoredAt: string;
      htmlUrl: string;
      repoFullName: string;
      branches: string[];
      matchedTasks: MatchInfo[];
    }> = [];

    const matchedTaskIds = new Set<string>();

    for (const c of commitRows) {
      if (c.authoredAt < fromIso || c.authoredAt > toIso) continue;
      const repo = repoMap.get(c.repoId);
      if (!repo) continue;
      if (!onMainBranch(c.branches, repo.defaultBranch)) continue;

      const matchRows = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(30);

      const matchedTasks: MatchInfo[] = [];
      for (const m of matchRows) {
        if (!isLive(m) || m.status === "rejected") continue;
        if (m.projectId !== args.projectId) continue;
        const task = await ctx.db
          .query("tasks")
          .withIndex("by_nizekId", (q) => q.eq("nizekId", m.taskNizekId))
          .unique();
        if (task && !isLive(task)) continue;
        const prefix =
          task?.taskType === "BUG"
            ? "B"
            : task?.taskType === "ENHANCEMENT"
              ? "E"
              : task?.taskType === "FEATURE"
                ? "F"
                : "T";
        matchedTasks.push({
          taskNizekId: m.taskNizekId,
          taskTitle: task?.title,
          taskCode: task
            ? `${prefix}-${String(task.taskNumber).padStart(3, "0")}`
            : undefined,
          status: m.status === "accepted" ? "accepted" : "suggested",
          confidence: m.confidence,
        });
        matchedTaskIds.add(m.taskNizekId);
      }

      const subject = c.message.split("\n")[0]?.trim() || "(empty)";
      mainCommits.push({
        _id: c._id,
        sha: c.sha,
        message: c.message,
        subject,
        authorName: c.authorName,
        authoredAt: c.authoredAt,
        htmlUrl: c.htmlUrl,
        repoFullName: repo.fullName,
        branches: c.branches,
        matchedTasks,
      });
    }

    const projectTasks = (
      await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(2000)
    ).filter(isLive);

    const taskById = new Map(projectTasks.map((t) => [t.nizekId, t]));

    type ReleaseTaskRow = (typeof empty)["tasks"][number];
    const taskMap = new Map<string, ReleaseTaskRow>();

    const mapTask = (
      t: (typeof projectTasks)[number],
      viaMainCommit: boolean,
    ): ReleaseTaskRow => ({
      nizekId: t.nizekId,
      projectId: t.projectId,
      projectName: project.name,
      projectColor: project.color,
      teamName: project.teamName ?? null,
      title: t.title,
      description: t.description ?? null,
      taskNumber: t.taskNumber,
      taskType: t.taskType,
      stage: t.stage,
      priority: t.priority,
      assigneeName: t.assigneeName ?? null,
      sprintName: t.sprintName ?? null,
      stageEnteredAt: t.stageEnteredAt ?? null,
      startedAt: t.startedAt ?? null,
      viaMainCommit,
    });

    for (const t of projectTasks) {
      if (!RELEASE_STAGES.has(t.stage)) continue;
      const raw = t.stageEnteredAt ?? t.startedAt ?? null;
      let inWindow = false;
      if (!raw) {
        inWindow = includeUndated;
      } else {
        const ms = Date.parse(raw);
        inWindow = Number.isNaN(ms)
          ? includeUndated
          : ms >= fromMs && ms <= toMs;
      }
      if (!inWindow) continue;
      taskMap.set(t.nizekId, mapTask(t, false));
    }

    for (const id of matchedTaskIds) {
      const t = taskById.get(id);
      if (!t) continue;
      const existing = taskMap.get(id);
      if (existing) {
        taskMap.set(id, { ...existing, viaMainCommit: true });
      } else {
        taskMap.set(id, mapTask(t, true));
      }
    }

    const tasks = [...taskMap.values()].sort((a, b) => {
      const typeRank = (type: string) =>
        type === "FEATURE"
          ? 0
          : type === "ENHANCEMENT"
            ? 1
            : type === "BUG"
              ? 2
              : 3;
      const tr = typeRank(a.taskType) - typeRank(b.taskType);
      if (tr !== 0) return tr;
      return a.taskNumber - b.taskNumber;
    });

    return { tasks, commits: mainCommits };
  },
});
