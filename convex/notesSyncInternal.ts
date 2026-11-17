import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { isLive } from "./lib/softDelete";

const noteValidator = v.object({
  nizekId: v.string(),
  projectId: v.string(),
  title: v.string(),
  contentHtml: v.string(),
  contentText: v.string(),
  noteType: v.string(),
  date: v.optional(v.union(v.string(), v.null())),
  createdAt: v.string(),
  updatedAt: v.string(),
  dueDate: v.optional(v.union(v.string(), v.null())),
  startedAt: v.optional(v.union(v.string(), v.null())),
  completedAt: v.optional(v.union(v.string(), v.null())),
  workingDays: v.optional(v.union(v.number(), v.null())),
  roadmapStatus: v.optional(v.union(v.string(), v.null())),
  authorId: v.optional(v.union(v.string(), v.null())),
  authorName: v.optional(v.union(v.string(), v.null())),
  authorImageUrl: v.optional(v.union(v.string(), v.null())),
  sprintId: v.optional(v.union(v.string(), v.null())),
  taskId: v.optional(v.union(v.string(), v.null())),
  commentThreadCount: v.number(),
  openCommentCount: v.number(),
  extrasJson: v.optional(v.string()),
});

export const upsertNotes = internalMutation({
  args: {
    notes: v.array(noteValidator),
    /** Soft-delete live notes for these projects that were missing from the payload. */
    pruneProjectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const seen = new Set<string>();
    let inserted = 0;
    let updated = 0;

    for (const n of args.notes) {
      seen.add(n.nizekId);
      const existing = await ctx.db
        .query("notes")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", n.nizekId))
        .unique();
      const patch = {
        ...n,
        syncedAt: now,
        deletedAt: undefined,
      };
      if (existing) {
        await ctx.db.patch(existing._id, patch);
        updated++;
      } else {
        await ctx.db.insert("notes", patch);
        inserted++;
      }
    }

    let pruned = 0;
    const pruneIds = args.pruneProjectIds?.length
      ? new Set(args.pruneProjectIds)
      : null;
    if (pruneIds) {
      for (const projectId of pruneIds) {
        const rows = await ctx.db
          .query("notes")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .take(2000);
        for (const row of rows) {
          if (!isLive(row)) continue;
          if (seen.has(row.nizekId)) continue;
          await ctx.db.patch(row._id, { deletedAt: now });
          pruned++;
        }
      }
    }

    return { inserted, updated, pruned };
  },
});

export const patchNoteSettings = internalMutation({
  args: {
    lastNoteSyncAt: v.optional(v.number()),
    lastNoteError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch: Record<string, unknown> = {};
    if (args.lastNoteSyncAt !== undefined) {
      patch.lastNoteSyncAt = args.lastNoteSyncAt;
    }
    if (args.lastNoteError !== undefined) {
      patch.lastNoteError =
        args.lastNoteError === null ? undefined : args.lastNoteError;
    }
    if (!existing) {
      return await ctx.db.insert("settings", {
        key: "main",
        deviceId: crypto.randomUUID(),
        ...patch,
      });
    }
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  },
});
