import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { isLive } from "./lib/softDelete";
import { taskCode } from "./lib/taskCode";
import {
  BUSINESS_TZ,
  lastBusinessDays,
} from "./lib/businessDays";

const COMMIT_CAP = 150;
const MESSAGE_CAP = 120;
const TASK_CAP = 100;
const BODY_CHARS = 400;

export type GatheredCommit = {
  sha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  repoFullName: string;
  matchedTask?: string;
};

export type GatheredMessage = {
  authorName: string;
  body: string;
  createdAt: string;
  threadName: string;
  threadKind: string;
  projectId: string | null;
  important: boolean;
};

export type GatheredTask = {
  code: string;
  title: string;
  stage: string;
  projectName: string;
  assigneeName: string | null;
  stageEnteredAt: string | null;
  viaCommit: boolean;
};

export type GatherPayload = {
  fromIso: string;
  toIso: string;
  commits: GatheredCommit[];
  messages: GatheredMessage[];
  tasks: GatheredTask[];
  counts: {
    commits: number;
    messages: number;
    tasks: number;
    projects: number;
  };
};

function subjectOf(message: string) {
  return message.split("\n")[0]?.trim() || "(empty)";
}

function truncate(text: string, max: number) {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function inIsoWindow(iso: string | null | undefined, fromIso: string, toIso: string) {
  if (!iso) return false;
  return iso >= fromIso && iso <= toIso;
}

export const currentWindow = query({
  args: {},
  handler: async () => lastBusinessDays({ count: 2, timeZone: BUSINESS_TZ }),
});

export const getCached = query({
  args: { windowKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("summaries")
      .withIndex("by_windowKey", (q) => q.eq("windowKey", args.windowKey))
      .unique();
    if (!row) return null;
    return {
      windowKey: row.windowKey,
      fromIso: row.fromIso,
      toIso: row.toIso,
      days: row.days,
      headline: row.headline,
      narrative: row.narrative,
      payloadJson: row.payloadJson,
      statsJson: row.statsJson,
      model: row.model,
      generatedAt: row.generatedAt,
      inputCounts: row.inputCounts,
    };
  },
});

export const getCachedInternal = internalQuery({
  args: { windowKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("summaries")
      .withIndex("by_windowKey", (q) => q.eq("windowKey", args.windowKey))
      .unique();
  },
});

export const saveSummary = internalMutation({
  args: {
    windowKey: v.string(),
    fromIso: v.string(),
    toIso: v.string(),
    days: v.array(v.string()),
    headline: v.string(),
    narrative: v.string(),
    payloadJson: v.string(),
    statsJson: v.string(),
    model: v.string(),
    generatedAt: v.number(),
    inputCounts: v.object({
      commits: v.number(),
      messages: v.number(),
      tasks: v.number(),
      projects: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_windowKey", (q) => q.eq("windowKey", args.windowKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        fromIso: args.fromIso,
        toIso: args.toIso,
        days: args.days,
        headline: args.headline,
        narrative: args.narrative,
        payloadJson: args.payloadJson,
        statsJson: args.statsJson,
        model: args.model,
        generatedAt: args.generatedAt,
        inputCounts: args.inputCounts,
      });
      return existing._id;
    }
    return await ctx.db.insert("summaries", args);
  },
});

export const gatherForWindow = internalQuery({
  args: {
    fromIso: v.string(),
    toIso: v.string(),
  },
  handler: async (ctx, args): Promise<GatherPayload> => {
    const { fromIso, toIso } = args;

    const projects = (await ctx.db.query("projects").take(500)).filter(isLive);
    const projectName = new Map(projects.map((p) => [p.nizekId, p.name]));

    const repos = (await ctx.db.query("gitRepos").take(200)).filter(isLive);
    const repoName = new Map(repos.map((r) => [r._id, r.fullName]));

    const commitRows = (
      await ctx.db
        .query("commits")
        .withIndex("by_authoredAt", (q) =>
          q.gte("authoredAt", fromIso).lte("authoredAt", toIso),
        )
        .order("desc")
        .take(COMMIT_CAP * 2)
    ).filter(isLive);

    const commitsOut: GatheredCommit[] = [];
    const matchedTaskIds = new Set<string>();
    const projectIds = new Set<string>();

    for (const c of commitRows) {
      if (commitsOut.length >= COMMIT_CAP) break;
      let matchedTask: string | undefined;
      const matches = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(20);
      for (const m of matches) {
        if (!isLive(m) || m.status === "rejected") continue;
        matchedTaskIds.add(m.taskNizekId);
        projectIds.add(m.projectId);
        if (!matchedTask) {
          const task = await ctx.db
            .query("tasks")
            .withIndex("by_nizekId", (q) => q.eq("nizekId", m.taskNizekId))
            .unique();
          if (task && isLive(task)) {
            matchedTask = `${taskCode(task.taskType, task.taskNumber)} ${task.title}`;
          }
        }
      }
      const fullName = repoName.get(c.repoId);
      if (fullName) {
        const repo = repos.find((r) => r._id === c.repoId);
        for (const pid of repo?.projectIds ?? []) projectIds.add(pid);
      }
      commitsOut.push({
        sha: c.sha.slice(0, 7),
        subject: subjectOf(c.message),
        authorName: c.authorName,
        authoredAt: c.authoredAt,
        repoFullName: fullName ?? "unknown",
        matchedTask,
      });
    }

    const threads = (await ctx.db.query("chatThreads").take(500)).filter(isLive);
    const threadMeta = new Map(
      threads.map((t) => [
        t.threadKey,
        {
          name: t.name,
          kind: t.kind,
          projectId: t.projectId ?? null,
        },
      ]),
    );

    const messageRows = (
      await ctx.db
        .query("chatMessages")
        .withIndex("by_createdAt", (q) =>
          q.gte("createdAt", fromIso).lte("createdAt", toIso),
        )
        .order("desc")
        .take(MESSAGE_CAP * 2)
    ).filter(isLive);

    const messagesOut: GatheredMessage[] = [];
    for (const m of messageRows) {
      if (messagesOut.length >= MESSAGE_CAP) break;
      const meta = threadMeta.get(m.threadKey);
      if (meta?.projectId) projectIds.add(meta.projectId);
      messagesOut.push({
        authorName: m.authorName,
        body: truncate(m.body, BODY_CHARS),
        createdAt: m.createdAt,
        threadName: meta?.name ?? m.threadKey,
        threadKind: meta?.kind ?? "unknown",
        projectId: meta?.projectId ?? null,
        important: m.important,
      });
    }

    const allTasks = (await ctx.db.query("tasks").take(4000)).filter(isLive);
    const taskMap = new Map<
      string,
      GatheredTask & { sortAt: string }
    >();

    for (const t of allTasks) {
      const stamp = t.stageEnteredAt ?? t.startedAt ?? null;
      if (!inIsoWindow(stamp, fromIso, toIso)) continue;
      projectIds.add(t.projectId);
      taskMap.set(t.nizekId, {
        code: taskCode(t.taskType, t.taskNumber),
        title: t.title,
        stage: t.stage,
        projectName: projectName.get(t.projectId) ?? t.projectId.slice(0, 8),
        assigneeName: t.assigneeName ?? null,
        stageEnteredAt: stamp,
        viaCommit: false,
        sortAt: stamp ?? "",
      });
    }

    for (const id of matchedTaskIds) {
      const t = allTasks.find((row) => row.nizekId === id);
      if (!t) continue;
      projectIds.add(t.projectId);
      const existing = taskMap.get(id);
      if (existing) {
        taskMap.set(id, { ...existing, viaCommit: true });
      } else {
        const stamp = t.stageEnteredAt ?? t.startedAt ?? null;
        taskMap.set(id, {
          code: taskCode(t.taskType, t.taskNumber),
          title: t.title,
          stage: t.stage,
          projectName: projectName.get(t.projectId) ?? t.projectId.slice(0, 8),
          assigneeName: t.assigneeName ?? null,
          stageEnteredAt: stamp,
          viaCommit: true,
          sortAt: stamp ?? t.nizekId,
        });
      }
    }

    const tasksSorted = [...taskMap.values()]
      .sort((a, b) => (a.sortAt < b.sortAt ? 1 : -1))
      .slice(0, TASK_CAP)
      .map(({ sortAt: _s, ...rest }) => rest);

    for (const t of tasksSorted) {
      // project name already resolved; ensure count includes named projects
      void t;
    }

    return {
      fromIso,
      toIso,
      commits: commitsOut,
      messages: messagesOut,
      tasks: tasksSorted,
      counts: {
        commits: commitsOut.length,
        messages: messagesOut.length,
        tasks: tasksSorted.length,
        projects: projectIds.size,
      },
    };
  },
});
