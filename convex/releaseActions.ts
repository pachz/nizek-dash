"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

type SuggestMeta = {
  version: string;
  author: string;
  notes: string;
  breaking: string[];
  support: string;
  versionSource: string | null;
};

type VersionHit = {
  version: string;
  source: string;
  repoFullName: string;
  ref: string;
};

const GH = "https://api.github.com";

const VERSION_CANDIDATES = [
  "package.json",
  "package/package.json",
  "app/package.json",
  "apps/web/package.json",
  "apps/api/package.json",
  "web/package.json",
  "frontend/package.json",
  "backend/package.json",
  "composer.json",
  "Cargo.toml",
  "pyproject.toml",
  "pubspec.yaml",
  "Chart.yaml",
  "VERSION",
  "version.txt",
] as const;

function openaiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function stripV(version: string) {
  return version.replace(/^v/i, "").trim();
}

function parseVersionFromFile(path: string, text: string): string | null {
  const lower = path.toLowerCase();

  if (lower.endsWith("package.json") || lower.endsWith("composer.json")) {
    try {
      const json = JSON.parse(text) as { version?: unknown };
      if (typeof json.version === "string" && json.version.trim()) {
        return stripV(json.version);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (lower.endsWith("cargo.toml")) {
    const m = text.match(/^\s*version\s*=\s*"([^"]+)"/m);
    return m?.[1] ? stripV(m[1]) : null;
  }

  if (lower.endsWith("pyproject.toml")) {
    const m =
      text.match(/^\s*version\s*=\s*"([^"]+)"/m) ||
      text.match(/^\s*version\s*=\s*'([^']+)'/m);
    return m?.[1] ? stripV(m[1]) : null;
  }

  if (lower.endsWith("pubspec.yaml") || lower.endsWith("chart.yaml")) {
    const m = text.match(/^\s*version\s*:\s*["']?([^\s"']+)/m);
    return m?.[1] ? stripV(m[1].split("+")[0]!) : null;
  }

  if (lower === "version" || lower.endsWith("version.txt")) {
    const line = text.split("\n").map((l) => l.trim()).find(Boolean);
    return line ? stripV(line) : null;
  }

  return null;
}

async function ghFile(
  token: string,
  owner: string,
  name: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const res = await fetch(
    `${GH}/repos/${owner}/${name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nizek-projects-plus/1.0",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    encoding?: string;
    content?: string;
    type?: string;
  };
  if (data.type !== "file" || typeof data.content !== "string") return null;
  if (data.encoding === "base64") {
    const normalized = data.content.replace(/\n/g, "");
    const pad = "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(normalized + pad);
  }
  return data.content;
}

async function readVersionsFromRepos(
  token: string,
  repos: Array<{
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }>,
): Promise<VersionHit[]> {
  const hits: VersionHit[] = [];

  for (const repo of repos) {
    const refs = Array.from(
      new Set(
        ["main", "master", repo.defaultBranch].filter(Boolean) as string[],
      ),
    );

    for (const ref of refs) {
      let found = false;
      for (const path of VERSION_CANDIDATES) {
        try {
          const text = await ghFile(token, repo.owner, repo.name, path, ref);
          if (!text) continue;
          const version = parseVersionFromFile(path, text);
          if (!version) continue;
          hits.push({
            version,
            source: `${repo.fullName}@${ref}:${path}`,
            repoFullName: repo.fullName,
            ref,
          });
          found = true;
          break;
        } catch {
          // try next path / ref
        }
      }
      if (found) break;
    }
  }

  return hits;
}

function pickVersion(hits: VersionHit[]): VersionHit | null {
  if (hits.length === 0) return null;
  // Prefer package.json on main when multiple repos disagree.
  const preferred =
    hits.find((h) => h.source.includes(":package.json") && h.ref === "main") ||
    hits.find((h) => h.source.includes(":package.json")) ||
    hits[0]!;
  return preferred;
}

/** Read version from linked GitHub repos (package.json and common fallbacks). */
export const readProjectVersion = action({
  args: { projectId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<{ version: string; source: string; candidates: VersionHit[] }>
  > => {
    const token = await ctx.runQuery(internal.commits.getGithubToken, {});
    if (!token) {
      return {
        ok: false,
        error: "Add a GitHub token in Admin to read version from the repo.",
      };
    }

    const repos = await ctx.runQuery(internal.gitRepos.reposForProject, {
      projectId: args.projectId,
    });
    if (repos.length === 0) {
      return {
        ok: false,
        error: "No GitHub repos linked to this project.",
      };
    }

    try {
      const candidates = await readVersionsFromRepos(token, repos);
      const picked = pickVersion(candidates);
      if (!picked) {
        return {
          ok: false,
          error: `No version found in ${repos.map((r) => r.fullName).join(", ")} (tried package.json and common files on main).`,
        };
      }
      return {
        ok: true,
        version: picked.version,
        source: picked.source,
        candidates,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to read repo version.",
      };
    }
  },
});

export const suggestMeta = action({
  args: {
    projectId: v.string(),
    projectName: v.string(),
    fromIso: v.string(),
    toIso: v.string(),
    currentVersion: v.optional(v.string()),
    currentAuthor: v.optional(v.string()),
    tasks: v.array(
      v.object({
        code: v.string(),
        title: v.string(),
        taskType: v.string(),
        stage: v.string(),
        description: v.optional(v.union(v.string(), v.null())),
        assigneeName: v.optional(v.union(v.string(), v.null())),
        viaMainCommit: v.optional(v.boolean()),
      }),
    ),
    commits: v.array(
      v.object({
        sha: v.string(),
        subject: v.string(),
        message: v.optional(v.string()),
        authorName: v.string(),
        authoredAt: v.string(),
        repoFullName: v.string(),
        matched: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Result<SuggestMeta>> => {
    const apiKey = openaiKey();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "Set OPENAI_API_KEY in the Convex dashboard environment variables.",
      };
    }

    if (args.tasks.length === 0 && args.commits.length === 0) {
      return { ok: false, error: "Select at least one task or main commit." };
    }

    let repoVersion: VersionHit | null = null;
    try {
      const token = await ctx.runQuery(internal.commits.getGithubToken, {});
      if (token) {
        const repos = await ctx.runQuery(internal.gitRepos.reposForProject, {
          projectId: args.projectId,
        });
        if (repos.length) {
          const hits = await readVersionsFromRepos(token, repos);
          repoVersion = pickVersion(hits);
        }
      }
    } catch {
      repoVersion = null;
    }

    const system = `You draft release-note metadata for Nizek Startups products.
Return ONLY JSON with keys:
{
  "version": "semver or calendar version — bare number, no leading v",
  "author": "person or team name",
  "notes": "2–4 sentence Highlights paragraph, concrete, no fluff, no emojis",
  "breaking": ["action-required lines"] or [],
  "support": "one short support callout line"
}

Rules:
- Ground truth is the provided finished tasks and commits that landed on main.
- Prefer product language from task titles; use commits as evidence of what shipped.
- Only put items in breaking when the context clearly implies a breaking/migration/deprecation/remove/incompatible change. Otherwise return [].
- Keep notes tight and specific. Mention notable features/fixes by name when useful.
- VERSION: if repoVersion is provided, you MUST use that exact version string (do not invent or bump).
- If repoVersion is missing, use currentVersion when present; otherwise invent a sensible version for the window.
- Author: prefer a real commit author only when one person clearly dominates; else use currentAuthor or "Nizek Product".`;

    const user = {
      project: args.projectName,
      window: { from: args.fromIso, to: args.toIso },
      repoVersion: repoVersion
        ? { version: repoVersion.version, source: repoVersion.source }
        : null,
      currentVersion: args.currentVersion || null,
      currentAuthor: args.currentAuthor || "Nizek Product",
      tasks: args.tasks.map((t) => ({
        code: t.code,
        type: t.taskType,
        stage: t.stage,
        title: t.title,
        description: (t.description ?? "").slice(0, 400) || null,
        assignee: t.assigneeName ?? null,
        viaMainCommit: Boolean(t.viaMainCommit),
      })),
      commitsOnMain: args.commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        subject: c.subject,
        body:
          (c.message ?? "")
            .split("\n")
            .slice(1)
            .join("\n")
            .trim()
            .slice(0, 280) || null,
        author: c.authorName,
        at: c.authoredAt,
        repo: c.repoFullName,
        matchedTask: c.matched || null,
      })),
    };

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
          temperature: 0.35,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(user) },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          error: `OpenAI ${res.status}: ${body.slice(0, 280)}`,
        };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "AI returned invalid JSON." };
      }

      // Repo version always wins when we successfully read one.
      const version = stripV(
        repoVersion?.version ||
          asString(parsed.version, args.currentVersion || "1.0.0"),
      );
      const author = asString(
        parsed.author,
        args.currentAuthor || "Nizek Product",
      );
      const notes = asString(parsed.notes);
      const breaking = asStringArray(parsed.breaking);
      const support = asString(
        parsed.support,
        `Questions: #${args.projectName.toLowerCase().replace(/\s+/g, "-")}`,
      );

      if (!notes) {
        return { ok: false, error: "AI returned empty highlights." };
      }

      return {
        ok: true,
        version: version || "1.0.0",
        author: author || "Nizek Product",
        notes,
        breaking,
        support,
        versionSource: repoVersion?.source ?? null,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "AI request failed.",
      };
    }
  },
});

type CommitInput = {
  sha: string;
  subject: string;
  message?: string;
  authorName: string;
  authoredAt: string;
  repoFullName: string;
  matched?: string;
};

type TaskInput = {
  code: string;
  title: string;
  taskType: string;
  stage: string;
  description?: string | null;
  assigneeName?: string | null;
  viaMainCommit?: boolean;
};

type CommitDigest = {
  sha: string;
  summary: string;
  kind: string;
  apiChanges: string[];
  flowChanges: string[];
  breaking: string[];
  productNotes: string[];
};

async function chatJson(opts: {
  apiKey: string;
  system: string;
  user: unknown;
  temperature?: number;
}): Promise<Record<string, unknown>> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: JSON.stringify(opts.user) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 280)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as Record<string, unknown>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeDigest(raw: unknown, fallbackSha: string): CommitDigest {
  const row =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    sha: asString(row.sha, fallbackSha).slice(0, 40),
    summary: asString(row.summary, "Commit landed on main."),
    kind: asString(row.kind, "other"),
    apiChanges: asStringArray(row.apiChanges),
    flowChanges: asStringArray(row.flowChanges),
    breaking: asStringArray(row.breaking),
    productNotes: asStringArray(row.productNotes),
  };
}

/**
 * Thorough Nizek Docs release-notes JSON:
 * 1) digest each main commit (API / flow / product signals)
 * 2) compose a long release document from digests + tasks
 */
export const generateDoc = action({
  args: {
    projectName: v.string(),
    version: v.string(),
    author: v.string(),
    date: v.string(),
    fromIso: v.string(),
    toIso: v.string(),
    notes: v.optional(v.string()),
    breaking: v.optional(v.array(v.string())),
    support: v.optional(v.string()),
    tasks: v.array(
      v.object({
        code: v.string(),
        title: v.string(),
        taskType: v.string(),
        stage: v.string(),
        description: v.optional(v.union(v.string(), v.null())),
        assigneeName: v.optional(v.union(v.string(), v.null())),
        viaMainCommit: v.optional(v.boolean()),
      }),
    ),
    commits: v.array(
      v.object({
        sha: v.string(),
        subject: v.string(),
        message: v.optional(v.string()),
        authorName: v.string(),
        authoredAt: v.string(),
        repoFullName: v.string(),
        matched: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<Result<{ doc: Record<string, unknown>; digests: number }>> => {
    const apiKey = openaiKey();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "Set OPENAI_API_KEY in the Convex dashboard environment variables.",
      };
    }

    if (args.tasks.length === 0 && args.commits.length === 0) {
      return { ok: false, error: "Select at least one task or main commit." };
    }

    const tasks: TaskInput[] = args.tasks;
    const commits: CommitInput[] = args.commits.slice(0, 80);

    try {
      const digests: CommitDigest[] = [];
      const digestSystem = `You review git commits that landed on main for a release.
Return ONLY JSON: {"digests":[...]} with one object per input commit, same order.
Each digest:
{
  "sha": "<full sha from input>",
  "summary": "1–2 concrete sentences of what changed",
  "kind": "feature"|"fix"|"improvement"|"api"|"flow"|"infra"|"docs"|"chore"|"breaking"|"other",
  "apiChanges": ["HTTP/RPC/route/contract changes inferred from the message — empty if none"],
  "flowChanges": ["user/partner/system flow changes — empty if none"],
  "breaking": ["breaking or migration notes — empty if none"],
  "productNotes": ["product-facing bullets — empty if none"]
}
Read the full commit message body, not only the subject. Be specific. No fluff, no emojis.
If the message mentions endpoints, payloads, webhooks, auth, migrations, or UI flows, capture them.`;

      for (const batch of chunk(commits, 6)) {
        const parsed = await chatJson({
          apiKey,
          system: digestSystem,
          temperature: 0.2,
          user: {
            project: args.projectName,
            commits: batch.map((c) => ({
              sha: c.sha,
              subject: c.subject,
              body: (c.message ?? "").slice(0, 1200),
              author: c.authorName,
              at: c.authoredAt,
              repo: c.repoFullName,
              matchedTask: c.matched || null,
            })),
          },
        });
        const rows = Array.isArray(parsed.digests) ? parsed.digests : [];
        for (let i = 0; i < batch.length; i++) {
          digests.push(normalizeDigest(rows[i], batch[i]!.sha));
        }
      }

      const composeSystem = `You are the Nizek Docs generator for Nizek Startups.
Produce ONE thorough release-notes JSON document for engineering + partner audiences.
Return ONLY a JSON object (no markdown).

Root:
{
  "kind": "release-notes",
  "meta": { "title", "subtitle?", "project", "version", "date", "author", "status?", "classification?", "tags?" },
  "cover": { "enabled": true, "eyebrow?", "headline?", "description?", "recipient?" },
  "kicker"?: string,
  "sections": DocSection[]
}

Allowed section types (mix freely):
- paragraph { type, title?, body }
- list { type, title, items[], ordered?, breakBefore? }
- two-col-lists { type, left:{title,items[]}, right:{title,items[]}, breakBefore? }
- impact { type, title?, items:[{area, level:"low"|"medium"|"high", notes}], breakBefore? }
- callout { type, title?, body }
- sequence { type, title?, steps:[{actor, action, detail?}], breakBefore? }
- endpoint-table { type, title?, rows:[{method, path, purpose, owner?}], breakBefore? }
- qa { type, title?, items:[{question, answer}], breakBefore? }

Required thoroughness:
1. Highlights paragraph (rich, specific).
2. New / Improvements / Fixes lists from tasks + digests (omit empty).
3. If digests mention API work: an "API surface" section — prefer endpoint-table and/or detailed list; invent plausible paths only when strongly implied by commit text, otherwise describe the change without fake routes.
4. If digests mention flows: a sequence or paragraph+list describing the changed flow.
5. Commit-level appendix: a long ordered list or several lists grouped by theme — cover every digest, citing short sha.
6. Impact section when useful (partners, dashboard, ops, data).
7. Breaking / action required when digests or owner notes say so.
8. Upgrade / migration notes callout when relevant.
9. Support callout last.

Rules:
- Use provided project/version/author/date exactly (version bare, no leading v).
- Prefer task titles for product language; digests are ground truth for what landed on main.
- Concrete voice, no fluff, no emojis. Dates: D MMM YYYY.
- Aim for a long, complete doc (typically 10–22 sections). Use breakBefore before heavy appendix / API / flow blocks.
- Do not drop commits: every digest must appear somewhere (theme lists and/or appendix).`;

      const docParsed = await chatJson({
        apiKey,
        system: composeSystem,
        temperature: 0.35,
        user: {
          project: args.projectName,
          version: stripV(args.version),
          author: args.author,
          date: args.date,
          window: { from: args.fromIso, to: args.toIso },
          ownerNotes: args.notes || null,
          ownerBreaking: args.breaking ?? [],
          supportHint: args.support || null,
          tasks: tasks.map((t) => ({
            code: t.code,
            type: t.taskType,
            stage: t.stage,
            title: t.title,
            description: (t.description ?? "").slice(0, 600) || null,
            assignee: t.assigneeName ?? null,
            viaMainCommit: Boolean(t.viaMainCommit),
          })),
          commitDigests: digests,
          rawCommitCount: commits.length,
        },
      });

      if (docParsed.kind !== "release-notes") {
        docParsed.kind = "release-notes";
      }
      if (!Array.isArray(docParsed.sections) || docParsed.sections.length === 0) {
        return { ok: false, error: "AI returned no sections." };
      }

      const meta =
        typeof docParsed.meta === "object" && docParsed.meta !== null
          ? (docParsed.meta as Record<string, unknown>)
          : {};
      meta.project = args.projectName;
      meta.version = stripV(args.version);
      meta.author = args.author;
      meta.date = args.date;
      if (!meta.classification) meta.classification = "Internal · Release";
      docParsed.meta = meta;

      const cover =
        typeof docParsed.cover === "object" && docParsed.cover !== null
          ? (docParsed.cover as Record<string, unknown>)
          : {};
      cover.enabled = true;
      if (!cover.eyebrow) cover.eyebrow = "Release Notes";
      if (!cover.headline) {
        cover.headline = `${args.projectName} ${stripV(args.version)}`;
      }
      docParsed.cover = cover;

      if (!docParsed.kicker) {
        docParsed.kicker = `Release ${stripV(args.version)}`;
      }

      return { ok: true, doc: docParsed, digests: digests.length };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "AI request failed.",
      };
    }
  },
});
