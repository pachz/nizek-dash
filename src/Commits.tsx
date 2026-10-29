import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { TaskDetail } from "./components/TaskDetail";
import {
  ConsistencyHeatmap,
  ConsistencyLines,
  DailyVolumeChart,
} from "./components/commits/Charts";

type MatchStatus = "all" | "matched" | "suggested" | "unmatched";

function subject(message: string) {
  return message.split("\n")[0]?.trim() || "(empty)";
}

function body(message: string) {
  const parts = message.split("\n");
  return parts.slice(1).join("\n").trim();
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function matchTone(summary: {
  accepted: number;
  suggested: number;
}): "accepted" | "suggested" | "none" {
  if (summary.accepted > 0) return "accepted";
  if (summary.suggested > 0) return "suggested";
  return "none";
}

export default function Commits() {
  const repos = useQuery(api.gitRepos.list);
  const projects = useQuery(api.projects.list);
  const stats = useQuery(api.commits.stats);
  const githubStatus = useQuery(api.gitRepos.githubStatus);

  const [repoId, setRepoId] = useState<Id<"gitRepos"> | "">("");
  const [projectId, setProjectId] = useState("");
  const [matchStatus, setMatchStatus] = useState<MatchStatus>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedId, setSelectedId] = useState<Id<"commits"> | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [aggDays, setAggDays] = useState(60);

  const setMatchStatusMut = useMutation(api.commits.setMatchStatus);

  useEffect(() => {
    setPage(1);
  }, [repoId, projectId, matchStatus, deferredSearch, pageSize]);

  const aggregates = useQuery(api.commits.aggregates, {
    repoId: repoId || undefined,
    projectId: projectId || undefined,
    days: aggDays,
  });

  const feed = useQuery(api.commits.listForDashboard, {
    repoId: repoId || undefined,
    projectId: projectId || undefined,
    matchStatus,
    search: deferredSearch || undefined,
    page,
    pageSize,
  });

  const detail = useQuery(
    api.commits.getCommit,
    selectedId ? { commitId: selectedId } : "skip",
  );

  const projectName = useMemo(() => {
    const map = new Map((projects ?? []).map((p) => [p.nizekId, p.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [projects]);

  const days = aggregates?.daily.map((d) => d.day) ?? [];

  return (
    <div className="app commits-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <header className="topbar glass-strong">
        <div className="brand">
          <img
            className="brand-mark"
            src="/nizek-logo.png"
            alt="Nizek"
            width={42}
            height={42}
          />
          <div className="brand-copy">
            <p className="brand-name">
              Nizek<span>+</span>
            </p>
            <p className="brand-sub">Commit intelligence</p>
          </div>
        </div>
        <div className="top-actions">
          <label className="search">
            <span className="sr-only">Search commits</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search message, author, sha…"
            />
          </label>
          <a className="ghost" href="/">
            Board
          </a>
          <a className="ghost" href="/release">
            Release
          </a>
          <a className="ghost" href="/admin">
            Admin
          </a>
        </div>
      </header>

      <section className="kpi-row">
        <article className="kpi glass">
          <span className="kpi-label">Commits</span>
          <strong>{aggregates?.total ?? stats?.total ?? "…"}</strong>
          <em>{aggDays}d window</em>
        </article>
        <article className="kpi glass">
          <span className="kpi-label">Active days</span>
          <strong>{aggregates?.activeDays ?? "…"}</strong>
          <em>
            {aggregates
              ? `${Math.round((aggregates.activeDays / aggDays) * 100)}% coverage`
              : "—"}
          </em>
        </article>
        <article className="kpi glass">
          <span className="kpi-label">Avg / day</span>
          <strong>{aggregates?.avgPerDay ?? "…"}</strong>
          <em>streak {aggregates?.currentStreak ?? 0}d</em>
        </article>
        <article className="kpi glass">
          <span className="kpi-label">Matched</span>
          <strong>{stats?.matchedPct ?? 0}%</strong>
          <em>
            {stats?.matched ?? 0} accepted · {stats?.suggested ?? 0} suggested
          </em>
        </article>
        <article className="kpi glass">
          <span className="kpi-label">Sync</span>
          <strong className="kpi-sync">
            {githubStatus?.lastCommitSyncAt
              ? new Date(githubStatus.lastCommitSyncAt).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric" },
                )
              : "—"}
          </strong>
          <em>
            {githubStatus?.lastCommitSyncAt
              ? new Date(githubStatus.lastCommitSyncAt).toLocaleTimeString(
                  undefined,
                  { hour: "2-digit", minute: "2-digit" },
                )
              : "Run sync in Admin"}
          </em>
        </article>
      </section>

      <div className="commits-filters glass">
        <label>
          <span>Repo</span>
          <select
            value={repoId}
            onChange={(e) =>
              setRepoId(e.target.value as Id<"gitRepos"> | "")
            }
          >
            <option value="">All repos</option>
            {(repos ?? []).map((r) => (
              <option key={r._id} value={r._id}>
                {r.fullName}
                {!r.enabled ? " (off)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All mapped projects</option>
            {(projects ?? []).map((p) => (
              <option key={p.nizekId} value={p.nizekId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Match</span>
          <select
            value={matchStatus}
            onChange={(e) => setMatchStatus(e.target.value as MatchStatus)}
          >
            <option value="all">All</option>
            <option value="matched">Accepted</option>
            <option value="suggested">Suggested</option>
            <option value="unmatched">Unmatched</option>
          </select>
        </label>
        <label>
          <span>Window</span>
          <select
            value={aggDays}
            onChange={(e) => setAggDays(Number(e.target.value))}
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <label>
          <span>Page size</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      <section className="analytics-grid">
        <article className="analytics-card glass">
          <header>
            <h2>Daily volume</h2>
            <p>Total commits per day across the filtered repos.</p>
          </header>
          {aggregates ? (
            <DailyVolumeChart daily={aggregates.daily} />
          ) : (
            <p className="muted chart-loading">Loading chart…</p>
          )}
        </article>

        <article className="analytics-card glass">
          <header>
            <h2>Consistency by project</h2>
            <p>Daily cadence per mapped project — click a legend to focus.</p>
          </header>
          {aggregates && aggregates.consistency.length > 0 ? (
            <ConsistencyLines
              daily={aggregates.daily}
              consistency={aggregates.consistency}
            />
          ) : (
            <p className="muted chart-loading">
              Map repos to projects in Admin to unlock this chart.
            </p>
          )}
        </article>

        <article className="analytics-card glass analytics-wide">
          <header>
            <h2>Activity heatmap</h2>
            <p>Day-by-day presence for top projects — denser = more commits.</p>
          </header>
          {aggregates && aggregates.consistency.length > 0 ? (
            <ConsistencyHeatmap
              consistency={aggregates.consistency}
              days={days}
            />
          ) : (
            <p className="muted chart-loading">No project activity yet.</p>
          )}
          {aggregates && aggregates.consistency.length > 0 ? (
            <div className="consistency-stats">
              {aggregates.consistency.map((c) => (
                <div key={c.projectId} className="consistency-stat">
                  <span className="dot" style={{ background: c.color }} />
                  <strong>{c.name}</strong>
                  <span>{c.commits} commits</span>
                  <span>{c.coveragePct}% days</span>
                  <span>streak {c.currentStreak}d</span>
                  <span>best {c.longestStreak}d</span>
                  <span>avg {c.avgPerActiveDay}/active</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>

      </section>

      <section className="commits-workspace">
        <div className="commits-list-pane glass">
          <header className="list-pane-head">
            <div>
              <h2>Commits</h2>
              <p>
                {feed
                  ? `${feed.total} matching · page ${feed.page}/${feed.pageCount}`
                  : "Loading…"}
              </p>
            </div>
            <div className="pager">
              <button
                type="button"
                className="ghost"
                disabled={!feed || feed.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span className="pill soft">
                {feed?.page ?? "—"} / {feed?.pageCount ?? "—"}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={!feed || feed.page >= feed.pageCount}
                onClick={() =>
                  setPage((p) =>
                    feed ? Math.min(feed.pageCount, p + 1) : p + 1,
                  )
                }
              >
                Next
              </button>
            </div>
          </header>

          <div className="commit-table-wrap">
            <table className="commit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Sha</th>
                  <th>Message</th>
                  <th>Author</th>
                  <th>Repo</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {feed === undefined ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Loading commits…
                    </td>
                  </tr>
                ) : feed.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No commits in this view. Sync from Admin or widen filters.
                    </td>
                  </tr>
                ) : (
                  feed.items.map((c) => {
                    const tone = matchTone(c.matchSummary);
                    return (
                      <tr
                        key={c._id}
                        data-selected={selectedId === c._id}
                        onClick={() => setSelectedId(c._id)}
                      >
                        <td className="col-when">{formatWhen(c.authoredAt)}</td>
                        <td className="col-sha">
                          <code>{shortSha(c.sha)}</code>
                        </td>
                        <td className="col-msg">
                          <span className="msg-subject">{subject(c.message)}</span>
                          {c.branches[0] ? (
                            <span className="branch-chip">{c.branches[0]}</span>
                          ) : null}
                        </td>
                        <td className="col-author">{c.authorName}</td>
                        <td className="col-repo">{c.repoFullName}</td>
                        <td className="col-match">
                          <span className={`match-pill tone-${tone}`}>
                            {tone === "accepted"
                              ? `${c.matchSummary.accepted} accepted`
                              : tone === "suggested"
                                ? `${c.matchSummary.suggested} suggested`
                                : "Unmatched"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <footer className="list-pane-foot">
            <div className="pager">
              <button
                type="button"
                className="ghost"
                disabled={!feed || feed.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span className="muted tiny">
                Showing{" "}
                {feed
                  ? `${(feed.page - 1) * feed.pageSize + 1}–${Math.min(feed.page * feed.pageSize, feed.total)}`
                  : "—"}{" "}
                of {feed?.total ?? "—"}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={!feed || feed.page >= feed.pageCount}
                onClick={() =>
                  setPage((p) =>
                    feed ? Math.min(feed.pageCount, p + 1) : p + 1,
                  )
                }
              >
                Next
              </button>
            </div>
          </footer>
        </div>

        <aside className="commit-detail-pane glass">
          {!selectedId ? (
            <div className="detail-empty">
              <h2>Detail</h2>
              <p>Select a commit from the list to inspect message, branches, and task matches.</p>
            </div>
          ) : detail === undefined ? (
            <div className="detail-empty">
              <p className="muted">Loading detail…</p>
            </div>
          ) : detail === null ? (
            <div className="detail-empty">
              <p className="muted">Commit not found.</p>
            </div>
          ) : (
            <>
              <header className="detail-head">
                <div>
                  <a
                    className="commit-sha"
                    href={detail.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortSha(detail.sha)}
                  </a>
                  <span className="pill soft">{detail.repoFullName}</span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSelectedId(null)}
                >
                  Close
                </button>
              </header>

              <h3 className="detail-title">{subject(detail.message)}</h3>
              <dl className="detail-meta">
                <div>
                  <dt>Author</dt>
                  <dd>
                    {detail.authorName}
                    {detail.authorEmail ? (
                      <span className="muted"> · {detail.authorEmail}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>{formatWhen(detail.authoredAt)}</dd>
                </div>
                <div>
                  <dt>SHA</dt>
                  <dd>
                    <code>{detail.sha}</code>
                  </dd>
                </div>
                <div>
                  <dt>Branches</dt>
                  <dd className="branch-wrap">
                    {detail.branches.map((b) => (
                      <span key={b} className="branch-chip">
                        {b}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>Mapped projects</dt>
                  <dd>
                    {detail.projectIds.length
                      ? detail.projectIds.map(projectName).join(", ")
                      : "None"}
                  </dd>
                </div>
              </dl>

              {body(detail.message) ? (
                <pre className="commit-body">{body(detail.message)}</pre>
              ) : null}

              <section className="detail-matches">
                <h4>Task matches</h4>
                {detail.matches.length === 0 ? (
                  <p className="muted">No matches yet — run matching in Admin.</p>
                ) : (
                  <ul>
                    {detail.matches.map((m) => (
                      <li key={m._id} className={`detail-match status-${m.status}`}>
                        <button
                          type="button"
                          className="match-open"
                          onClick={() => setSelectedTaskId(m.taskNizekId)}
                        >
                          <strong>{m.taskCode ?? "Task"}</strong>
                          <span>{m.taskTitle ?? m.taskNizekId}</span>
                        </button>
                        <p className="muted tiny">
                          {m.projectName ?? projectName(m.projectId)} ·{" "}
                          {Math.round(m.confidence * 100)}% · {m.method}
                          {m.model ? ` · ${m.model}` : ""} · {m.status}
                          {m.stage ? ` · ${m.stage}` : ""}
                        </p>
                        <p className="match-reason">{m.reason}</p>
                        {m.status === "suggested" ? (
                          <div className="match-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                void setMatchStatusMut({
                                  matchId: m._id,
                                  status: "accepted",
                                })
                              }
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                void setMatchStatusMut({
                                  matchId: m._id,
                                  status: "rejected",
                                })
                              }
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <a
                className="ghost link-btn detail-gh"
                href={detail.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open on GitHub
              </a>
            </>
          )}
        </aside>
      </section>

      {selectedTaskId ? (
        <TaskDetail
          nizekId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  );
}
