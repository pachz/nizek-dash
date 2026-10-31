"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  BUSINESS_TZ,
  lastBusinessDays,
} from "./lib/businessDays";

declare const process: { env: Record<string, string | undefined> };

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

export type HighlightKind = "ship" | "progress" | "risk" | "chat" | "commit";
export type Momentum = "up" | "flat" | "down";

export type SummaryPayload = {
  headline: string;
  narrative: string;
  highlights: Array<{ title: string; detail: string; kind: HighlightKind }>;
  byProject: Array<{
    project: string;
    summary: string;
    momentum: Momentum;
  }>;
  risks: string[];
  people: Array<{ name: string; note: string }>;
  stats: {
    commits: number;
    messages: number;
    tasksTouched: number;
    activeProjects: number;
  };
};

export type SummaryView = {
  windowKey: string;
  fromIso: string;
  toIso: string;
  days: string[];
  label: string;
  timeZone: string;
  cached: boolean;
  model: string;
  generatedAt: number;
  inputCounts: {
    commits: number;
    messages: number;
    tasks: number;
    projects: number;
  };
  summary: SummaryPayload;
};

function openaiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

function openaiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asKind(value: unknown): HighlightKind {
  const s = asString(value);
  if (
    s === "ship" ||
    s === "progress" ||
    s === "risk" ||
    s === "chat" ||
    s === "commit"
  ) {
    return s;
  }
  return "progress";
}

function asMomentum(value: unknown): Momentum {
  const s = asString(value);
  if (s === "up" || s === "flat" || s === "down") return s;
  return "flat";
}

async function chatJson(opts: {
  apiKey: string;
  system: string;
  user: unknown;
  temperature?: number;
}): Promise<Record<string, unknown>> {
  const model = openaiModel();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.4,
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

function normalizePayload(
  raw: Record<string, unknown>,
  counts: SummaryView["inputCounts"],
): SummaryPayload {
  const highlightsRaw = Array.isArray(raw.highlights) ? raw.highlights : [];
  const byProjectRaw = Array.isArray(raw.byProject) ? raw.byProject : [];
  const peopleRaw = Array.isArray(raw.people) ? raw.people : [];
  const statsRaw =
    typeof raw.stats === "object" && raw.stats !== null
      ? (raw.stats as Record<string, unknown>)
      : {};

  return {
    headline:
      asString(raw.headline) ||
      "Two business days of shipping, chat, and board motion.",
    narrative:
      asString(raw.narrative) ||
      "Activity was light or sparse across commits, tasks, and chats in this window.",
    highlights: highlightsRaw
      .slice(0, 8)
      .map((item) => {
        const row =
          typeof item === "object" && item !== null
            ? (item as Record<string, unknown>)
            : {};
        return {
          title: asString(row.title, "Highlight"),
          detail: asString(row.detail),
          kind: asKind(row.kind),
        };
      })
      .filter((h) => h.title),
    byProject: byProjectRaw
      .slice(0, 12)
      .map((item) => {
        const row =
          typeof item === "object" && item !== null
            ? (item as Record<string, unknown>)
            : {};
        return {
          project: asString(row.project, "Project"),
          summary: asString(row.summary),
          momentum: asMomentum(row.momentum),
        };
      })
      .filter((p) => p.project),
    risks: asStringArray(raw.risks, 6),
    people: peopleRaw
      .slice(0, 10)
      .map((item) => {
        const row =
          typeof item === "object" && item !== null
            ? (item as Record<string, unknown>)
            : {};
        return {
          name: asString(row.name),
          note: asString(row.note),
        };
      })
      .filter((p) => p.name),
    stats: {
      commits:
        typeof statsRaw.commits === "number"
          ? statsRaw.commits
          : counts.commits,
      messages:
        typeof statsRaw.messages === "number"
          ? statsRaw.messages
          : counts.messages,
      tasksTouched:
        typeof statsRaw.tasksTouched === "number"
          ? statsRaw.tasksTouched
          : counts.tasks,
      activeProjects:
        typeof statsRaw.activeProjects === "number"
          ? statsRaw.activeProjects
          : counts.projects,
    },
  };
}

function parseCachedRow(row: {
  windowKey: string;
  fromIso: string;
  toIso: string;
  days: string[];
  headline: string;
  narrative: string;
  payloadJson: string;
  model: string;
  generatedAt: number;
  inputCounts: SummaryView["inputCounts"];
}): SummaryPayload {
  try {
    const parsed = JSON.parse(row.payloadJson) as Record<string, unknown>;
    return normalizePayload(parsed, row.inputCounts);
  } catch {
    return {
      headline: row.headline,
      narrative: row.narrative,
      highlights: [],
      byProject: [],
      risks: [],
      people: [],
      stats: {
        commits: row.inputCounts.commits,
        messages: row.inputCounts.messages,
        tasksTouched: row.inputCounts.tasks,
        activeProjects: row.inputCounts.projects,
      },
    };
  }
}

const SYSTEM_PROMPT = `You are an internal ops digest writer for Nizek Startups.
Given commits, panel chat messages, and board tasks from the last two business days (Sun–Thu work week, Asia/Kuwait), write a crisp company-wide summary.

Return ONLY JSON with this shape:
{
  "headline": "one punchy sentence",
  "narrative": "2-3 short paragraphs separated by \\n\\n — factual, specific, no fluff",
  "highlights": [{"title":"...","detail":"...","kind":"ship|progress|risk|chat|commit"}],
  "byProject": [{"project":"...","summary":"...","momentum":"up|flat|down"}],
  "risks": ["..."],
  "people": [{"name":"...","note":"..."}],
  "stats": {"commits":0,"messages":0,"tasksTouched":0,"activeProjects":0}
}

Rules:
- Prefer concrete names, task codes, repos, and thread topics from the data.
- If a signal is thin, say so — do not invent work.
- highlights: 3–7 items. byProject: only projects with real signal.
- people: notable contributors from commits/chats/assignees (max 8).
- stats must reflect the provided counts (use the input counts object).
- Tone: calm, sharp, executive — not hype.`;

export const generate = action({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Result<SummaryView>> => {
    const window = lastBusinessDays({ count: 2, timeZone: BUSINESS_TZ });

    if (!args.force) {
      const cached = await ctx.runQuery(internal.summary.getCachedInternal, {
        windowKey: window.windowKey,
      });
      if (cached) {
        const summary = parseCachedRow(cached);
        return {
          ok: true,
          windowKey: window.windowKey,
          fromIso: window.fromIso,
          toIso: window.toIso,
          days: window.days,
          label: window.label,
          timeZone: window.timeZone,
          cached: true,
          model: cached.model,
          generatedAt: cached.generatedAt,
          inputCounts: cached.inputCounts,
          summary,
        };
      }
    }

    const key = openaiKey();
    if (!key) {
      return {
        ok: false,
        error:
          "OPENAI_API_KEY is not set on the Convex deployment. Set it in the Convex dashboard.",
      };
    }

    const gathered = await ctx.runQuery(internal.summary.gatherForWindow, {
      fromIso: window.fromIso,
      toIso: window.toIso,
    });

    const inputCounts = gathered.counts;
    const model = openaiModel();

    try {
      const raw = await chatJson({
        apiKey: key,
        system: SYSTEM_PROMPT,
        temperature: 0.35,
        user: {
          window: {
            label: window.label,
            days: window.days,
            fromIso: window.fromIso,
            toIso: window.toIso,
            timeZone: window.timeZone,
          },
          counts: inputCounts,
          commits: gathered.commits,
          messages: gathered.messages,
          tasks: gathered.tasks,
        },
      });

      const summary = normalizePayload(raw, inputCounts);
      // Prefer measured input counts for KPIs
      summary.stats = {
        commits: inputCounts.commits,
        messages: inputCounts.messages,
        tasksTouched: inputCounts.tasks,
        activeProjects: inputCounts.projects,
      };

      const generatedAt = Date.now();
      await ctx.runMutation(internal.summary.saveSummary, {
        windowKey: window.windowKey,
        fromIso: window.fromIso,
        toIso: window.toIso,
        days: window.days,
        headline: summary.headline,
        narrative: summary.narrative,
        payloadJson: JSON.stringify(summary),
        statsJson: JSON.stringify(summary.stats),
        model,
        generatedAt,
        inputCounts,
      });

      return {
        ok: true,
        windowKey: window.windowKey,
        fromIso: window.fromIso,
        toIso: window.toIso,
        days: window.days,
        label: window.label,
        timeZone: window.timeZone,
        cached: false,
        model,
        generatedAt,
        inputCounts,
        summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  },
});
