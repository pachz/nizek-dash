import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isLive } from "./lib/softDelete";

const BACKFILL_MS = 60 * 24 * 60 * 60 * 1000;

export const upsertBatch = internalMutation({
  args: {
    repoId: v.id("gitRepos"),
    commits: v.array(
      v.object({
        sha: v.string(),
        message: v.string(),
        authorName: v.string(),
        authorEmail: v.optional(v.string()),
        authoredAt: v.string(),
        htmlUrl: v.string(),
        branch: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    for (const c of args.commits) {
      const existing = await ctx.db
        .query("commits")
        .withIndex("by_repo_sha", (q) =>
          q.eq("repoId", args.repoId).eq("sha", c.sha),
        )
        .unique();
      if (existing) {
        const branches = existing.branches.includes(c.branch)
          ? existing.branches
          : [...existing.branches, c.branch];
        await ctx.db.patch(existing._id, {
          message: c.message,
          authorName: c.authorName,
          authorEmail: c.authorEmail,
          authoredAt: c.authoredAt,
          htmlUrl: c.htmlUrl,
          branches,
          deletedAt: undefined,
        });
        updated++;
      } else {
        await ctx.db.insert("commits", {
          repoId: args.repoId,
          sha: c.sha,
          message: c.message,
          authorName: c.authorName,
          authorEmail: c.authorEmail,
          authoredAt: c.authoredAt,
          htmlUrl: c.htmlUrl,
          branches: [c.branch],
        });
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

export const patchRepoSync = internalMutation({
  args: {
    repoId: v.id("gitRepos"),
    lastSyncedAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
    syncSince: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.lastSyncedAt !== undefined) patch.lastSyncedAt = args.lastSyncedAt;
    if (args.syncSince !== undefined) patch.syncSince = args.syncSince;
    if (args.defaultBranch !== undefined)
      patch.defaultBranch = args.defaultBranch;
    if (args.lastError === null) patch.lastError = undefined;
    else if (args.lastError !== undefined) patch.lastError = args.lastError;
    await ctx.db.patch(args.repoId, patch);
  },
});

export const patchCommitSettings = internalMutation({
  args: {
    lastCommitSyncAt: v.optional(v.number()),
    lastCommitError: v.optional(v.union(v.string(), v.null())),
    lastMatchAt: v.optional(v.number()),
    lastMatchError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch: Record<string, unknown> = {};
    if (args.lastCommitSyncAt !== undefined)
      patch.lastCommitSyncAt = args.lastCommitSyncAt;
    if (args.lastMatchAt !== undefined) patch.lastMatchAt = args.lastMatchAt;
    if (args.lastCommitError === null) patch.lastCommitError = undefined;
    else if (args.lastCommitError !== undefined)
      patch.lastCommitError = args.lastCommitError;
    if (args.lastMatchError === null) patch.lastMatchError = undefined;
    else if (args.lastMatchError !== undefined)
      patch.lastMatchError = args.lastMatchError;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("settings", {
      key: "main",
      deviceId: crypto.randomUUID(),
      ...patch,
    });
  },
});

export const getGithubToken = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    return settings?.githubToken?.trim() ?? null;
  },
});

export const listEnabledRepos = internalQuery({
  args: {},
  handler: async (ctx) => {
    const repos = await ctx.db.query("gitRepos").take(200);
    return repos.filter((r) => isLive(r) && r.enabled);
  },
});

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function codeForTask(taskType: string, taskNumber: number) {
  const prefix =
    taskType === "BUG"
      ? "B"
      : taskType === "ENHANCEMENT"
        ? "E"
        : taskType === "FEATURE"
          ? "F"
          : "T";
  return `${prefix}-${String(taskNumber).padStart(3, "0")}`;
}

function enumerateDays(sinceIso: string, untilIso: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${sinceIso.slice(0, 10)}T12:00:00.000Z`);
  const end = new Date(`${untilIso.slice(0, 10)}T12:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const sinceIso = new Date(Date.now() - BACKFILL_MS).toISOString();
    const recent = await ctx.db
      .query("commits")
      .withIndex("by_authoredAt")
      .order("desc")
      .take(3000);

    const inWindow = recent.filter(
      (c) => isLive(c) && c.authoredAt >= sinceIso,
    );
    let matched = 0;
    let suggested = 0;
    for (const c of inWindow) {
      const links = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(20);
      const live = links.filter(
        (m) => isLive(m) && m.status !== "rejected",
      );
      if (live.some((m) => m.status === "accepted")) matched++;
      else if (live.some((m) => m.status === "suggested")) suggested++;
    }
    const unmatched = inWindow.length - matched - suggested;
    return {
      total: inWindow.length,
      matched,
      suggested,
      unmatched,
      matchedPct:
        inWindow.length === 0
          ? 0
          : Math.round((matched / inWindow.length) * 100),
    };
  },
});

export const aggregates = query({
  args: {
    repoId: v.optional(v.id("gitRepos")),
    projectId: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const windowDays = Math.min(Math.max(args.days ?? 60, 7), 90);
    const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const repos = await ctx.db.query("gitRepos").take(200);
    const repoMap = new Map(repos.map((r) => [r._id, r]));
    const projects = await ctx.db.query("projects").take(100);
    const projectMeta = new Map(
      projects.map((p) => [p.nizekId, { name: p.name, color: p.color }]),
    );

    let rows;
    if (args.repoId) {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_repo_authoredAt", (q) => q.eq("repoId", args.repoId!))
        .order("desc")
        .take(4000);
    } else {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_authoredAt")
        .order("desc")
        .take(4000);
    }

    type Bucket = {
      total: number;
      byRepo: Record<string, number>;
      byProject: Record<string, number>;
      authors: Record<string, number>;
    };
    const byDay = new Map<string, Bucket>();
    const authorTotals = new Map<string, number>();
    const repoTotals = new Map<string, number>();
    const projectDaySets = new Map<string, Set<string>>();
    const projectTotals = new Map<string, number>();

    let total = 0;
    for (const c of rows) {
      if (!isLive(c) || c.authoredAt < sinceIso) continue;
      const repo = repoMap.get(c.repoId);
      if (!repo || !isLive(repo)) continue;
      if (args.projectId && !repo.projectIds.includes(args.projectId)) continue;

      const day = dayKey(c.authoredAt);
      let bucket = byDay.get(day);
      if (!bucket) {
        bucket = { total: 0, byRepo: {}, byProject: {}, authors: {} };
        byDay.set(day, bucket);
      }
      bucket.total++;
      bucket.byRepo[repo.fullName] = (bucket.byRepo[repo.fullName] ?? 0) + 1;
      bucket.authors[c.authorName] = (bucket.authors[c.authorName] ?? 0) + 1;
      authorTotals.set(c.authorName, (authorTotals.get(c.authorName) ?? 0) + 1);
      repoTotals.set(repo.fullName, (repoTotals.get(repo.fullName) ?? 0) + 1);
      total++;

      const projectIds = args.projectId
        ? [args.projectId]
        : repo.projectIds.length
          ? repo.projectIds
          : ["_unmapped"];
      for (const pid of projectIds) {
        bucket.byProject[pid] = (bucket.byProject[pid] ?? 0) + 1;
        projectTotals.set(pid, (projectTotals.get(pid) ?? 0) + 1);
        let set = projectDaySets.get(pid);
        if (!set) {
          set = new Set();
          projectDaySets.set(pid, set);
        }
        set.add(day);
      }
    }

    const days = enumerateDays(sinceIso, `${today}T12:00:00.000Z`);
    const daily = days.map((day) => {
      const b = byDay.get(day) ?? {
        total: 0,
        byRepo: {},
        byProject: {},
        authors: {},
      };
      return {
        day,
        total: b.total,
        byRepo: b.byRepo,
        byProject: b.byProject,
      };
    });

    const activeDays = daily.filter((d) => d.total > 0).length;
    let streak = 0;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (daily[i]!.total > 0) streak++;
      else break;
    }

    const seriesKeys = [...projectTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    const consistency = seriesKeys.map((pid) => {
      const daySet = projectDaySets.get(pid) ?? new Set();
      const meta = projectMeta.get(pid);
      let longest = 0;
      let cur = 0;
      for (const d of days) {
        if (daySet.has(d)) {
          cur++;
          longest = Math.max(longest, cur);
        } else cur = 0;
      }
      let current = 0;
      for (let i = days.length - 1; i >= 0; i--) {
        if (daySet.has(days[i]!)) current++;
        else break;
      }
      return {
        projectId: pid,
        name: meta?.name ?? (pid === "_unmapped" ? "Unmapped" : pid.slice(0, 8)),
        color: meta?.color ?? "#64748b",
        commits: projectTotals.get(pid) ?? 0,
        activeDays: daySet.size,
        coveragePct: Math.round((daySet.size / days.length) * 100),
        avgPerActiveDay:
          daySet.size === 0
            ? 0
            : Math.round(((projectTotals.get(pid) ?? 0) / daySet.size) * 10) /
              10,
        longestStreak: longest,
        currentStreak: current,
        heatmap: days.map((d) => (daySet.has(d) ? (byDay.get(d)?.byProject[pid] ?? 0) : 0)),
      };
    });

    const topAuthors = [...authorTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    const topRepos = [...repoTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    return {
      windowDays,
      total,
      activeDays,
      currentStreak: streak,
      avgPerDay: Math.round((total / days.length) * 10) / 10,
      daily,
      consistency,
      topAuthors,
      topRepos,
      seriesKeys,
    };
  },
});

export const listForDashboard = query({
  args: {
    repoId: v.optional(v.id("gitRepos")),
    projectId: v.optional(v.string()),
    matchStatus: v.optional(
      v.union(
        v.literal("all"),
        v.literal("matched"),
        v.literal("suggested"),
        v.literal("unmatched"),
      ),
    ),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(args.page ?? 1, 1);
    const pageSize = Math.min(Math.max(args.pageSize ?? 25, 10), 100);
    const sinceIso = new Date(Date.now() - BACKFILL_MS).toISOString();
    const search = args.search?.trim().toLowerCase();

    let rows;
    if (args.repoId) {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_repo_authoredAt", (q) => q.eq("repoId", args.repoId!))
        .order("desc")
        .take(4000);
    } else {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_authoredAt")
        .order("desc")
        .take(4000);
    }

    const repos = await ctx.db.query("gitRepos").take(200);
    const repoMap = new Map(repos.map((r) => [r._id, r]));
    const projectFilter = args.projectId;
    const statusFilter = args.matchStatus ?? "all";

    type Row = {
      _id: Id<"commits">;
      sha: string;
      message: string;
      authorName: string;
      authorEmail?: string;
      authoredAt: string;
      htmlUrl: string;
      branches: string[];
      repoFullName: string;
      repoId: Id<"gitRepos">;
      projectIds: string[];
      matchSummary: {
        accepted: number;
        suggested: number;
        top?: {
          _id: Id<"commitMatches">;
          taskNizekId: string;
          taskCode?: string;
          taskTitle?: string;
          status: "suggested" | "accepted" | "rejected";
          confidence: number;
          method: "heuristic" | "ai";
        };
      };
    };

    const filtered: Row[] = [];

    for (const c of rows) {
      if (!isLive(c) || c.authoredAt < sinceIso) continue;
      const repo = repoMap.get(c.repoId);
      if (!repo || !isLive(repo)) continue;
      if (projectFilter && !repo.projectIds.includes(projectFilter)) continue;

      if (search) {
        const hay =
          `${c.message} ${c.authorName} ${c.sha} ${repo.fullName}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }

      const matchRows = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(30);

      const live = matchRows.filter(
        (m) => isLive(m) && m.status !== "rejected",
      );
      const hasAccepted = live.some((m) => m.status === "accepted");
      const hasSuggested = live.some((m) => m.status === "suggested");

      if (statusFilter === "matched" && !hasAccepted) continue;
      if (statusFilter === "suggested" && !(hasSuggested && !hasAccepted))
        continue;
      if (statusFilter === "unmatched" && live.length > 0) continue;

      const accepted = live.filter((m) => m.status === "accepted").length;
      const suggested = live.filter((m) => m.status === "suggested").length;
      const topMatch = live.sort((a, b) => b.confidence - a.confidence)[0];
      let top:
        | Row["matchSummary"]["top"]
        | undefined;
      if (topMatch) {
        const task = await ctx.db
          .query("tasks")
          .withIndex("by_nizekId", (q) => q.eq("nizekId", topMatch.taskNizekId))
          .unique();
        top = {
          _id: topMatch._id,
          taskNizekId: topMatch.taskNizekId,
          taskCode: task
            ? codeForTask(task.taskType, task.taskNumber)
            : undefined,
          taskTitle: task?.title,
          status: topMatch.status,
          confidence: topMatch.confidence,
          method: topMatch.method,
        };
      }

      filtered.push({
        _id: c._id,
        sha: c.sha,
        message: c.message,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        authoredAt: c.authoredAt,
        htmlUrl: c.htmlUrl,
        branches: c.branches,
        repoFullName: repo.fullName,
        repoId: c.repoId,
        projectIds: repo.projectIds,
        matchSummary: { accepted, suggested, top },
      });
    }

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total,
      page: safePage,
      pageSize,
      pageCount,
    };
  },
});

export const getCommit = query({
  args: { commitId: v.id("commits") },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.commitId);
    if (!c || !isLive(c)) return null;
    const repo = await ctx.db.get(c.repoId);
    if (repo && !isLive(repo)) return null;
    const matchRows = await ctx.db
      .query("commitMatches")
      .withIndex("by_commit", (q) => q.eq("commitId", c._id))
      .take(40);

    const matches = [];
    for (const m of matchRows) {
      if (!isLive(m) || m.status === "rejected") continue;
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", m.taskNizekId))
        .unique();
      if (task && !isLive(task)) continue;
      const project = task
        ? await ctx.db
            .query("projects")
            .withIndex("by_nizekId", (q) => q.eq("nizekId", task.projectId))
            .unique()
        : null;
      matches.push({
        _id: m._id,
        taskNizekId: m.taskNizekId,
        projectId: m.projectId,
        projectName: project?.name,
        projectColor: project?.color,
        confidence: m.confidence,
        reason: m.reason,
        method: m.method,
        status: m.status,
        model: m.model,
        taskTitle: task?.title,
        taskCode: task
          ? codeForTask(task.taskType, task.taskNumber)
          : undefined,
        stage: task?.stage,
      });
    }

    return {
      _id: c._id,
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      authoredAt: c.authoredAt,
      htmlUrl: c.htmlUrl,
      branches: c.branches,
      repoFullName: repo?.fullName ?? "?",
      repoId: c.repoId,
      projectIds: repo?.projectIds ?? [],
      matches,
    };
  },
});

export const listForTask = query({
  args: { taskNizekId: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("commitMatches")
      .withIndex("by_task", (q) => q.eq("taskNizekId", args.taskNizekId))
      .take(50);

    const out = [];
    for (const m of matches) {
      if (!isLive(m) || m.status === "rejected") continue;
      const commit = await ctx.db.get(m.commitId);
      if (!commit || !isLive(commit)) continue;
      const repo = await ctx.db.get(commit.repoId);
      if (repo && !isLive(repo)) continue;
      out.push({
        matchId: m._id,
        status: m.status,
        confidence: m.confidence,
        reason: m.reason,
        method: m.method,
        sha: commit.sha,
        message: commit.message,
        authoredAt: commit.authoredAt,
        htmlUrl: commit.htmlUrl,
        authorName: commit.authorName,
        repoFullName: repo?.fullName ?? "?",
      });
    }
    out.sort((a, b) => (a.authoredAt < b.authoredAt ? 1 : -1));
    return out;
  },
});

export const setMatchStatus = mutation({
  args: {
    matchId: v.id("commitMatches"),
    status: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("suggested")),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("Match not found");
    await ctx.db.patch(args.matchId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const upsertMatch = internalMutation({
  args: {
    commitId: v.id("commits"),
    taskNizekId: v.string(),
    projectId: v.string(),
    confidence: v.number(),
    reason: v.string(),
    method: v.union(v.literal("heuristic"), v.literal("ai")),
    status: v.optional(
      v.union(
        v.literal("suggested"),
        v.literal("accepted"),
        v.literal("rejected"),
      ),
    ),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("commitMatches")
      .withIndex("by_commit_task", (q) =>
        q.eq("commitId", args.commitId).eq("taskNizekId", args.taskNizekId),
      )
      .unique();
    if (existing) {
      // Don't overwrite human decisions
      if (existing.status === "accepted" || existing.status === "rejected") {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        confidence: Math.max(existing.confidence, args.confidence),
        reason: args.reason,
        method: args.method,
        model: args.model,
        updatedAt: Date.now(),
        deletedAt: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("commitMatches", {
      commitId: args.commitId,
      taskNizekId: args.taskNizekId,
      projectId: args.projectId,
      confidence: args.confidence,
      reason: args.reason,
      method: args.method,
      status: args.status ?? "suggested",
      model: args.model,
      updatedAt: Date.now(),
    });
  },
});

export const unmatchedForMatching = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 80;
    const sinceIso = new Date(Date.now() - BACKFILL_MS).toISOString();
    const recent = await ctx.db
      .query("commits")
      .withIndex("by_authoredAt")
      .order("desc")
      .take(600);

    const repos = await ctx.db.query("gitRepos").take(200);
    const repoMap = new Map(repos.map((r) => [r._id, r]));

    const out = [];
    for (const c of recent) {
      if (!isLive(c) || c.authoredAt < sinceIso) continue;
      const repo = repoMap.get(c.repoId);
      if (
        !repo ||
        !isLive(repo) ||
        !repo.enabled ||
        repo.projectIds.length === 0
      ) {
        continue;
      }

      const matches = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(20);
      const live = matches.filter(
        (m) => isLive(m) && m.status !== "rejected",
      );
      if (live.length > 0) continue;

      out.push({
        _id: c._id,
        sha: c.sha,
        message: c.message,
        authorName: c.authorName,
        authoredAt: c.authoredAt,
        repoId: c.repoId,
        projectIds: repo.projectIds,
        repoFullName: repo.fullName,
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});

export const tasksForProjects = internalQuery({
  args: { projectIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out = [];
    for (const projectId of args.projectIds) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(500);
      for (const t of tasks) {
        if (!isLive(t)) continue;
        out.push({
          nizekId: t.nizekId,
          projectId: t.projectId,
          title: t.title,
          description: t.description ?? null,
          taskNumber: t.taskNumber,
          taskType: t.taskType,
          stage: t.stage,
          assigneeName: t.assigneeName ?? null,
        });
      }
    }
    return out;
  },
});
