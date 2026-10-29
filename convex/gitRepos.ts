import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

function parseFullName(input: string): { owner: string; name: string; fullName: string } {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Use owner/repo (e.g. nizek/my-app)");
  }
  const owner = parts[0]!;
  const name = parts[1]!;
  return { owner, name, fullName: `${owner}/${name}` };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("gitRepos").take(200);
  },
});

export const reposForProject = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const repos = await ctx.db.query("gitRepos").take(200);
    return repos
      .filter((r) => r.projectIds.includes(args.projectId))
      .map((r) => ({
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch ?? "main",
        enabled: r.enabled,
      }));
  },
});

/** Public settings for commit UI — never returns the raw GitHub token. */
export const githubStatus = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const token = settings?.githubToken?.trim() ?? "";
    return {
      hasToken: token.length > 0,
      tokenHint: token ? `••••${token.slice(-4)}` : null,
      lastCommitSyncAt: settings?.lastCommitSyncAt ?? null,
      lastCommitError: settings?.lastCommitError ?? null,
      lastMatchAt: settings?.lastMatchAt ?? null,
      lastMatchError: settings?.lastMatchError ?? null,
    };
  },
});

export const saveGithubToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) throw new Error("GitHub token is empty");
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        githubToken: token,
        lastCommitError: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("settings", {
      key: "main",
      githubToken: token,
      deviceId: crypto.randomUUID(),
    });
  },
});

export const clearGithubToken = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { githubToken: undefined });
    }
  },
});

export const upsert = mutation({
  args: {
    fullName: v.string(),
    projectIds: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { owner, name, fullName } = parseFullName(args.fullName);
    const existing = await ctx.db
      .query("gitRepos")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        projectIds: args.projectIds ?? existing.projectIds,
        enabled: args.enabled ?? existing.enabled,
      });
      return existing._id;
    }
    return await ctx.db.insert("gitRepos", {
      owner,
      name,
      fullName,
      enabled: args.enabled ?? true,
      projectIds: args.projectIds ?? [],
    });
  },
});

export const setProjectIds = mutation({
  args: {
    repoId: v.id("gitRepos"),
    projectIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error("Repo not found");
    await ctx.db.patch(args.repoId, { projectIds: args.projectIds });
  },
});

export const setEnabled = mutation({
  args: {
    repoId: v.id("gitRepos"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error("Repo not found");
    await ctx.db.patch(args.repoId, { enabled: args.enabled });
  },
});

export const remove = mutation({
  args: { repoId: v.id("gitRepos") },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) return;

    const commits = await ctx.db
      .query("commits")
      .withIndex("by_repo_authoredAt", (q) => q.eq("repoId", args.repoId))
      .take(5000);
    for (const c of commits) {
      const matches = await ctx.db
        .query("commitMatches")
        .withIndex("by_commit", (q) => q.eq("commitId", c._id))
        .take(50);
      for (const m of matches) await ctx.db.delete(m._id);
      await ctx.db.delete(c._id);
    }
    await ctx.db.delete(args.repoId);
  },
});
