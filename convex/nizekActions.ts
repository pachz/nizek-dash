import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  colorForId,
  deepUnescape,
  extractProjectMeta,
  extractTasks,
} from "./lib/parse";

const PANEL = "https://panel.nizek.com";

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
  handler: async (ctx) => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      throw new Error(
        "Paste your panel.nizek.com Cookie header first (DevTools → Network → any request → Cookie).",
      );
    }
    const deviceId = settings.deviceId ?? crypto.randomUUID();

    // better-auth session refresh when the client signals needsRefresh
    const sessionRes = await panelFetch("/api/auth/get-session", settings.cookieHeader);
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
      const err = `Centrifugo rotate failed (${centRes.status})`;
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: err,
        deviceId,
      });
      throw new Error(err);
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
      expiresAt: claims.exp ? claims.exp * 1000 : null,
      sub: claims.sub ?? null,
      email: sessionJson?.user?.email ?? null,
    };
  },
});

export const syncAll = action({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      throw new Error(
        "Paste your panel.nizek.com Cookie header first (DevTools → Network → any request → Cookie).",
      );
    }

    // Keep realtime JWT fresh while syncing
    try {
      await ctx.runAction(api.nizekActions.rotateToken, {});
    } catch {
      // sync can still proceed if rotate fails after cookie issues surface below
    }

    const listRes = await panelFetch(
      "/dashboard/projects",
      settings.cookieHeader,
    );
    if (!listRes.ok) {
      const err = `Projects list failed (${listRes.status}) — cookie may be expired.`;
      await ctx.runMutation(internal.syncInternal.patchSettings, {
        lastError: err,
      });
      throw new Error(err);
    }
    const listHtml = await listRes.text();
    let ids = [
      ...new Set(
        [...listHtml.matchAll(/\/dashboard\/projects\/(cm[a-z0-9]+)/g)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    if (ids.length === 0) {
      const existing = await ctx.runQuery(api.projects.list, {});
      ids = existing.map((p) => p.nizekId);
    }
    if (ids.length === 0) {
      throw new Error("No projects found — check cookie / login.");
    }

    const projects: Array<{
      nizekId: string;
      name: string;
      teamName?: string;
      enabled: boolean;
      taskCount: number;
      color: string;
    }> = [];
    const tasks: Array<ReturnType<typeof extractTasks>[number] & { nizekId: string }> =
      [];

    const known = await ctx.runQuery(api.projects.list, {});
    const enabledMap = new Map(known.map((p) => [p.nizekId, p.enabled]));

    for (const id of ids) {
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
        name: meta.name,
        teamName: meta.teamName ?? undefined,
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

    return { projects: projects.length, tasks: tasks.length };
  },
});

export const rotateTokenInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      await ctx.runAction(api.nizekActions.rotateToken, {});
    } catch (e) {
      console.warn("scheduled rotate failed", e);
    }
  },
});
