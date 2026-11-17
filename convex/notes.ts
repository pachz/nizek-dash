import { v } from "convex/values";
import { query } from "./_generated/server";
import { isLive } from "./lib/softDelete";
import { ALL_NOTE_TYPES, NOTE_TYPE_LABELS } from "./lib/parse";

export const list = query({
  args: {
    projectId: v.optional(v.string()),
    noteType: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows;
    if (args.projectId) {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .take(2000);
    } else if (args.noteType) {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_noteType", (q) => q.eq("noteType", args.noteType!))
        .take(2000);
    } else {
      rows = await ctx.db.query("notes").take(3000);
    }

    const search = args.search?.trim().toLowerCase() ?? "";
    const live = rows.filter(isLive).filter((n) => {
      if (args.projectId && n.projectId !== args.projectId) return false;
      if (args.noteType && n.noteType !== args.noteType) return false;
      if (!search) return true;
      const hay =
        `${n.title} ${n.contentText} ${n.authorName ?? ""} ${n.noteType}`.toLowerCase();
      return hay.includes(search);
    });

    return live.sort((a, b) => {
      const at = Date.parse(a.createdAt) || 0;
      const bt = Date.parse(b.createdAt) || 0;
      return bt - at;
    });
  },
});

export const get = query({
  args: { nizekId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notes")
      .withIndex("by_nizekId", (q) => q.eq("nizekId", args.nizekId))
      .unique();
    if (!row || !isLive(row)) return null;
    return row;
  },
});

export const filterCounts = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows;
    if (args.projectId) {
      rows = await ctx.db
        .query("notes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .take(2000);
    } else {
      rows = await ctx.db.query("notes").take(3000);
    }
    const live = rows.filter(isLive);
    const byType: Record<string, number> = {};
    for (const n of live) {
      byType[n.noteType] = (byType[n.noteType] ?? 0) + 1;
    }
    const types: Array<{ id: string; label: string; count: number }> =
      ALL_NOTE_TYPES.filter((t) => (byType[t] ?? 0) > 0).map((t) => ({
        id: t,
        label: NOTE_TYPE_LABELS[t] ?? t,
        count: byType[t] ?? 0,
      }));
    // Include any unexpected types from Panel
    for (const [id, count] of Object.entries(byType)) {
      if (types.some((t) => t.id === id)) continue;
      types.push({
        id,
        label: NOTE_TYPE_LABELS[id] ?? id,
        count,
      });
    }
    return {
      total: live.length,
      types,
    };
  },
});

export const syncStatus = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const notes = (await ctx.db.query("notes").take(3000)).filter(isLive);
    return {
      lastNoteSyncAt: settings?.lastNoteSyncAt ?? null,
      lastNoteError: settings?.lastNoteError ?? null,
      noteCount: notes.length,
      hasCookie: Boolean(settings?.cookieHeader),
    };
  },
});
