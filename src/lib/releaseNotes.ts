import { taskCode } from "./stages";

export type ReleaseTask = {
  nizekId: string;
  projectId: string;
  projectName: string;
  title: string;
  description?: string | null;
  taskNumber: number;
  taskType: string;
  stage: string;
  priority: string;
  assigneeName?: string | null;
  sprintName?: string | null;
  stageEnteredAt?: string | null;
  startedAt?: string | null;
  viaMainCommit?: boolean;
};

export type ReleaseCommit = {
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
};

export type ReleaseMeta = {
  projectName: string;
  version: string;
  author: string;
  fromIso: string;
  toIso: string;
  notes?: string;
  breaking?: string[];
  support?: string;
};

export type ReleaseDoc = {
  kind: "release-notes";
  meta: {
    title: string;
    subtitle: string;
    project: string;
    version: string;
    date: string;
    author: string;
    status: "draft";
    classification: string;
    tags: string[];
  };
  cover: {
    enabled: true;
    eyebrow: string;
    headline: string;
    description: string;
    recipient?: string;
  };
  kicker: string;
  sections: Array<Record<string, unknown>>;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDocDate(iso: string | Date = new Date()) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatRangeLabel(fromIso: string, toIso: string) {
  return `${formatDocDate(fromIso)} – ${formatDocDate(toIso)}`;
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function bucketTitle(type: string) {
  if (type === "FEATURE") return "New";
  if (type === "ENHANCEMENT") return "Improvements";
  if (type === "BUG") return "Fixes";
  return "Other";
}

function itemLine(task: ReleaseTask) {
  const code = taskCode(task.taskType, task.taskNumber);
  const desc = task.description?.trim();
  if (desc) {
    const oneLine = desc.replace(/\s+/g, " ").slice(0, 140);
    return `${code} — ${task.title}: ${oneLine}${desc.length > 140 ? "…" : ""}`;
  }
  return `${code} — ${task.title}`;
}

function groupTasks(tasks: ReleaseTask[]) {
  const order = ["New", "Improvements", "Fixes", "Other"] as const;
  const groups = new Map<string, string[]>();
  for (const title of order) groups.set(title, []);
  for (const task of tasks) {
    const key = bucketTitle(task.taskType);
    groups.get(key)!.push(itemLine(task));
  }
  return order
    .map((title) => ({ title, items: groups.get(title) ?? [] }))
    .filter((g) => g.items.length > 0);
}

function commitLine(c: ReleaseCommit) {
  const match = c.matchedTasks[0];
  const matchBit = match
    ? ` → ${match.taskCode ?? match.taskNizekId.slice(0, 8)}${match.taskTitle ? ` ${match.taskTitle}` : ""}`
    : "";
  return `${shortSha(c.sha)} — ${c.subject}${matchBit} (${c.authorName})`;
}

/** Unmatched main commits that should surface as changelog lines. */
function unmatchedCommitItems(commits: ReleaseCommit[]) {
  return commits
    .filter((c) => c.matchedTasks.length === 0)
    .map(commitLine);
}

const APIISH_RE =
  /\b(api|endpoint|graphql|webhook|rpc|rest|route|\/v\d|openapi|swagger|payload|request|response|auth|oauth|jwt|migration|schema|contract)\b/i;
const FLOWISH_RE =
  /\b(flow|journey|onboarding|checkout|webhook|callback|pipeline|sequence|handshake|redirect|funnel)\b/i;

function commitBody(c: ReleaseCommit, max = 900) {
  const body = c.message.split("\n").slice(1).join("\n").trim();
  if (!body) return "";
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

export function buildReleaseBrief(
  tasks: ReleaseTask[],
  commits: ReleaseCommit[],
  meta: ReleaseMeta,
) {
  const range = formatRangeLabel(meta.fromIso, meta.toIso);
  const groups = groupTasks(tasks);
  const lines: string[] = [
    `Write a thorough release document for ${meta.projectName} version ${meta.version}.`,
    `Release window: ${range}.`,
    `Author: ${meta.author}.`,
    `Audience: product + engineering partners.`,
    "",
    "Ground truth: finished Nizek tasks + every selected commit on main.",
    "Read each commit message body. Call out API/contract changes and user/partner flow changes.",
    "Produce a long Nizek Docs release-notes JSON: highlights, New/Improvements/Fixes,",
    "API surface, flow changes, impact, full commit appendix, breaking, support.",
    "",
  ];

  if (meta.notes?.trim()) {
    lines.push("Extra context from the release owner:", meta.notes.trim(), "");
  }

  lines.push(
    `Main commits in window: ${commits.length}.`,
    `Tasks included: ${tasks.length}.`,
    "",
  );

  lines.push(`Tasks (${tasks.length}):`);
  if (groups.length === 0) {
    lines.push("- (none selected)");
  } else {
    for (const group of groups) {
      lines.push("", `${group.title}:`);
      for (const item of group.items) lines.push(`- ${item}`);
    }
  }

  for (const t of tasks) {
    const desc = t.description?.trim();
    if (!desc) continue;
    lines.push(
      "",
      `Task detail ${taskCode(t.taskType, t.taskNumber)} — ${t.title}:`,
      desc.slice(0, 500) + (desc.length > 500 ? "…" : ""),
    );
  }

  lines.push("", `Commits on main (${commits.length}) — read each carefully:`);
  if (commits.length === 0) {
    lines.push("- (none selected)");
  } else {
    for (const c of commits) {
      const matches =
        c.matchedTasks.length === 0
          ? "unmatched"
          : c.matchedTasks
              .map(
                (m) =>
                  `${m.status} ${m.taskCode ?? m.taskNizekId}${m.taskTitle ? ` “${m.taskTitle}”` : ""}`,
              )
              .join("; ");
      const flags = [
        APIISH_RE.test(c.message) ? "api?" : null,
        FLOWISH_RE.test(c.message) ? "flow?" : null,
      ]
        .filter(Boolean)
        .join(",");
      lines.push(
        "",
        `### ${shortSha(c.sha)} · ${c.repoFullName} · ${c.authorName}${flags ? ` · ${flags}` : ""}`,
        c.subject,
        `matched: ${matches}`,
      );
      const body = commitBody(c);
      if (body) lines.push(body);
    }
  }

  if (meta.breaking?.length) {
    lines.push("", "Breaking / action required:");
    for (const b of meta.breaking) {
      const t = b.trim();
      if (t) lines.push(`- ${t}`);
    }
  } else {
    lines.push("", "No owner-supplied breaking changes — infer only if commits imply them.");
  }

  if (meta.support?.trim()) {
    lines.push("", `Support note: ${meta.support.trim()}`);
  }

  return lines.join("\n");
}

export function buildReleaseDoc(
  tasks: ReleaseTask[],
  commits: ReleaseCommit[],
  meta: ReleaseMeta,
): ReleaseDoc {
  const range = formatRangeLabel(meta.fromIso, meta.toIso);
  const groups = groupTasks(tasks);
  const featureCount = tasks.filter((t) => t.taskType === "FEATURE").length;
  const fixCount = tasks.filter((t) => t.taskType === "BUG").length;
  const improveCount = tasks.filter((t) => t.taskType === "ENHANCEMENT").length;
  const unmatched = unmatchedCommitItems(commits);

  const highlightParts: string[] = [];
  if (featureCount) highlightParts.push(`${featureCount} new`);
  if (improveCount) highlightParts.push(`${improveCount} improvements`);
  if (fixCount) highlightParts.push(`${fixCount} fixes`);
  if (commits.length) highlightParts.push(`${commits.length} commits on main`);

  const highlightBody =
    highlightParts.length > 0
      ? `${meta.projectName} ${meta.version} ships ${highlightParts.join(", ")} across ${range}.`
      : `${meta.projectName} ${meta.version} covers work completed ${range}.`;

  const sections: Array<Record<string, unknown>> = [
    {
      type: "paragraph",
      title: "Highlights",
      body: meta.notes?.trim()
        ? `${highlightBody} ${meta.notes.trim()}`
        : highlightBody,
    },
  ];

  for (const group of groups) {
    sections.push({
      type: "list",
      title: group.title,
      items: group.items,
    });
  }

  const apiish = commits.filter((c) => APIISH_RE.test(c.message));
  if (apiish.length) {
    sections.push({
      breakBefore: true,
      type: "list",
      title: "API / contract signals from main",
      items: apiish.map((c) => {
        const body = commitBody(c, 180);
        return body
          ? `${shortSha(c.sha)} — ${c.subject}: ${body.replace(/\s+/g, " ")}`
          : commitLine(c);
      }),
    });
  }

  const flowish = commits.filter((c) => FLOWISH_RE.test(c.message));
  if (flowish.length) {
    sections.push({
      type: "list",
      title: "Flow signals from main",
      items: flowish.map(commitLine),
    });
  }

  if (unmatched.length) {
    sections.push({
      type: "list",
      title: "Also landed on main (unmatched)",
      items: unmatched,
    });
  }

  if (commits.length) {
    sections.push({
      breakBefore: true,
      type: "list",
      title: "Commit appendix (main)",
      ordered: true,
      items: commits.map((c) => {
        const body = commitBody(c, 220).replace(/\s+/g, " ");
        const match = c.matchedTasks[0];
        const matchBit = match
          ? ` · ${match.taskCode ?? match.taskNizekId}`
          : "";
        return body
          ? `${shortSha(c.sha)} — ${c.subject}${matchBit}. ${body}`
          : `${commitLine(c)}${matchBit}`;
      }),
    });
  }

  const breaking = (meta.breaking ?? []).map((b) => b.trim()).filter(Boolean);
  if (breaking.length) {
    sections.push({
      breakBefore: true,
      type: "list",
      title: "Breaking / action required",
      items: breaking,
    });
  }

  sections.push({
    type: "callout",
    title: "Support",
    body:
      meta.support?.trim() ||
      "Questions: reach the Nizek team on the project channel.",
  });

  const version = meta.version.replace(/^v/i, "");

  return {
    kind: "release-notes",
    meta: {
      title: `${meta.projectName} ${version} release notes`,
      subtitle: `What shipped on main ${range}.`,
      project: meta.projectName,
      version,
      date: formatDocDate(meta.toIso),
      author: meta.author,
      status: "draft",
      classification: "Internal · Release",
      tags: ["release", version, "main"],
    },
    cover: {
      enabled: true,
      eyebrow: "Release Notes",
      headline: `${meta.projectName} ${version}`,
      description: `What shipped for ${meta.projectName} on main in this release.`,
      recipient: "Product & engineering",
    },
    kicker: `Release ${version}`,
    sections,
  };
}

const BREAKING_RE =
  /\b(breaking|break(?:s|ing)?\s+change|migrat(?:e|ion)|deprecated?|remove[sd]?|incompatib|sunset|no longer support|must update|api change)\b/i;

const VERSION_RE = /\bv?(\d+\.\d+(?:\.\d+)?)\b/i;
const CONVENTIONAL_BREAKING_RE = /^(\w+)(\(.+\))?!:/;

function topTitles(tasks: ReleaseTask[], type: string, limit = 3) {
  return tasks
    .filter((t) => t.taskType === type)
    .slice(0, limit)
    .map((t) => t.title.replace(/\s+/g, " ").trim());
}

function collectBreaking(tasks: ReleaseTask[], commits: ReleaseCommit[]) {
  const lines: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || line.length < 8) return;
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(line.length > 160 ? `${line.slice(0, 157)}…` : line);
  };

  for (const t of tasks) {
    const hay = `${t.title}\n${t.description ?? ""}`;
    if (BREAKING_RE.test(hay)) {
      push(`${taskCode(t.taskType, t.taskNumber)} — ${t.title}`);
    }
  }

  for (const c of commits) {
    if (CONVENTIONAL_BREAKING_RE.test(c.subject) || BREAKING_RE.test(c.message)) {
      push(`${c.sha.slice(0, 7)} — ${c.subject}`);
    }
  }

  return lines.slice(0, 8);
}

function suggestVersion(
  tasks: ReleaseTask[],
  commits: ReleaseCommit[],
  toIso: string,
  breakingCount: number,
) {
  for (const c of commits) {
    const fromMsg = c.message.match(VERSION_RE);
    if (fromMsg?.[1] && /release|version|tag/i.test(c.message)) {
      return fromMsg[1];
    }
  }

  const d = new Date(toIso);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (breakingCount > 0) return `${y}.${m}.0`;
    if (tasks.some((t) => t.taskType === "FEATURE")) return `${y}.${m}.0`;
    return `${y}.${m}.1`;
  }

  return breakingCount > 0 ? "1.0.0" : "0.1.0";
}

function suggestAuthor(commits: ReleaseCommit[], fallback: string) {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const name = c.authorName.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  if (best && bestN >= 2 && counts.size <= 3) {
    return best;
  }
  if (commits.length > 0 && counts.size === 1 && best) return best;
  return fallback || "Nizek Product";
}

function suggestHighlights(
  projectName: string,
  tasks: ReleaseTask[],
  commits: ReleaseCommit[],
  fromIso: string,
  toIso: string,
) {
  const range = formatRangeLabel(fromIso, toIso);
  const features = topTitles(tasks, "FEATURE");
  const fixes = topTitles(tasks, "BUG");
  const improve = topTitles(tasks, "ENHANCEMENT");
  const parts: string[] = [];

  parts.push(
    `${projectName} ships ${tasks.length} task${tasks.length === 1 ? "" : "s"} and ${commits.length} commit${commits.length === 1 ? "" : "s"} on main (${range}).`,
  );

  if (features.length) {
    parts.push(`Highlights include ${features.join("; ")}.`);
  } else if (improve.length) {
    parts.push(`Improvements cover ${improve.join("; ")}.`);
  }

  if (fixes.length) {
    parts.push(`Fixes: ${fixes.join("; ")}.`);
  }

  const unmatched = commits.filter((c) => c.matchedTasks.length === 0).length;
  if (unmatched > 0 && unmatched === commits.length) {
    parts.push("Changelog also leans on unmatched main commits in this window.");
  } else if (commits.some((c) => c.matchedTasks.length > 0)) {
    parts.push("Main commits are cross-checked against matched Nizek tasks.");
  }

  return parts.join(" ");
}

function suggestSupport(projectName: string, commits: ReleaseCommit[]) {
  const repo = commits[0]?.repoFullName;
  if (repo) {
    return `Questions: #${projectName.toLowerCase().replace(/\s+/g, "-")} · ${repo}`;
  }
  return `Questions: #${projectName.toLowerCase().replace(/\s+/g, "-")}`;
}

/** Draft version / highlights / breaking / support from selected tasks + main commits. */
export function suggestReleaseMeta(opts: {
  projectName: string;
  tasks: ReleaseTask[];
  commits: ReleaseCommit[];
  fromIso: string;
  toIso: string;
  currentAuthor?: string;
}): {
  version: string;
  author: string;
  notes: string;
  breakingText: string;
  support: string;
} {
  const breaking = collectBreaking(opts.tasks, opts.commits);
  return {
    version: suggestVersion(
      opts.tasks,
      opts.commits,
      opts.toIso,
      breaking.length,
    ),
    author: suggestAuthor(opts.commits, opts.currentAuthor ?? "Nizek Product"),
    notes: suggestHighlights(
      opts.projectName,
      opts.tasks,
      opts.commits,
      opts.fromIso,
      opts.toIso,
    ),
    breakingText: breaking.join("\n"),
    support: suggestSupport(opts.projectName, opts.commits),
  };
}

export function docsImportUrl(docsUrl: string, doc: ReleaseDoc) {
  const base = docsUrl.replace(/\/$/, "");
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(doc))));
  return `${base}/#import=${payload}`;
}
