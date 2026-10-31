import { v } from "convex/values";
import { query } from "./_generated/server";
import { isLive } from "./lib/softDelete";

export type ChatAttachmentView = {
  id?: string | null;
  name: string;
  url: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  isImage?: boolean | null;
};

export type ChatReactionView = {
  emoji: string;
  memberIds: string[];
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const listThreads = query({
  args: {
    search: v.optional(v.string()),
    kinds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const rows = (await ctx.db.query("chatThreads").take(500)).filter(isLive);
    const search = args.search?.trim().toLowerCase() ?? "";
    const kindSet = args.kinds?.length ? new Set(args.kinds) : null;
    const filtered = rows.filter((t) => {
      if (kindSet && !kindSet.has(t.kind)) return false;
      if (!search) return true;
      const hay =
        `${t.name} ${t.subtitle ?? ""} ${t.lastMessage ?? ""} ${t.lastAuthor ?? ""}`.toLowerCase();
      return hay.includes(search);
    });
    return filtered.sort((a, b) => {
      const at = a.lastAt ? Date.parse(a.lastAt) : 0;
      const bt = b.lastAt ? Date.parse(b.lastAt) : 0;
      return bt - at || b.syncedAt - a.syncedAt;
    });
  },
});

export const getThread = query({
  args: { threadKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chatThreads")
      .withIndex("by_threadKey", (q) => q.eq("threadKey", args.threadKey))
      .unique();
    if (!row || !isLive(row)) return null;
    return row;
  },
});

export const listMessages = query({
  args: {
    threadKey: v.string(),
    /** How many newest messages to return (scroll-up loads more). */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 40, 1), 500);
    // Fetch one extra to know if older local history exists.
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_thread_createdAt", (q) =>
        q.eq("threadKey", args.threadKey),
      )
      .order("desc")
      .take(limit + 1);

    const hasMoreLocal = rows.length > limit;
    const page = (hasMoreLocal ? rows.slice(0, limit) : rows)
      .filter(isLive)
      .reverse();
    const byId = new Map(page.map((m) => [m.nizekId, m]));

    // Resolve reply parents that fall outside the loaded window.
    const missingReplyIds = [
      ...new Set(
        page
          .map((m) => m.replyToId)
          .filter((id): id is string => !!id && !byId.has(id)),
      ),
    ].slice(0, 40);
    for (const id of missingReplyIds) {
      const parent = await ctx.db
        .query("chatMessages")
        .withIndex("by_nizekId", (q) => q.eq("nizekId", id))
        .unique();
      if (parent && isLive(parent)) byId.set(parent.nizekId, parent);
    }

    const messages = page.map((m) => {
      const replyParent = m.replyToId ? byId.get(m.replyToId) : null;
      const attachments = parseJson<ChatAttachmentView[]>(
        m.attachmentsJson,
        [],
      );
      const reactions = parseJson<ChatReactionView[]>(m.reactionsJson, []);
      return {
        ...m,
        attachments,
        reactions,
        reply: replyParent
          ? {
              id: replyParent.nizekId,
              authorName: replyParent.authorName,
              body: replyParent.body,
              attachments: parseJson<ChatAttachmentView[]>(
                replyParent.attachmentsJson,
                [],
              ),
            }
          : m.replyToId
            ? {
                id: m.replyToId,
                authorName: "Earlier message",
                body: "",
                attachments: [] as ChatAttachmentView[],
                missing: true as const,
              }
            : null,
      };
    });

    return {
      messages,
      hasMoreLocal,
      oldestId: messages[0]?.nizekId ?? null,
      newestId: messages[messages.length - 1]?.nizekId ?? null,
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
    const threads = (await ctx.db.query("chatThreads").take(500)).filter(
      isLive,
    );
    const unread = threads.reduce((n, t) => n + (t.unread || 0), 0);
    return {
      lastChatSyncAt: settings?.lastChatSyncAt ?? null,
      lastChatError: settings?.lastChatError ?? null,
      threadCount: threads.length,
      unread,
      hasCookie: Boolean(settings?.cookieHeader),
    };
  },
});
