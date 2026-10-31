import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppHeader } from "./components/AppHeader";
import { formatWhen } from "./lib/stages";

type Attachment = {
  id?: string | null;
  name: string;
  url: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  isImage?: boolean | null;
};

const KIND_LABEL: Record<string, string> = {
  announcements: "Announcements",
  client: "Client",
  project: "Project",
  direct: "Direct",
};

function isVideo(a: Attachment) {
  const ct = a.contentType ?? "";
  return ct.startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(a.url);
}

function isAudio(a: Attachment) {
  const ct = a.contentType ?? "";
  return ct.startsWith("audio/") || /\.(webm|m4a|mp3|ogg|wav)(\?|$)/i.test(a.url);
}

function isImageAtt(a: Attachment) {
  if (a.isImage) return true;
  const ct = a.contentType ?? "";
  return ct.startsWith("image/") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.url);
}

function formatBytes(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortWhen(iso?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function Avatar({
  name,
  imageUrl,
  color,
  initials,
}: {
  name: string;
  imageUrl?: string | null;
  color?: string | null;
  initials?: string | null;
}) {
  if (imageUrl) {
    return <img className="chat-avatar" src={imageUrl} alt="" />;
  }
  return (
    <span
      className="chat-avatar fallback"
      style={color ? { background: color } : undefined}
    >
      {(initials || name).slice(0, 1).toUpperCase()}
    </span>
  );
}

function AttachmentBlock({
  attachments,
  onOpen,
}: {
  attachments: Attachment[];
  onOpen: (a: Attachment) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="chat-attach-list">
      {attachments.map((a) => {
        const key = a.id ?? a.url;
        if (isImageAtt(a)) {
          return (
            <button
              key={key}
              type="button"
              className="chat-attach-media"
              onClick={() => onOpen(a)}
            >
              <img src={a.url} alt={a.name} loading="lazy" />
            </button>
          );
        }
        if (isVideo(a)) {
          return (
            <button
              key={key}
              type="button"
              className="chat-attach-media video"
              onClick={() => onOpen(a)}
            >
              <video src={a.url} muted playsInline preload="metadata" />
              <span className="chat-play">Play</span>
              <span className="chat-attach-cap">
                {a.name}
                {formatBytes(a.sizeBytes) ? ` · ${formatBytes(a.sizeBytes)}` : ""}
              </span>
            </button>
          );
        }
        if (isAudio(a)) {
          return (
            <div key={key} className="chat-attach-audio">
              <span className="chat-attach-cap">{a.name}</span>
              <audio controls preload="metadata" src={a.url} />
            </div>
          );
        }
        return (
          <a
            key={key}
            className="chat-attach-file"
            href={a.url}
            target="_blank"
            rel="noreferrer"
          >
            <span>{a.name}</span>
            {formatBytes(a.sizeBytes) ? (
              <em>{formatBytes(a.sizeBytes)}</em>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

const PAGE_SIZE = 40;
const NEAR_BOTTOM_PX = 80;
const LOAD_TOP_PX = 72;

export default function Chats() {
  const syncStatus = useQuery(api.chats.syncStatus);
  const syncChats = useAction(api.chatActions.syncChats);
  const loadOlder = useAction(api.chatActions.loadOlderMessages);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messageLimit, setMessageLimit] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [panelHasMore, setPanelHasMore] = useState(true);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const didAutoSync = useRef(false);
  const stickToBottom = useRef(true);
  const pendingPrepend = useRef(false);
  const prevScrollHeight = useRef(0);
  const lastNewestId = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  const threads = useQuery(api.chats.listThreads, {
    search: deferredSearch || undefined,
    kinds: kindFilter.length ? kindFilter : undefined,
  });

  const messagePage = useQuery(
    api.chats.listMessages,
    selectedKey ? { threadKey: selectedKey, limit: messageLimit } : "skip",
  );
  const messages = messagePage?.messages;

  const selected = useMemo(
    () => threads?.find((t) => t.threadKey === selectedKey) ?? null,
    [threads, selectedKey],
  );

  const kinds = useMemo(() => {
    const set = new Set((threads ?? []).map((t) => t.kind));
    return [...set].sort();
  }, [threads]);

  const canLoadOlder =
    Boolean(selectedKey) &&
    Boolean(messagePage?.oldestId) &&
    (messagePage?.hasMoreLocal || panelHasMore) &&
    !loadingOlder;

  const runSync = useEffectEvent(
    async (opts?: { threadKeys?: string[]; pagesPerThread?: number }) => {
      setSyncing(true);
      setStatusNote(null);
      try {
        const r = await syncChats({
          threadKeys: opts?.threadKeys,
          pagesPerThread: opts?.pagesPerThread ?? 2,
        });
        if (!r.ok) {
          setStatusNote(r.error);
          return;
        }
        setStatusNote(
          `Synced ${r.threads} chats · ${r.messages} msgs (+${r.inserted} / ~${r.updated})`,
        );
      } catch (e) {
        setStatusNote(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    },
  );

  const loadOlderMessages = useEffectEvent(async () => {
    if (!selectedKey || !messagePage?.oldestId) return;
    if (loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const scroller = scrollerRef.current;
    if (scroller) {
      prevScrollHeight.current = scroller.scrollHeight;
      pendingPrepend.current = true;
    }

    const finishWithoutPrepend = () => {
      pendingPrepend.current = false;
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    };

    try {
      if (messagePage.hasMoreLocal) {
        // Keep loading state until the next render prepends & restores scroll.
        setMessageLimit((n) => n + PAGE_SIZE);
        return;
      }
      if (!panelHasMore) {
        finishWithoutPrepend();
        return;
      }
      const r = await loadOlder({
        threadKey: selectedKey,
        cursorId: messagePage.oldestId,
      });
      if (!r.ok) {
        setStatusNote(r.error);
        finishWithoutPrepend();
        return;
      }
      setPanelHasMore(r.hasMore);
      if (r.count > 0) {
        setMessageLimit((n) => n + Math.max(r.count, PAGE_SIZE));
        return;
      }
      finishWithoutPrepend();
    } catch (e) {
      finishWithoutPrepend();
      setStatusNote(e instanceof Error ? e.message : String(e));
    }
  });

  // First visit: pull chats if we have a cookie and nothing cached yet
  useEffect(() => {
    if (didAutoSync.current) return;
    if (!syncStatus) return;
    didAutoSync.current = true;
    if (!syncStatus.hasCookie) return;
    if (syncStatus.threadCount > 0 && syncStatus.lastChatSyncAt) return;
    void runSync({ pagesPerThread: 2 });
  }, [syncStatus]);

  // Keep selection valid
  useEffect(() => {
    if (!threads?.length) return;
    if (selectedKey && threads.some((t) => t.threadKey === selectedKey)) return;
    setSelectedKey(threads[0]!.threadKey);
  }, [threads, selectedKey]);

  // Reset pagination when switching threads
  useEffect(() => {
    setMessageLimit(PAGE_SIZE);
    setPanelHasMore(true);
    stickToBottom.current = true;
    pendingPrepend.current = false;
    lastNewestId.current = null;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [selectedKey]);

  // Preserve scroll after prepending older messages; otherwise stick to bottom
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !messagePage) return;

    if (pendingPrepend.current) {
      const delta = scroller.scrollHeight - prevScrollHeight.current;
      scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
      pendingPrepend.current = false;
      loadingOlderRef.current = false;
      setLoadingOlder(false);
      lastNewestId.current = messagePage.newestId;
      return;
    }

    lastNewestId.current = messagePage.newestId;

    if (stickToBottom.current) {
      // Instant jump — latest messages stay in view on open / live updates
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [selectedKey, messagePage?.messages.length, messagePage?.newestId]);

  function onMessagesScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stickToBottom.current = distanceFromBottom < NEAR_BOTTOM_PX;

    if (
      scroller.scrollTop < LOAD_TOP_PX &&
      canLoadOlder &&
      !loadingOlderRef.current
    ) {
      void loadOlderMessages();
    }
  }

  function selectThread(threadKey: string) {
    setSelectedKey(threadKey);
    void runSync({
      threadKeys: [threadKey],
      pagesPerThread: 1,
    });
  }

  function toggleKind(kind: string) {
    setKindFilter((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  return (
    <div className="app chats-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader
        tools={
          <>
            <label className="search">
              <span className="sr-only">Search chats</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
              />
            </label>
            <button
              type="button"
              className="ghost"
              disabled={syncing || !syncStatus?.hasCookie}
              onClick={() => void runSync({ pagesPerThread: 2 })}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </>
        }
      />

      <div className="status-row">
        <span className="pill">{syncStatus?.threadCount ?? 0} chats</span>
        {(syncStatus?.unread ?? 0) > 0 ? (
          <span className="pill soft">{syncStatus?.unread} unread</span>
        ) : null}
        <span className="pill soft">
          {syncStatus?.lastChatSyncAt
            ? `Last sync ${formatWhen(new Date(syncStatus.lastChatSyncAt).toISOString())}`
            : "Not synced yet"}
        </span>
        <span className="pill soft">Auto every 2 min</span>
        {syncStatus?.lastChatError ? (
          <span className="pill danger">{syncStatus.lastChatError}</span>
        ) : null}
        {statusNote ? <span className="pill soft">{statusNote}</span> : null}
        {!syncStatus?.hasCookie ? (
          <span className="pill danger">
            Paste a Panel cookie in <a href="/admin">Admin</a> to sync chats.
          </span>
        ) : null}
      </div>

      {kinds.length ? (
        <div className="chips chats-kind-chips">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              data-on={kindFilter.includes(k)}
              onClick={() => toggleKind(k)}
            >
              {KIND_LABEL[k] ?? k}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chats-layout glass">
        <aside className="chats-sidebar">
          {threads === undefined ? (
            <p className="hint">Loading chats…</p>
          ) : threads.length === 0 ? (
            <p className="hint">
              No chats yet
              {syncStatus?.hasCookie
                ? " — hit Sync now to pull from Panel."
                : "."}
            </p>
          ) : (
            <ul className="chat-thread-list">
              {threads.map((t) => (
                <li key={t.threadKey}>
                  <button
                    type="button"
                    className="chat-thread-item"
                    data-active={t.threadKey === selectedKey}
                    onClick={() => selectThread(t.threadKey)}
                  >
                    <Avatar
                      name={t.name}
                      imageUrl={t.logoUrl ?? t.peerImageUrl}
                      color={t.avatar}
                      initials={t.initials}
                    />
                    <span className="chat-thread-copy">
                      <span className="chat-thread-top">
                        <strong>{t.name}</strong>
                        <time>{formatShortWhen(t.lastAt)}</time>
                      </span>
                      <span className="chat-thread-sub">
                        {KIND_LABEL[t.kind] ?? t.kind}
                        {t.subtitle ? ` · ${t.subtitle}` : ""}
                      </span>
                      <span className="chat-thread-preview">
                        {t.lastAuthor ? `${t.lastAuthor}: ` : ""}
                        {t.lastMessage || "—"}
                      </span>
                    </span>
                    {t.unread > 0 ? (
                      <span className="chat-unread">{t.unread}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="chats-pane">
          {selected ? (
            <>
              <header className="chats-pane-head">
                <Avatar
                  name={selected.name}
                  imageUrl={selected.logoUrl ?? selected.peerImageUrl}
                  color={selected.avatar}
                  initials={selected.initials}
                />
                <div>
                  <h2>{selected.name}</h2>
                  <p>
                    {KIND_LABEL[selected.kind] ?? selected.kind}
                    {selected.subtitle ? ` · ${selected.subtitle}` : ""}
                    {selected.readOnly &&
                    !/view only/i.test(selected.subtitle ?? "")
                      ? " · View only"
                      : ""}
                  </p>
                </div>
                <a
                  className="ghost tiny"
                  href={
                    selected.kind === "project" && selected.projectId
                      ? `https://panel.nizek.com/dashboard/messages/project-${selected.projectId}`
                      : selected.conversationId
                        ? `https://panel.nizek.com/dashboard/messages/${selected.conversationId}`
                        : "https://panel.nizek.com/dashboard/messages"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Panel
                </a>
              </header>

              <div
                className="chats-messages"
                ref={scrollerRef}
                onScroll={onMessagesScroll}
              >
                {messages === undefined ? (
                  <p className="hint">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="hint">
                    No messages cached for this chat yet — syncing pulls the
                    latest pages from Panel.
                  </p>
                ) : (
                  <>
                    <div className="chats-load-older">
                      {loadingOlder ? (
                        <span className="hint">Loading earlier messages…</span>
                      ) : canLoadOlder ? (
                        <button
                          type="button"
                          className="tiny ghost"
                          onClick={() => void loadOlderMessages()}
                        >
                          Load earlier messages
                        </button>
                      ) : (
                        <span className="hint">Beginning of conversation</span>
                      )}
                    </div>
                    {messages.map((m) => (
                      <article
                        key={m.nizekId}
                        id={`msg-${m.nizekId}`}
                        className="chat-bubble"
                        data-kind={m.kind}
                        data-important={m.important}
                      >
                        <Avatar
                          name={m.authorName}
                          imageUrl={m.authorImageUrl}
                        />
                        <div className="chat-bubble-body">
                          <div className="chat-bubble-meta">
                            <strong>{m.authorName}</strong>
                            <time title={formatWhen(m.createdAt) ?? undefined}>
                              {formatShortWhen(m.createdAt)}
                            </time>
                            {m.edited ? (
                              <span className="chat-edited">edited</span>
                            ) : null}
                            {m.kind !== "message" ? (
                              <span className="pill soft">
                                {m.kind.replaceAll("_", " ")}
                              </span>
                            ) : null}
                          </div>

                          {m.reply ? (
                            <button
                              type="button"
                              className="chat-reply-quote"
                              onClick={() => {
                                const el = document.getElementById(
                                  `msg-${m.reply!.id}`,
                                );
                                el?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                              }}
                            >
                              <strong>{m.reply.authorName}</strong>
                              <span>
                                {m.reply.body?.trim() ||
                                  (m.reply.attachments?.length
                                    ? `${m.reply.attachments.length} attachment(s)`
                                    : "Original message")}
                              </span>
                            </button>
                          ) : null}

                          {m.body?.trim() ? (
                            <p className="chat-text">{m.body}</p>
                          ) : null}

                          <AttachmentBlock
                            attachments={m.attachments}
                            onOpen={setLightbox}
                          />

                          {m.reactions.length ? (
                            <div className="chat-reactions">
                              {m.reactions.map((r) => (
                                <span key={r.emoji}>
                                  {r.emoji} {r.memberIds.length}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </>
                )}
                <div ref={bottomRef} />
              </div>
            </>
          ) : (
            <div className="chats-empty">
              <p>Select a conversation to read messages.</p>
            </div>
          )}
        </section>
      </div>

      {lightbox ? (
        <div
          className="chat-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setLightbox(null);
          }}
        >
          <button
            type="button"
            className="chat-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            Close
          </button>
          {isVideo(lightbox) ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox.url}
              alt={lightbox.name}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <a
            href={lightbox.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.name}
          </a>
        </div>
      ) : null}
    </div>
  );
}
