import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { parseGetMeetingNotesResponse } from "./lib/parse";

const PANEL = "https://panel.nizek.com";
/** Panel Next.js server action id for `getMeetingNotes` (from panel bundle). */
const GET_MEETING_NOTES_ACTION =
  "4042fbd4bd2e30120c92afc3cee78253daa06d125e";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

async function fetchMeetingNotes(cookieHeader: string, projectId: string) {
  const res = await fetch(
    `${PANEL}/dashboard/projects/${projectId}?tab=notes`,
    {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": GET_MEETING_NOTES_ACTION,
        Accept: "text/x-component",
        "User-Agent": "nizek-projects-plus/1.0",
      },
      body: JSON.stringify([projectId]),
    },
  );
  if (!res.ok) {
    throw new Error(`getMeetingNotes failed (${res.status}) for ${projectId}`);
  }
  const text = await res.text();
  return parseGetMeetingNotesResponse(text, projectId);
}

function serializeNote(
  n: ReturnType<typeof parseGetMeetingNotesResponse>[number],
) {
  return {
    nizekId: n.id,
    projectId: n.projectId,
    title: n.title,
    contentHtml: n.contentHtml,
    contentText: n.contentText,
    noteType: n.noteType,
    date: n.date,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    dueDate: n.dueDate,
    startedAt: n.startedAt,
    completedAt: n.completedAt,
    workingDays: n.workingDays,
    roadmapStatus: n.roadmapStatus,
    authorId: n.authorId,
    authorName: n.authorName,
    authorImageUrl: n.authorImageUrl,
    sprintId: n.sprintId,
    taskId: n.taskId,
    commentThreadCount: n.commentThreadCount,
    openCommentCount: n.openCommentCount,
    extrasJson: n.extrasJson,
  };
}

export const syncNotes = action({
  args: {
    /** Only sync these Panel project ids (enabled projects otherwise). */
    projectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<
    Result<{
      projects: number;
      notes: number;
      inserted: number;
      updated: number;
      pruned: number;
    }>
  > => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      const error =
        "Paste your panel.nizek.com Cookie header first (Admin → Auth bridge).";
      await ctx.runMutation(internal.notesSyncInternal.patchNoteSettings, {
        lastNoteError: error,
      });
      return { ok: false, error };
    }
    const cookie = settings.cookieHeader;

    try {
      // Sync all live projects (Board ignores projects.enabled; Notes should too).
      const allProjects = await ctx.runQuery(api.projects.list, {});
      let projects = allProjects;
      if (args.projectIds?.length) {
        const want = new Set(args.projectIds);
        projects = allProjects.filter((p) => want.has(p.nizekId));
      }
      if (!projects.length) {
        const error = "No projects to sync notes for — run project sync first.";
        await ctx.runMutation(internal.notesSyncInternal.patchNoteSettings, {
          lastNoteError: error,
        });
        return { ok: false, error };
      }

      const collected: ReturnType<typeof serializeNote>[] = [];
      const syncedProjectIds: string[] = [];
      const errors: string[] = [];

      for (const project of projects) {
        try {
          const notes = await fetchMeetingNotes(cookie, project.nizekId);
          syncedProjectIds.push(project.nizekId);
          for (const n of notes) {
            collected.push(serializeNote(n));
          }
        } catch (e) {
          errors.push(
            `${project.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      if (!syncedProjectIds.length) {
        const error = errors[0] ?? "Notes sync failed for all projects.";
        await ctx.runMutation(internal.notesSyncInternal.patchNoteSettings, {
          lastNoteError: error,
        });
        return { ok: false, error };
      }

      const r = await ctx.runMutation(internal.notesSyncInternal.upsertNotes, {
        notes: collected,
        pruneProjectIds: syncedProjectIds,
      });

      await ctx.runMutation(internal.notesSyncInternal.patchNoteSettings, {
        lastNoteSyncAt: Date.now(),
        lastNoteError: errors.length ? errors.slice(0, 3).join(" · ") : null,
      });

      return {
        ok: true,
        projects: syncedProjectIds.length,
        notes: collected.length,
        inserted: r.inserted,
        updated: r.updated,
        pruned: r.pruned,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.notesSyncInternal.patchNoteSettings, {
        lastNoteError: error,
      });
      return { ok: false, error };
    }
  },
});

export const syncNotesInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runAction(api.noteActions.syncNotes, {});
    if (!result.ok) {
      console.warn("scheduled note sync failed:", result.error);
    } else {
      console.log(
        `scheduled note sync ok: ${result.projects} projects · ${result.notes} notes · +${result.inserted} / ~${result.updated} / -${result.pruned}`,
      );
    }
  },
});
