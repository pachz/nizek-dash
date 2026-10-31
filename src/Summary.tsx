import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { AppHeader } from "./components/AppHeader";

type HighlightKind = "ship" | "progress" | "risk" | "chat" | "commit";
type Momentum = "up" | "flat" | "down";

type SummaryPayload = {
  headline: string;
  narrative: string;
  highlights: Array<{ title: string; detail: string; kind: HighlightKind }>;
  byProject: Array<{
    project: string;
    summary: string;
    momentum: Momentum;
  }>;
  risks: string[];
  people: Array<{ name: string; note: string }>;
  stats: {
    commits: number;
    messages: number;
    tasksTouched: number;
    activeProjects: number;
  };
};

type SummaryView = {
  id: Id<"summaries">;
  windowKey: string;
  fromIso: string;
  toIso: string;
  days: string[];
  label: string;
  timeZone: string;
  cached: boolean;
  model: string;
  generatedAt: number;
  inputCounts: {
    commits: number;
    messages: number;
    tasks: number;
    projects: number;
  };
  summary: SummaryPayload;
};

function parsePayload(
  payloadJson: string,
  fallback: {
    headline: string;
    narrative: string;
    inputCounts: SummaryView["inputCounts"];
  },
): SummaryPayload {
  try {
    return JSON.parse(payloadJson) as SummaryPayload;
  } catch {
    return {
      headline: fallback.headline,
      narrative: fallback.narrative,
      highlights: [],
      byProject: [],
      risks: [],
      people: [],
      stats: {
        commits: fallback.inputCounts.commits,
        messages: fallback.inputCounts.messages,
        tasksTouched: fallback.inputCounts.tasks,
        activeProjects: fallback.inputCounts.projects,
      },
    };
  }
}

function kindLabel(kind: HighlightKind) {
  switch (kind) {
    case "ship":
      return "Ship";
    case "progress":
      return "Progress";
    case "risk":
      return "Risk";
    case "chat":
      return "Chat";
    case "commit":
      return "Commit";
  }
}

function momentumLabel(m: Momentum) {
  if (m === "up") return "Up";
  if (m === "down") return "Down";
  return "Flat";
}

function formatGeneratedAt(ms: number) {
  try {
    return new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function rowToView(
  row: {
    _id: Id<"summaries">;
    windowKey: string;
    fromIso: string;
    toIso: string;
    days: string[];
    label: string;
    headline: string;
    narrative: string;
    payloadJson: string;
    model: string;
    generatedAt: number;
    inputCounts: SummaryView["inputCounts"];
  },
  timeZone: string,
  cached: boolean,
): SummaryView {
  return {
    id: row._id,
    windowKey: row.windowKey,
    fromIso: row.fromIso,
    toIso: row.toIso,
    days: row.days,
    label: row.label,
    timeZone,
    cached,
    model: row.model,
    generatedAt: row.generatedAt,
    inputCounts: row.inputCounts,
    summary: parsePayload(row.payloadJson, {
      headline: row.headline,
      narrative: row.narrative,
      inputCounts: row.inputCounts,
    }),
  };
}

export default function Summary() {
  const window = useQuery(api.summary.currentWindow);
  const history = useQuery(api.summary.list, { limit: 40 });
  const latestForWindow = useQuery(
    api.summary.getCached,
    window ? { windowKey: window.windowKey } : "skip",
  );
  const generate = useAction(api.summaryActions.generate);

  const [selectedId, setSelectedId] = useState<Id<"summaries"> | null>(null);
  const [view, setView] = useState<SummaryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selectedRow = useQuery(
    api.summary.get,
    selectedId ? { id: selectedId } : "skip",
  );

  // Prefer explicit selection; otherwise auto-open latest for current window.
  useEffect(() => {
    if (selectedId) return;
    if (!window || !latestForWindow) return;
    setSelectedId(latestForWindow._id);
  }, [window, latestForWindow, selectedId]);

  useEffect(() => {
    if (!selectedRow || !window) return;
    setView(rowToView(selectedRow, window.timeZone, true));
  }, [selectedRow, window]);

  const dayChips = useMemo(() => window?.days ?? [], [window]);

  async function runGenerate(force: boolean) {
    setBusy(true);
    setError(null);
    setStatus(force ? "Generating new digest…" : "Generating digest…");
    try {
      const result = await generate({ force });
      if (!result.ok) {
        setError(result.error);
        setStatus(null);
        return;
      }
      setSelectedId(result.id);
      setView(result);
      setStatus(
        result.cached
          ? "Loaded saved digest."
          : `Saved · generated with ${result.model}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const summary = view?.summary;
  const stats = summary?.stats;
  const hasHistory = (history?.length ?? 0) > 0;

  return (
    <div className="app summary-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader
        tools={
          <div className="summary-tools">
            {dayChips.map((d) => (
              <span key={d} className="chip summary-day-chip">
                {d}
              </span>
            ))}
            <button
              type="button"
              className="primary solid"
              disabled={busy || !window}
              onClick={() => void runGenerate(Boolean(view) || hasHistory)}
            >
              {busy
                ? "Working…"
                : view || hasHistory
                  ? "Generate new"
                  : "Generate digest"}
            </button>
          </div>
        }
      />

      <div className="summary-layout">
        <aside className="summary-history glass" aria-label="Saved digests">
          <header>
            <h2>Saved</h2>
            <p>
              {history === undefined
                ? "Loading…"
                : `${history.length} digest${history.length === 1 ? "" : "s"}`}
            </p>
          </header>
          {history === undefined ? (
            <p className="summary-muted">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="summary-muted">
              No digests yet. Generate one for the current window.
            </p>
          ) : (
            <ul className="summary-history-list">
              {history.map((item) => (
                <li key={item._id}>
                  <button
                    type="button"
                    className="summary-history-item"
                    data-active={selectedId === item._id}
                    onClick={() => {
                      setSelectedId(item._id);
                      setError(null);
                      setStatus(null);
                    }}
                  >
                    <span className="summary-history-when">
                      {formatGeneratedAt(item.generatedAt)}
                    </span>
                    <strong>{item.headline}</strong>
                    <span className="summary-history-meta">
                      {item.label}
                      {" · "}
                      {item.inputCounts.commits}c / {item.inputCounts.messages}
                      m / {item.inputCounts.tasks}t
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="summary-main">
          <section className="summary-window glass">
            <p className="summary-eyebrow">Last two business days</p>
            <h1 className="summary-window-title">
              {view?.label ?? window?.label ?? "Loading window…"}
            </h1>
            <p className="summary-window-meta">
              Sun–Thu work week · {window?.timeZone ?? "Asia/Kuwait"} ·
              company-wide chats, tasks, and commits
            </p>
          </section>

          {error ? <p className="release-banner err">{error}</p> : null}
          {status ? <p className="release-banner ok">{status}</p> : null}

          {!summary && !busy ? (
            <section className="summary-empty glass">
              <h2>Ready when you are</h2>
              <p>
                Pull the last two business days of panel chat, board motion, and
                git activity into one AI digest. Each run is saved — pick any
                past digest from the list.
              </p>
              <button
                type="button"
                className="primary solid"
                disabled={!window}
                onClick={() => void runGenerate(true)}
              >
                Generate digest
              </button>
            </section>
          ) : null}

          {busy && !summary ? (
            <section className="summary-loading glass" aria-busy>
              <div className="summary-skeleton-line wide" />
              <div className="summary-skeleton-line" />
              <div className="summary-skeleton-line mid" />
              <div className="summary-skeleton-kpis">
                <div className="summary-skeleton-box" />
                <div className="summary-skeleton-box" />
                <div className="summary-skeleton-box" />
                <div className="summary-skeleton-box" />
              </div>
            </section>
          ) : null}

          {summary ? (
            <>
              <section className="summary-hero glass-strong">
                <p className="summary-eyebrow">Digest</p>
                <h2 className="summary-headline">{summary.headline}</h2>
                <p className="summary-hero-meta">
                  {view?.label}
                  {view ? ` · ${formatGeneratedAt(view.generatedAt)}` : null}
                  {view?.cached ? " · saved" : " · just generated"}
                  {view?.model ? ` · ${view.model}` : null}
                </p>
              </section>

              <section className="kpi-row summary-kpis">
                <article className="kpi glass">
                  <span className="kpi-label">Commits</span>
                  <strong>{stats?.commits ?? 0}</strong>
                  <em>in window</em>
                </article>
                <article className="kpi glass">
                  <span className="kpi-label">Messages</span>
                  <strong>{stats?.messages ?? 0}</strong>
                  <em>panel chat</em>
                </article>
                <article className="kpi glass">
                  <span className="kpi-label">Tasks</span>
                  <strong>{stats?.tasksTouched ?? 0}</strong>
                  <em>touched</em>
                </article>
                <article className="kpi glass">
                  <span className="kpi-label">Projects</span>
                  <strong>{stats?.activeProjects ?? 0}</strong>
                  <em>with signal</em>
                </article>
              </section>

              <section className="summary-narrative glass">
                {summary.narrative.split(/\n\n+/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </section>

              {summary.highlights.length > 0 ? (
                <section className="summary-highlights glass">
                  <header>
                    <h3>Highlights</h3>
                    <p>What mattered across the window</p>
                  </header>
                  <ul className="summary-highlight-list">
                    {summary.highlights.map((h, i) => (
                      <li key={`${h.title}-${i}`} data-kind={h.kind}>
                        <span className="summary-kind">
                          {kindLabel(h.kind)}
                        </span>
                        <div>
                          <strong>{h.title}</strong>
                          {h.detail ? <p>{h.detail}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {summary.byProject.length > 0 ? (
                <section className="summary-projects glass">
                  <header>
                    <h3>By project</h3>
                    <p>Momentum across active workstreams</p>
                  </header>
                  <ul className="summary-project-list">
                    {summary.byProject.map((p) => (
                      <li key={p.project}>
                        <div className="summary-project-head">
                          <strong>{p.project}</strong>
                          <span
                            className="summary-momentum"
                            data-momentum={p.momentum}
                          >
                            {momentumLabel(p.momentum)}
                          </span>
                        </div>
                        {p.summary ? <p>{p.summary}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="summary-split">
                <section className="summary-risks glass">
                  <header>
                    <h3>Risks</h3>
                    <p>Watch items</p>
                  </header>
                  {summary.risks.length > 0 ? (
                    <ul>
                      {summary.risks.map((r, i) => (
                        <li key={`${r}-${i}`}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="summary-muted">
                      No material risks called out.
                    </p>
                  )}
                </section>

                <section className="summary-people glass">
                  <header>
                    <h3>People</h3>
                    <p>Notable motion</p>
                  </header>
                  {summary.people.length > 0 ? (
                    <ul className="summary-people-list">
                      {summary.people.map((p) => (
                        <li key={p.name}>
                          <strong>{p.name}</strong>
                          {p.note ? <span>{p.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="summary-muted">
                      No standout people signals.
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
