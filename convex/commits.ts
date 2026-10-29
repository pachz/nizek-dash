import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
    return repos.filter((r) => r.enabled);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const sinceIso = new Date(Date.now() - BACKFILL_MS).toISOString();
    const recent = await ctx.db
      .query("commits")
      .withIndex("by_authoredAt")
      .order("desc")
      .take(2000);

    const inWindow = recent.filter((c) => c.authoredAt >= sinceIso);
    let matched = 0;
    let suggested = 0;
    for (const c of inWindow) {
      const links = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(20);
      const live = links.filter((m) => m.status !== "rejected");
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 150, 300);
    const sinceIso = new Date(Date.now() - BACKFILL_MS).toISOString();
    const search = args.search?.trim().toLowerCase();

    let rows;
    if (args.repoId) {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_repo_authoredAt", (q) => q.eq("repoId", args.repoId!))
        .order("desc")
        .take(800);
    } else {
      rows = await ctx.db
        .query("commits")
        .withIndex("by_authoredAt")
        .order("desc")
        .take(800);
    }

    const repos = await ctx.db.query("gitRepos").take(200);
    const repoMap = new Map(repos.map((r) => [r._id, r]));

    const projectFilter = args.projectId;
    const statusFilter = args.matchStatus ?? "all";

    const out: Array<{
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
      matches: Array<{
        _id: Id<"commitMatches">;
        taskNizekId: string;
        projectId: string;
        confidence: number;
        reason: string;
        method: "heuristic" | "ai";
        status: "suggested" | "accepted" | "rejected";
        taskTitle?: string;
        taskCode?: string;
      }>;
    }> = [];

    for (const c of rows) {
      if (c.authoredAt < sinceIso) continue;
      const repo = repoMap.get(c.repoId);
      if (!repo) continue;
      if (projectFilter && !repo.projectIds.includes(projectFilter)) continue;

      if (search) {
        const hay = `${c.message} ${c.authorName} ${c.sha} ${repo.fullName}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }

      const matchRows = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(30);

      const live = matchRows.filter((m) => m.status !== "rejected");
      const hasAccepted = live.some((m) => m.status === "accepted");
      const hasSuggested = live.some((m) => m.status === "suggested");

      if (statusFilter === "matched" && !hasAccepted) continue;
      if (statusFilter === "suggested" && !(hasSuggested && !hasAccepted))
        continue;
      if (statusFilter === "unmatched" && live.length > 0) continue;

      const enriched = [];
      for (const m of live) {
        const task = await ctx.db
          .query("tasks")
          .withIndex("by_nizekId", (q) => q.eq("nizekId", m.taskNizekId))
          .unique();
        const prefix =
          task?.taskType === "BUG"
            ? "B"
            : task?.taskType === "ENHANCEMENT"
              ? "E"
              : task?.taskType === "FEATURE"
                ? "F"
                : "T";
        enriched.push({
          _id: m._id,
          taskNizekId: m.taskNizekId,
          projectId: m.projectId,
          confidence: m.confidence,
          reason: m.reason,
          method: m.method,
          status: m.status,
          taskTitle: task?.title,
          taskCode: task
            ? `${prefix}-${String(task.taskNumber).padStart(3, "0")}`
            : undefined,
        });
      }

      out.push({
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
        matches: enriched,
      });
      if (out.length >= limit) break;
    }

    return out;
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
      if (m.status === "rejected") continue;
      const commit = await ctx.db.get(m.commitId);
      if (!commit) continue;
      const repo = await ctx.db.get(commit.repoId);
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
      if (c.authoredAt < sinceIso) continue;
      const repo = repoMap.get(c.repoId);
      if (!repo || !repo.enabled || repo.projectIds.length === 0) continue;

      const matches = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(20);
      const live = matches.filter((m) => m.status !== "rejected");
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
