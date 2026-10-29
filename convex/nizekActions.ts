import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  colorForId,
  deepUnescape,
  extractProjectMeta,
  extractProjectsFromList,
  extractTaskDetail,
  extractTasks,
} from "./lib/parse";

const PANEL = "https://panel.nizek.com";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

function decodeJwtExp(token: string): {
  exp?: number;
  sub?: string;
} {
  try {
    const payload = token.split(".")[1]!;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(normalized + pad);
    return JSON.parse(json) as { exp?: number; sub?: string };
  } catch {
    return {};
  }
}

async function panelFetch(
  path: string,
  cookieHeader: string,
  init?: RequestInit,
) {
  return await fetch(`${PANEL}${path}`, {
    ...init,
    headers: {
      Accept: "text/html,application/json",
      Cookie: cookieHeader,
      "User-Agent": "nizek-projects-plus/1.0",
      ...(init?.headers ?? {}),
    },
  });
}

export const rotateToken = action({
  args: {},
  handler: async (ctx): Promise<
    Result<{
      expiresAt: number | null;
      sub: string | null;
      email: string | null;
    }>
  > => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      const error =
        "Paste your panel.nizek.com Cookie header first (DevTools → Network → any request → Cookie).";
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: error,
      });
      return { ok: false, error };
    }
    const deviceId = settings.deviceId ?? crypto.randomUUID();

    const sessionRes = await panelFetch(
      "/api/auth/get-session",
      settings.cookieHeader,
    );
    type SessionPayload = {
      session?: unknown;
      user?: { name?: string; email?: string };
      needsRefresh?: boolean;
    };
    let sessionJson: SessionPayload | null = null;
    if (sessionRes.ok) {
      sessionJson = (await sessionRes.json()) as SessionPayload;
      if (sessionJson?.needsRefresh) {
        await panelFetch("/api/auth/get-session", settings.cookieHeader, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      }
    }

    const centRes = await panelFetch(
      "/api/centrifugo/token",
      settings.cookieHeader,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      },
    );
    if (!centRes.ok) {
      const error = `Centrifugo rotate failed (${centRes.status})`;
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: error,
        deviceId,
      });
      return { ok: false, error };
    }
    const { token } = (await centRes.json()) as { token: string };
    const claims = decodeJwtExp(token);
    await ctx.runMutation(internal.syncInternal.patchSettings, {
      deviceId,
      centrifugoToken: token,
      centrifugoExpiresAt: claims.exp ? claims.exp * 1000 : undefined,
      centrifugoSub: claims.sub,
      sessionName: sessionJson?.user?.name,
      sessionEmail: sessionJson?.user?.email,
      lastRotateAt: Date.now(),
      lastError: undefined,
    });
    return {
      ok: true,
      expiresAt: claims.exp ? claims.exp * 1000 : null,
      sub: claims.sub ?? null,
      email: sessionJson?.user?.email ?? null,
    };
  },
});

export const syncAll = action({
  args: {},
  handler: async (ctx): Promise<
    Result<{ projects: number; tasks: number }>
  > => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      const error =
        "Paste your panel.nizek.com Cookie header first (DevTools → Network → any request → Cookie).";
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: error,
      });
      return { ok: false, error };
    }

    await ctx.runAction(api.nizekActions.rotateToken, {});

    const listRes = await panelFetch(
      "/dashboard/projects",
      settings.cookieHeader,
    );
    if (!listRes.ok) {
      const error = `Projects list failed (${listRes.status}) — cookie may be expired.`;
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: error,
      });
      return { ok: false, error };
    }
    const listHtml = await listRes.text();
    let listed = extractProjectsFromList(listHtml);
    if (listed.length === 0) {
      const existing = await ctx.runQuery(api.projects.list, {});
      listed = existing.map((p) => ({
        id: p.nizekId,
        name: p.name,
        teamName: p.teamName ?? null,
      }));
    }
    if (listed.length === 0) {
      const error =
        "No projects found in panel HTML — cookie may be valid but list parse failed.";
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: error,
      });
      return { ok: false, error };
    }

    const projects: Array<{
      nizekId: string;
      name: string;
      teamName?: string;
      enabled: boolean;
      taskCount: number;
      color: string;
    }> = [];
    const tasks: Array<
      ReturnType<typeof extractTasks>[number] & { nizekId: string }
    > = [];

    const known = await ctx.runQuery(api.projects.list, {});
    const enabledMap = new Map(known.map((p) => [p.nizekId, p.enabled]));

    for (const item of listed) {
      const id = item.id;
      const res = await panelFetch(
        `/dashboard/projects/${id}?tab=sprints`,
        settings.cookieHeader,
      );
      if (!res.ok) continue;
      const html = await res.text();
      const un = deepUnescape(html);
      const meta = extractProjectMeta(un, id);
      const parsed = extractTasks(un, id);
      projects.push({
        nizekId: id,
        name: meta.name !== id ? meta.name : item.name,
        teamName: meta.teamName ?? item.teamName ?? undefined,
        enabled: enabledMap.get(id) ?? true,
        taskCount: parsed.length,
        color: colorForId(id),
      });
      for (const t of parsed) {
        tasks.push({ ...t, nizekId: t.id });
      }
    }

    await ctx.runMutation(internal.syncInternal.replaceAll, {
      projects,
      tasks: tasks.map((t) => ({
        nizekId: t.nizekId,
        projectId: t.projectId,
        title: t.title,
        description: t.description,
        taskNumber: t.taskNumber,
        taskType: t.taskType,
        stage: t.stage,
        order: t.order,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeName,
        assigneeImage: t.assigneeImage,
        sprintId: t.sprintId,
        sprintName: t.sprintName,
        sprintStatus: t.sprintStatus,
        stageEnteredAt: t.stageEnteredAt,
        startedAt: t.startedAt,
      })),
    });

    return { ok: true, projects: projects.length, tasks: tasks.length };
  },
});

export const fetchTaskDetail = action({
  args: {
    nizekId: v.string(),
    projectId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<{
      description: string | null;
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
      refreshed: boolean;
    }>
  > => {
    const empty = {
      questions: [] as Array<{ question: string; answer: string }>,
      attachments: [] as Array<{ name: string; url: string }>,
      comments: [] as Array<{
        author: string;
        body: string;
        at?: string | null;
        imageUrl?: string | null;
      }>,
      proofOfWork: [] as Array<{
        name: string;
        url?: string | null;
        author?: string | null;
        at?: string | null;
      }>,
      activity: [] as Array<{
        action: string;
        author: string;
        summary: string;
        at?: string | null;
      }>,
    };

    const settings = await ctx.runQuery(api.settings.get, {});
    const existing = await ctx.runQuery(api.tasks.get, {
      nizekId: args.nizekId,
    });
    if (!existing) {
      return { ok: false, error: "Task not found locally — sync first." };
    }

    const cached = existing.detailExtras
      ? (JSON.parse(existing.detailExtras) as typeof empty)
      : empty;

    if (!settings?.cookieHeader) {
      return {
        ok: true,
        description: existing.description ?? null,
        ...cached,
        refreshed: false,
      };
    }

    const projectId = args.projectId ?? existing.projectId;
    const res = await panelFetch(
      `/dashboard/projects/${projectId}/tasks/${args.nizekId}`,
      settings.cookieHeader,
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Task detail fetch failed (${res.status}) — cookie may be expired.`,
      };
    }
    const html = await res.text();
    const detail = extractTaskDetail(html, args.nizekId);
    if (!detail) {
      return {
        ok: true,
        description: existing.description ?? null,
        ...cached,
        refreshed: false,
      };
    }

    const extras = {
      questions: detail.questions,
      attachments: detail.attachments,
      comments: detail.comments,
      proofOfWork: detail.proofOfWork,
      activity: detail.activity,
    };

    // Only overwrite fields when Panel returned a real value — detail pages
    // often omit sprint/dates and would otherwise blank out synced board data.
    const keep = <T,>(next: T | null | undefined) =>
      next != null && next !== "" ? next : undefined;

    await ctx.runMutation(internal.syncInternal.patchTask, {
      nizekId: args.nizekId,
      description: keep(detail.description),
      title: keep(detail.title),
      stage: keep(detail.stage),
      priority: keep(detail.priority),
      estimatedMinutes:
        detail.estimatedMinutes != null
          ? detail.estimatedMinutes
          : undefined,
      assigneeName: keep(detail.assigneeName),
      assigneeImage: keep(detail.assigneeImage),
      sprintName: keep(detail.sprintName),
      sprintStatus: keep(detail.sprintStatus),
      stageEnteredAt: keep(detail.stageEnteredAt),
      startedAt: keep(detail.startedAt),
      detailExtras: JSON.stringify(extras),
    });

    return {
      ok: true,
      description: detail.description,
      ...extras,
      refreshed: true,
    };
  },
});

export const rotateTokenInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runAction(api.nizekActions.rotateToken, {});
    if (!result.ok) {
      console.warn("scheduled rotate failed:", result.error);
    }
  },
});
