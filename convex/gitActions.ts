import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

const BACKFILL_MS = 60 * 24 * 60 * 60 * 1000;
const GH = "https://api.github.com";

type GhCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; email?: string; date?: string } | null;
  };
  author: { login?: string } | null;
};

type GhBranch = { name: string };
type GhRepo = { default_branch: string };

async function ghFetch(path: string, token: string, init?: RequestInit) {
  return await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nizek-projects-plus/1.0",
      ...(init?.headers ?? {}),
    },
  });
}

function parseLinkNext(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1]!;
  }
  return null;
}

async function listBranches(
  token: string,
  owner: string,
  name: string,
): Promise<string[]> {
  const names: string[] = [];
  let url: string | null =
    `${GH}/repos/${owner}/${name}/branches?per_page=100`;
  while (url) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nizek-projects-plus/1.0",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Branches ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as GhBranch[];
    for (const b of data) names.push(b.name);
    url = parseLinkNext(res.headers.get("link"));
  }
  return names;
}

async function listCommitsOnBranch(
  token: string,
  owner: string,
  name: string,
  branch: string,
  sinceIso: string,
): Promise<
  Array<{
    sha: string;
    message: string;
    authorName: string;
    authorEmail?: string;
    authoredAt: string;
    htmlUrl: string;
    branch: string;
  }>
> {
  const out: Array<{
    sha: string;
    message: string;
    authorName: string;
    authorEmail?: string;
    authoredAt: string;
    htmlUrl: string;
    branch: string;
  }> = [];

  let page = 1;
  while (page <= 10) {
    const res = await ghFetch(
      `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
      token,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Commits ${branch} ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as GhCommit[];
    if (data.length === 0) break;
    for (const c of data) {
      const authoredAt = c.commit.author?.date ?? new Date(0).toISOString();
      out.push({
        sha: c.sha,
        message: c.commit.message ?? "",
        authorName:
          c.commit.author?.name ?? c.author?.login ?? "unknown",
        authorEmail: c.commit.author?.email,
        authoredAt,
        htmlUrl: c.html_url,
        branch,
      });
    }
    if (data.length < 100) break;
    page++;
  }
  return out;
}

export const syncCommits = action({
  args: {},
  handler: async (ctx): Promise<
    Result<{ repos: number; inserted: number; updated: number }>
  > => {
    try {
      const token = await ctx.runQuery(internal.commits.getGithubToken, {});
      if (!token) {
        return {
          ok: false,
          error: "Save a GitHub personal access token in Admin first.",
        };
      }
      const repos = await ctx.runQuery(internal.commits.listEnabledRepos, {});
      if (repos.length === 0) {
        return { ok: false, error: "Add and enable at least one git repo." };
      }

      let inserted = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const repo of repos) {
        try {
          const floor = new Date(Date.now() - BACKFILL_MS).toISOString();
          const sinceIso =
            repo.syncSince && repo.syncSince > floor
              ? repo.syncSince
              : floor;

          const metaRes = await ghFetch(
            `/repos/${repo.owner}/${repo.name}`,
            token,
          );
          if (!metaRes.ok) {
            const body = await metaRes.text();
            throw new Error(`Repo ${metaRes.status}: ${body.slice(0, 200)}`);
          }
          const meta = (await metaRes.json()) as GhRepo;

          const branches = await listBranches(token, repo.owner, repo.name);
          let newest = sinceIso;

          for (const branch of branches) {
            const commits = await listCommitsOnBranch(
              token,
              repo.owner,
              repo.name,
              branch,
              sinceIso,
            );
            for (let i = 0; i < commits.length; i += 40) {
              const chunk = commits.slice(i, i + 40);
              const r = await ctx.runMutation(internal.commits.upsertBatch, {
                repoId: repo._id,
                commits: chunk,
              });
              inserted += r.inserted;
              updated += r.updated;
            }
            for (const c of commits) {
              if (c.authoredAt > newest) newest = c.authoredAt;
            }
          }

          const nextSince =
            newest > sinceIso
              ? new Date(new Date(newest).getTime() - 60_000).toISOString()
              : sinceIso;

          await ctx.runMutation(internal.commits.patchRepoSync, {
            repoId: repo._id,
            lastSyncedAt: Date.now(),
            lastError: null,
            syncSince: nextSince,
            defaultBranch: meta.default_branch,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${repo.fullName}: ${msg}`);
          await ctx.runMutation(internal.commits.patchRepoSync, {
            repoId: repo._id,
            lastError: msg.slice(0, 400),
          });
        }
      }

      await ctx.runMutation(internal.commits.patchCommitSettings, {
        lastCommitSyncAt: Date.now(),
        lastCommitError: errors.length
          ? errors.join(" · ").slice(0, 500)
          : null,
      });

      if (errors.length && inserted + updated === 0) {
        return { ok: false, error: errors.join(" · ") };
      }
      return { ok: true, repos: repos.length, inserted, updated };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.commits.patchCommitSettings, {
        lastCommitError: msg.slice(0, 500),
      });
      return { ok: false, error: msg };
    }
  },
});

export const syncCommitsInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runAction(api.gitActions.syncCommits, {});
    if (!result.ok) {
      console.warn("scheduled commit sync failed:", result.error);
    } else {
      console.log(
        `scheduled commit sync ok: ${result.repos} repos · +${result.inserted} / ~${result.updated}`,
      );
    }
  },
});
