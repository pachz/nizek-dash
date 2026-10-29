"use node";

import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { parseTaskCode, taskCode } from "./lib/taskCode";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

type CandidateTask = {
  nizekId: string;
  projectId: string;
  title: string;
  description: string | null;
  taskNumber: number;
  taskType: string;
  stage: string;
  assigneeName: string | null;
  code: string;
};

type UnmatchedCommit = {
  _id: Id<"commits">;
  sha: string;
  message: string;
  authorName: string;
  authoredAt: string;
  repoId: Id<"gitRepos">;
  projectIds: string[];
  repoFullName: string;
};

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function heuristicMatches(
  message: string,
  tasks: CandidateTask[],
): Array<{
  task: CandidateTask;
  confidence: number;
  reason: string;
}> {
  const hits: Array<{
    task: CandidateTask;
    confidence: number;
    reason: string;
  }> = [];
  const msg = message;
  const normMsg = normalize(message);
  const codesInMsg = parseTaskCode(msg);

  for (const task of tasks) {
    if (codesInMsg.includes(task.code)) {
      hits.push({
        task,
        confidence: 0.95,
        reason: `Commit mentions task code ${task.code}`,
      });
      continue;
    }
    if (msg.includes(task.nizekId)) {
      hits.push({
        task,
        confidence: 0.92,
        reason: `Commit mentions task id ${task.nizekId}`,
      });
      continue;
    }
    const title = normalize(task.title);
    if (title.length >= 12 && normMsg.includes(title)) {
      hits.push({
        task,
        confidence: 0.75,
        reason: `Commit message contains full task title`,
      });
      continue;
    }
    const tokens = title
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 5)
      .slice(0, 6);
    if (tokens.length >= 2) {
      const matched = tokens.filter((t) => normMsg.includes(t));
      if (matched.length >= Math.min(3, tokens.length)) {
        hits.push({
          task,
          confidence: 0.55,
          reason: `Commit shares title keywords: ${matched.slice(0, 3).join(", ")}`,
        });
      }
    }
  }

  const byId = new Map<string, (typeof hits)[number]>();
  for (const h of hits) {
    const prev = byId.get(h.task.nizekId);
    if (!prev || h.confidence > prev.confidence) byId.set(h.task.nizekId, h);
  }
  return [...byId.values()].sort((a, b) => b.confidence - a.confidence);
}

type AiSuggestion = {
  sha: string;
  taskNizekId: string;
  confidence: number;
  reason: string;
};

async function callOpenAi(
  apiKey: string,
  commits: Array<{
    sha: string;
    message: string;
    authorName: string;
    repoFullName: string;
  }>,
  tasks: CandidateTask[],
): Promise<AiSuggestion[]> {
  const commitPayload = commits.map((c) => ({
    sha: c.sha.slice(0, 7),
    fullSha: c.sha,
    message: c.message.slice(0, 500),
    author: c.authorName,
    repo: c.repoFullName,
  }));
  const taskPayload = tasks.slice(0, 80).map((t) => ({
    id: t.nizekId,
    code: t.code,
    title: t.title.slice(0, 120),
    stage: t.stage,
    assignee: t.assigneeName,
    description: (t.description ?? "").slice(0, 160),
  }));

  const system = `You match git commits to project tasks.
Return ONLY JSON: {"matches":[{"sha":"<fullSha>","taskNizekId":"<id>","confidence":0-1,"reason":"..."}]}
Rules:
- Only match when reasonably sure (confidence >= 0.55).
- Prefer task codes in messages, then semantic overlap of title/description.
- A commit may match 0–2 tasks. Skip unclear commits.
- Use fullSha exactly as given. taskNizekId must be from the candidate list.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({ commits: commitPayload, tasks: taskPayload }),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: { matches?: AiSuggestion[] };
  try {
    parsed = JSON.parse(content) as { matches?: AiSuggestion[] };
  } catch {
    return [];
  }
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

function openaiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

/** Safe status for Admin — never returns the key itself. */
export const openaiStatus = action({
  args: {},
  handler: async (): Promise<{ configured: boolean }> => {
    return { configured: Boolean(openaiKey()) };
  },
});

export const runMatching = action({
  args: {},
  handler: async (ctx): Promise<
    Result<{ heuristic: number; ai: number; scanned: number }>
  > => {
    try {
      const unmatched = (await ctx.runQuery(
        internal.commits.unmatchedForMatching,
        { limit: 120 },
      )) as UnmatchedCommit[];

      let heuristicCount = 0;
      const byKey = new Map<string, UnmatchedCommit[]>();
      for (const c of unmatched) {
        const key = [...c.projectIds].sort().join(",");
        const list = byKey.get(key) ?? [];
        list.push(c);
        byKey.set(key, list);
      }

      for (const [, commits] of byKey) {
        const projectIds = commits[0]!.projectIds;
        const rawTasks = await ctx.runQuery(internal.commits.tasksForProjects, {
          projectIds,
        });
        const tasks: CandidateTask[] = rawTasks.map((t) => ({
          nizekId: t.nizekId,
          projectId: t.projectId,
          title: t.title,
          description: t.description,
          taskNumber: t.taskNumber,
          taskType: t.taskType,
          stage: t.stage,
          assigneeName: t.assigneeName,
          code: taskCode(t.taskType, t.taskNumber),
        }));

        for (const c of commits) {
          const hits = heuristicMatches(c.message, tasks).filter(
            (h) => h.confidence >= 0.55,
          );
          for (const h of hits.slice(0, 3)) {
            await ctx.runMutation(internal.commits.upsertMatch, {
              commitId: c._id,
              taskNizekId: h.task.nizekId,
              projectId: h.task.projectId,
              confidence: h.confidence,
              reason: h.reason,
              method: "heuristic",
              status: "suggested",
            });
            heuristicCount++;
          }
        }
      }

      let aiMatched = 0;
      let aiError: string | null = null;
      try {
        const apiKey = openaiKey();
        if (!apiKey) {
          throw new Error(
            "Set OPENAI_API_KEY in the Convex dashboard environment variables.",
          );
        }

        const stillUnmatched = (await ctx.runQuery(
          internal.commits.unmatchedForMatching,
          { limit: 40 },
        )) as UnmatchedCommit[];

        const aiByKey = new Map<string, UnmatchedCommit[]>();
        for (const c of stillUnmatched) {
          const key = [...c.projectIds].sort().join(",");
          const list = aiByKey.get(key) ?? [];
          list.push(c);
          aiByKey.set(key, list);
        }

        for (const [, commits] of aiByKey) {
          const projectIds = commits[0]!.projectIds;
          const rawTasks = await ctx.runQuery(
            internal.commits.tasksForProjects,
            { projectIds },
          );
          const tasks: CandidateTask[] = rawTasks.map((t) => ({
            nizekId: t.nizekId,
            projectId: t.projectId,
            title: t.title,
            description: t.description,
            taskNumber: t.taskNumber,
            taskType: t.taskType,
            stage: t.stage,
            assigneeName: t.assigneeName,
            code: taskCode(t.taskType, t.taskNumber),
          }));
          if (tasks.length === 0) continue;

          for (let i = 0; i < commits.length; i += 12) {
            const batch = commits.slice(i, i + 12);
            const suggestions = await callOpenAi(apiKey, batch, tasks);
            const bySha = new Map(batch.map((c) => [c.sha, c]));
            const taskIds = new Set(tasks.map((t) => t.nizekId));

            for (const s of suggestions) {
              if (!s.taskNizekId || !taskIds.has(s.taskNizekId)) continue;
              if (typeof s.confidence !== "number" || s.confidence < 0.55)
                continue;
              const commit =
                bySha.get(s.sha) ??
                batch.find(
                  (c) =>
                    c.sha === s.sha ||
                    c.sha.startsWith(s.sha) ||
                    s.sha.startsWith(c.sha.slice(0, 7)),
                );
              if (!commit) continue;
              const task = tasks.find((t) => t.nizekId === s.taskNizekId)!;
              await ctx.runMutation(internal.commits.upsertMatch, {
                commitId: commit._id,
                taskNizekId: task.nizekId,
                projectId: task.projectId,
                confidence: Math.min(1, Math.max(0, s.confidence)),
                reason: (s.reason || "AI semantic match").slice(0, 400),
                method: "ai",
                status: "suggested",
                model: "gpt-4o-mini",
              });
              aiMatched++;
            }
          }
        }
      } catch (e) {
        aiError = e instanceof Error ? e.message : String(e);
      }

      await ctx.runMutation(internal.commits.patchCommitSettings, {
        lastMatchAt: Date.now(),
        lastMatchError: aiError,
      });

      return {
        ok: true,
        heuristic: heuristicCount,
        ai: aiMatched,
        scanned: unmatched.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.commits.patchCommitSettings, {
        lastMatchError: msg.slice(0, 500),
      });
      return { ok: false, error: msg };
    }
  },
});

export const runMatchingInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runAction(api.matchActions.runMatching, {});
    if (!result.ok) {
      console.warn("scheduled matching failed:", result.error);
    } else {
      console.log(
        `scheduled matching ok: heuristic ${result.heuristic} · ai ${result.ai} · scanned ${result.scanned}`,
      );
    }
  },
});
