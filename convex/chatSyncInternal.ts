import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { isLive } from "./lib/softDelete";

const threadValidator = v.object({
  threadKey: v.string(),
  kind: v.string(),
  name: v.string(),
  subtitle: v.optional(v.union(v.string(), v.null())),
  projectId: v.optional(v.union(v.string(), v.null())),
  conversationId: v.optional(v.union(v.string(), v.null())),
  logoUrl: v.optional(v.union(v.string(), v.null())),
  peerImageUrl: v.optional(v.union(v.string(), v.null())),
  lastMessage: v.optional(v.union(v.string(), v.null())),
  lastAuthor: v.optional(v.union(v.string(), v.null())),
  lastAt: v.optional(v.union(v.string(), v.null())),
  unread: v.number(),
  avatar: v.optional(v.union(v.string(), v.null())),
  initials: v.optional(v.union(v.string(), v.null())),
  inactive: v.optional(v.boolean()),
  readOnly: v.optional(v.boolean()),
});

const messageValidator = v.object({
  nizekId: v.string(),
  threadKey: v.string(),
  authorId: v.string(),
  authorName: v.string(),
  authorImageUrl: v.optional(v.union(v.string(), v.null())),
  body: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
  edited: v.boolean(),
  replyToId: v.optional(v.union(v.string(), v.null())),
  attachmentsJson: v.string(),
  reactionsJson: v.string(),
  kind: v.string(),
  important: v.boolean(),
  extrasJson: v.optional(v.string()),
});

export const upsertThreads = internalMutation({
  args: {
    threads: v.array(threadValidator),
    /** Soft-delete threads missing from payload when true. */
    pruneMissing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const seen = new Set<string>();
    let upserted = 0;
    for (const t of args.threads) {
      seen.add(t.threadKey);
      const existing = await ctx.db
        .query("chatThreads")
        .withIndex("by_threadKey", (q) => q.eq("threadKey", t.threadKey))
        .unique();
      const patch = {
        ...t,
        syncedAt: now,
        deletedAt: undefined,
      };
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("chatThreads", patch);
      }
      upserted++;
    }
    let pruned = 0;
    if (args.pruneMissing) {
      const all = await ctx.db.query("chatThreads").take(500);
      for (const row of all) {
        if (!isLive(row)) continue;
        if (seen.has(row.threadKey)) continue;
        await ctx.db.patch(row._id, { deletedAt: now });
        pruned++;
      }
    }
    return { upserted, pruned };
  },
});

export const upsertMessages = internalMutation({
  args: {
    messages: v.array(messageValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    for (const m of args.messages) {
      const existing = await ctx.db
        .query("chatMessages")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", m.nizekId))
        .unique();
      const patch = {
        ...m,
        syncedAt: now,
        deletedAt: undefined,
      };
      if (existing) {
        await ctx.db.patch(existing._id, patch);
        updated++;
      } else {
        await ctx.db.insert("chatMessages", patch);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

export const patchChatSettings = internalMutation({
  args: {
    lastChatSyncAt: v.optional(v.number()),
    lastChatError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch: Record<string, unknown> = {};
    if (args.lastChatSyncAt !== undefined) {
      patch.lastChatSyncAt = args.lastChatSyncAt;
    }
    if (args.lastChatError !== undefined) {
      patch.lastChatError =
        args.lastChatError === null ? undefined : args.lastChatError;
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
