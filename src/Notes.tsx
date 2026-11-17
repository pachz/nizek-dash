import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppHeader } from "./components/AppHeader";
import { formatWhen } from "./lib/stages";

const NOTE_TYPE_META: Record<string, { label: string; tone: string }> = {
  MEETING_NOTE: { label: "Meeting Note", tone: "note-type-meeting" },
  DECISION: { label: "Decision", tone: "note-type-decision" },
  CLARIFICATION: { label: "Clarification", tone: "note-type-clarify" },
  DEADLINE: { label: "Roadmap", tone: "note-type-roadmap" },
  SPRINT_DOC: { label: "Sprint Document", tone: "note-type-sprint" },
  SPRINT_PLANNING: { label: "Sprint Planning", tone: "note-type-sprint" },
  SPRINT_REVIEW: { label: "Sprint Review", tone: "note-type-decision" },
};

function noteLabel(type: string) {
  return NOTE_TYPE_META[type]?.label ?? type.replaceAll("_", " ");
}

function noteTone(type: string) {
  return NOTE_TYPE_META[type]?.tone ?? "note-type-meeting";
}

function formatCreated(iso?: string | null) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function panelNoteUrl(projectId: string, noteId: string) {
  return `https://panel.nizek.com/dashboard/projects/${projectId}?tab=notes&noteId=${noteId}`;
}

function subscribePath(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getPath() {
  return window.location.pathname;
}

function noteIdFromPath(path: string): string | null {
  const m = path.match(/^\/notes\/([^/]+)\/?$/);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function navigateNotes(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Avatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name?: string | null;
  imageUrl?: string | null;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "note-avatar md" : "note-avatar";
  if (imageUrl) {
    return <img className={cls} src={imageUrl} alt="" />;
  }
  const initial = (name ?? "?").slice(0, 1).toUpperCase();
  return <span className={`${cls} fallback`}>{initial}</span>;
}

export default function Notes() {
  const path = useSyncExternalStore(subscribePath, getPath, () => "/notes");
  const selectedId = noteIdFromPath(path);

  const projects = useQuery(api.projects.list);
  const syncStatus = useQuery(api.notes.syncStatus);
  const syncNotes = useAction(api.noteActions.syncNotes);
  const selectedNote = useQuery(
    api.notes.get,
    selectedId ? { nizekId: selectedId } : "skip",
  );

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [projectId, setProjectId] = useState<string>("");
  const [noteType, setNoteType] = useState<string>("ALL");
  const [syncing, setSyncing] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const didAutoSync = useRef(false);

  const projectOptions = useMemo(
    () =>
      (projects ?? [])
        .filter((p) => p.enabled !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const projectMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const p of projects ?? []) {
      m.set(p.nizekId, { name: p.name, color: p.color });
    }
    return m;
  }, [projects]);

  const counts = useQuery(
    api.notes.filterCounts,
    selectedId ? "skip" : { projectId: projectId || undefined },
  );

  const notes = useQuery(
    api.notes.list,
    selectedId
      ? "skip"
      : {
          projectId: projectId || undefined,
          noteType: noteType === "ALL" ? undefined : noteType,
          search: deferredSearch || undefined,
        },
  );

  const runSync = useEffectEvent(
    async (opts?: { projectIds?: string[] }) => {
      setSyncing(true);
      setStatusNote(null);
      try {
        const r = await syncNotes({
          projectIds: opts?.projectIds,
        });
        if (!r.ok) {
          setStatusNote(r.error);
          return;
        }
        setStatusNote(
          `Synced ${r.projects} projects · ${r.notes} notes (+${r.inserted} / ~${r.updated})`,
        );
      } catch (e) {
        setStatusNote(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    },
  );

  useEffect(() => {
    if (didAutoSync.current) return;
    if (!syncStatus) return;
    if (!syncStatus.hasCookie) return;
    if (syncStatus.noteCount > 0) return;
    didAutoSync.current = true;
    void runSync();
  }, [syncStatus, runSync]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedId) navigateNotes("/notes");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) window.scrollTo(0, 0);
  }, [selectedId]);

  const project =
    selectedNote && projectMap.get(selectedNote.projectId);

  if (selectedId) {
    return (
      <div className="app notes-app notes-reader-app">
        <div className="atmosphere" aria-hidden>
          <div className="orb orb-a" />
          <div className="orb orb-b" />
        </div>

        <AppHeader
          subtitle="Note"
          tools={
            <>
              <button
                type="button"
                className="ghost"
                onClick={() => navigateNotes("/notes")}
              >
                ← All notes
              </button>
              {selectedNote ? (
                <a
                  className="primary"
                  href={panelNoteUrl(
                    selectedNote.projectId,
                    selectedNote.nizekId,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Panel
                </a>
              ) : null}
            </>
          }
        />

        <main className="note-reader">
          {selectedNote === undefined ? (
            <p className="notes-empty">Loading note…</p>
          ) : selectedNote === null ? (
            <div className="note-reader-missing">
              <p className="notes-empty">Note not found locally.</p>
              <button
                type="button"
                className="primary"
                onClick={() => navigateNotes("/notes")}
              >
                Back to notes
              </button>
            </div>
          ) : (
            <article className="note-reader-article glass">
              <header className="note-reader-head">
                <div className="note-reader-badges">
                  <span
                    className={`note-type-badge ${noteTone(selectedNote.noteType)}`}
                  >
                    {noteLabel(selectedNote.noteType)}
                  </span>
                  {project ? (
                    <span
                      className="note-project-chip"
                      style={{
                        ["--note-project" as string]: project.color,
                      }}
                    >
                      {project.name}
                    </span>
                  ) : null}
                  {selectedNote.roadmapStatus ? (
                    <span className="pill soft">
                      {selectedNote.roadmapStatus}
                    </span>
                  ) : null}
                </div>
                <h1>{selectedNote.title || "Untitled"}</h1>
                <div className="note-reader-meta">
                  {selectedNote.authorName ? (
                    <span className="note-meta-author">
                      <Avatar
                        name={selectedNote.authorName}
                        imageUrl={selectedNote.authorImageUrl}
                        size="md"
                      />
                      {selectedNote.authorName}
                    </span>
                  ) : null}
                  <span>
                    Created {formatWhen(selectedNote.createdAt) ?? "—"}
                  </span>
                  {selectedNote.dueDate ? (
                    <span>Due {formatCreated(selectedNote.dueDate)}</span>
                  ) : null}
                  {selectedNote.commentThreadCount > 0 ? (
                    <span className="note-ack">
                      ✓ {selectedNote.commentThreadCount} thread
                      {selectedNote.commentThreadCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </header>

              {selectedNote.contentHtml ? (
                <div
                  className="note-reader-body note-html"
                  dangerouslySetInnerHTML={{
                    __html: selectedNote.contentHtml,
                  }}
                />
              ) : (
                <p className="notes-empty">No content.</p>
              )}
            </article>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app notes-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader
        tools={
          <>
            <label className="search">
              <span className="sr-only">Search notes</span>
              <input
                type="search"
                placeholder="Search notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="toolbar-select">
              <span className="sr-only">Filter by project</span>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setNoteType("ALL");
                }}
              >
                <option value="">All projects</option>
                {projectOptions.map((p) => (
                  <option key={p.nizekId} value={p.nizekId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              disabled={syncing || !syncStatus?.hasCookie}
              onClick={() =>
                void runSync(
                  projectId ? { projectIds: [projectId] } : undefined,
                )
              }
            >
              {syncing ? "Syncing…" : "Sync notes"}
            </button>
          </>
        }
      />

      <div className="status-row">
        <span className="pill">{counts?.total ?? notes?.length ?? 0} notes</span>
        {syncStatus?.lastNoteSyncAt ? (
          <span className="pill soft">
            Synced{" "}
            {new Date(syncStatus.lastNoteSyncAt).toLocaleTimeString()}
          </span>
        ) : null}
        {syncStatus?.lastNoteError ? (
          <span className="pill danger">{syncStatus.lastNoteError}</span>
        ) : null}
        {statusNote ? <span className="pill soft">{statusNote}</span> : null}
        {!syncStatus?.hasCookie ? (
          <span className="pill danger">
            Paste Panel cookie in Admin to sync
          </span>
        ) : null}
      </div>

      <div className="notes-filters" role="tablist" aria-label="Note types">
        <button
          type="button"
          className="notes-filter-pill"
          data-active={noteType === "ALL"}
          onClick={() => setNoteType("ALL")}
        >
          All {counts?.total ?? 0}
        </button>
        {(counts?.types ?? []).map((t) => (
          <button
            key={t.id}
            type="button"
            className="notes-filter-pill"
            data-active={noteType === t.id}
            onClick={() => setNoteType(t.id)}
          >
            {t.label} {t.count}
          </button>
        ))}
      </div>

      <main className="notes-main">
        {notes === undefined ? (
          <p className="notes-empty">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="notes-empty">
            {syncStatus?.noteCount === 0
              ? "No notes synced yet. Hit Sync notes."
              : "No notes match these filters."}
          </p>
        ) : (
          <div className="notes-grid">
            {notes.map((n) => {
              const p = projectMap.get(n.projectId);
              return (
                <a
                  key={n.nizekId}
                  className="note-card"
                  href={`/notes/${encodeURIComponent(n.nizekId)}`}
                  onClick={(e) => {
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey ||
                      e.button !== 0
                    ) {
                      return;
                    }
                    e.preventDefault();
                    navigateNotes(`/notes/${encodeURIComponent(n.nizekId)}`);
                  }}
                >
                  <div className="note-card-top">
                    <span className={`note-type-badge ${noteTone(n.noteType)}`}>
                      {noteLabel(n.noteType)}
                    </span>
                    {!projectId && p ? (
                      <span
                        className="note-project-chip"
                        style={{ ["--note-project" as string]: p.color }}
                      >
                        {p.name}
                      </span>
                    ) : null}
                  </div>
                  <h3>{n.title || "Untitled"}</h3>
                  <p className="note-snippet">
                    {n.contentText || "No content"}
                  </p>
                  <div className="note-card-foot">
                    <span>
                      Created {formatCreated(n.createdAt) ?? "—"}
                      {n.commentThreadCount > 0 ? (
                        <em className="note-ack" title="Comment threads">
                          {" "}
                          ✓ {n.commentThreadCount}
                        </em>
                      ) : null}
                    </span>
                    <Avatar name={n.authorName} imageUrl={n.authorImageUrl} />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
