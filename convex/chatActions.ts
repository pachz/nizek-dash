import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  chatThreadFetchArgs,
  chatThreadKey,
  extractChatThreads,
  parseGetThreadMessagesResponse,
  type ChatMessage,
  type ChatThread,
} from "./lib/parse";

const PANEL = "https://panel.nizek.com";
/** Panel Next.js server action id for `getThreadMessages` (from panel bundle). */
const GET_THREAD_MESSAGES_ACTION =
  "40ac612b4ae59caf79e36fc64f86c647407550e3b7";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

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

async function fetchThreadMessages(
  cookieHeader: string,
  args: { projectId: string } | { conversationId: string },
  cursorId?: string,
) {
  const body = JSON.stringify([
    cursorId ? { ...args, cursorId } : args,
  ]);
  const res = await fetch(`${PANEL}/dashboard/messages`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": GET_THREAD_MESSAGES_ACTION,
      Accept: "text/x-component",
      "User-Agent": "nizek-projects-plus/1.0",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`getThreadMessages failed (${res.status})`);
  }
  const text = await res.text();
  return parseGetThreadMessagesResponse(text);
}

function serializeMessage(threadKey: string, m: ChatMessage) {
  return {
    nizekId: m.id,
    threadKey,
    authorId: m.authorId,
    authorName: m.authorName,
    authorImageUrl: m.authorImageUrl ?? null,
    body: m.body,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    edited: m.edited,
    replyToId: m.replyToId ?? null,
    attachmentsJson: JSON.stringify(m.attachments ?? []),
    reactionsJson: JSON.stringify(m.reactions ?? []),
    kind: m.kind,
    important: m.important,
    extrasJson: JSON.stringify({
      task: m.task ?? null,
      mentions: m.mentions ?? [],
      deadlineReminder: m.deadlineReminder ?? null,
      noteComment: m.noteComment ?? null,
      taskComment: m.taskComment ?? null,
      noteActivity: m.noteActivity ?? null,
      clientIssue: m.clientIssue ?? null,
      proofBypass: m.proofBypass ?? null,
    }),
  };
}

function serializeThread(t: ChatThread) {
  return {
    threadKey: chatThreadKey(t),
    kind: t.kind,
    name: t.name,
    subtitle: t.subtitle ?? null,
    projectId: t.projectId ?? null,
    conversationId: t.conversationId ?? null,
    logoUrl: t.logoUrl ?? null,
    peerImageUrl: t.peerImageUrl ?? null,
    lastMessage: t.lastMessage ?? null,
    lastAuthor: t.lastAuthor ?? null,
    lastAt: t.lastAt ?? null,
    unread: t.unread ?? 0,
    avatar: t.avatar ?? null,
    initials: t.initials ?? null,
    inactive: t.inactive ?? false,
    readOnly: t.readOnly ?? false,
  };
}

/**
 * Build the full set of threads: inbox list + synthetic project chats
 * for every enabled synced project (project chats aren't always in the inbox).
 */
function mergeWithProjects(
  listed: ChatThread[],
  projects: Array<{ nizekId: string; name: string; color: string }>,
): ChatThread[] {
  const byKey = new Map<string, ChatThread>();
  for (const t of listed) {
    byKey.set(chatThreadKey(t), t);
  }
  for (const p of projects) {
    const key = `project-${p.nizekId}`;
    if (byKey.has(key)) continue;
    // Prefer existing client thread's last activity if same project
    const client = listed.find(
      (t) => t.kind === "client" && t.projectId === p.nizekId,
    );
    byKey.set(key, {
      id: key,
      kind: "project",
      name: p.name,
      subtitle: "Project chat",
      projectId: p.nizekId,
      conversationId: null,
      logoUrl: null,
      peerImageUrl: null,
      lastMessage: client?.lastMessage ?? null,
      lastAuthor: client?.lastAuthor ?? null,
      lastAt: client?.lastAt ?? null,
      unread: 0,
      avatar: p.color,
      initials: p.name.slice(0, 1).toUpperCase(),
      inactive: false,
      readOnly: false,
    });
  }
  return [...byKey.values()];
}

export const syncChats = action({
  args: {
    /** Max older pages to pull per thread (25 msgs/page). Default 1 = latest only. */
    pagesPerThread: v.optional(v.number()),
    /** Only sync these thread keys (manual refresh of one chat). */
    threadKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<
    Result<{
      threads: number;
      messages: number;
      inserted: number;
      updated: number;
    }>
  > => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      const error =
        "Paste your panel.nizek.com Cookie header first (Admin → Auth bridge).";
      await ctx.runMutation(internal.chatSyncInternal.patchChatSettings, {
        lastChatError: error,
      });
      return { ok: false, error };
    }
    const cookie = settings.cookieHeader;

    try {
      const listRes = await panelFetch("/dashboard/messages", cookie);
      if (!listRes.ok) {
        const error = `Messages list failed (${listRes.status}) — cookie may be expired.`;
        await ctx.runMutation(internal.chatSyncInternal.patchChatSettings, {
          lastChatError: error,
        });
        return { ok: false, error };
      }
      const listHtml = await listRes.text();
      const listed = extractChatThreads(listHtml);

      const projects = (await ctx.runQuery(api.projects.list, {})).filter(
        (p) => p.enabled !== false,
      );
      let threads = mergeWithProjects(
        listed,
        projects.map((p) => ({
          nizekId: p.nizekId,
          name: p.name,
          color: p.color,
        })),
      );

      if (args.threadKeys?.length) {
        const want = new Set(args.threadKeys);
        threads = threads.filter((t) => want.has(chatThreadKey(t)));
      }

      await ctx.runMutation(internal.chatSyncInternal.upsertThreads, {
        threads: threads.map(serializeThread),
        pruneMissing: !args.threadKeys?.length,
      });

      const pagesPerThread = Math.min(
        Math.max(args.pagesPerThread ?? 1, 1),
        8,
      );
      let messageCount = 0;
      let inserted = 0;
      let updated = 0;

      for (const thread of threads) {
        const fetchArgs = chatThreadFetchArgs(thread);
        if (!fetchArgs) continue;
        const threadKey = chatThreadKey(thread);
        let cursorId: string | undefined;
        let hasMore = true;
        for (let page = 0; page < pagesPerThread && hasMore; page++) {
          const pageData = await fetchThreadMessages(
            cookie,
            fetchArgs,
            cursorId,
          );
          if (!pageData.messages.length) break;
          const batch = pageData.messages.map((m) =>
            serializeMessage(threadKey, m),
          );
          const r = await ctx.runMutation(
            internal.chatSyncInternal.upsertMessages,
            { messages: batch },
          );
          inserted += r.inserted;
          updated += r.updated;
          messageCount += batch.length;
          cursorId = pageData.messages[0]?.id;
          hasMore = pageData.hasMore;
        }
      }

      await ctx.runMutation(internal.chatSyncInternal.patchChatSettings, {
        lastChatSyncAt: Date.now(),
        lastChatError: null,
      });

      return {
        ok: true,
        threads: threads.length,
        messages: messageCount,
        inserted,
        updated,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.chatSyncInternal.patchChatSettings, {
        lastChatError: error,
      });
      return { ok: false, error };
    }
  },
});

/** Fetch one older page for a thread (scroll-up pagination). */
export const loadOlderMessages = action({
  args: {
    threadKey: v.string(),
    /** Oldest currently-visible message id — Panel cursor. */
    cursorId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<{ inserted: number; updated: number; hasMore: boolean; count: number }>
  > => {
    const settings = await ctx.runQuery(api.settings.get, {});
    if (!settings?.cookieHeader) {
      return {
        ok: false,
        error:
          "Paste your panel.nizek.com Cookie header first (Admin → Auth bridge).",
      };
    }
    const thread = await ctx.runQuery(api.chats.getThread, {
      threadKey: args.threadKey,
    });
    if (!thread) {
      return { ok: false, error: "Thread not found — sync chats first." };
    }
    const fetchArgs = chatThreadFetchArgs(thread);
    if (!fetchArgs) {
      return { ok: false, error: "Thread has no conversation/project target." };
    }
    try {
      const page = await fetchThreadMessages(
        settings.cookieHeader,
        fetchArgs,
        args.cursorId,
      );
      if (!page.messages.length) {
        return { ok: true, inserted: 0, updated: 0, hasMore: false, count: 0 };
      }
      const batch = page.messages.map((m) =>
        serializeMessage(args.threadKey, m),
      );
      const r = await ctx.runMutation(internal.chatSyncInternal.upsertMessages, {
        messages: batch,
      });
      return {
        ok: true,
        inserted: r.inserted,
        updated: r.updated,
        hasMore: page.hasMore,
        count: batch.length,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

export const syncChatsInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runAction(api.chatActions.syncChats, {
      pagesPerThread: 1,
    });
    if (!result.ok) {
      console.warn("scheduled chat sync failed:", result.error);
    } else {
      console.log(
        `scheduled chat sync ok: ${result.threads} threads · ${result.messages} msgs · +${result.inserted} / ~${result.updated}`,
      );
    }
  },
});
