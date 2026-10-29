import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { TaskDetail } from "./components/TaskDetail";

type MatchStatus = "all" | "matched" | "suggested" | "unmatched";

function subject(message: string) {
  return message.split("\n")[0]?.trim() || "(empty)";
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const setMatchStatusMut = useMutation(api.commits.setMatchStatus);

  const feed = useQuery(api.commits.listForDashboard, {
    repoId: repoId || undefined,
    projectId: projectId || undefined,
    matchStatus,
    search: deferredSearch || undefined,
    limit: 150,
  });

  const projectName = useMemo(() => {
    const map = new Map((projects ?? []).map((p) => [p.nizekId, p.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [projects]);

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
            <p className="brand-sub">Commits</p>
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
          <a className="ghost" href="/admin">
            Admin
          </a>
        </div>
      </header>

      <div className="status-row">
        <span className="pill">{stats?.total ?? "…"} commits · 60d</span>
        <span className="pill soft">
          {stats?.matchedPct ?? 0}% accepted
        </span>
        <span className="pill soft">{stats?.suggested ?? 0} suggested</span>
        <span className="pill soft">{stats?.unmatched ?? 0} unmatched</span>
        {githubStatus?.lastCommitSyncAt ? (
          <span className="pill soft">
            Synced {formatWhen(new Date(githubStatus.lastCommitSyncAt).toISOString())}
          </span>
        ) : (
          <span className="pill">No commit sync yet — use Admin</span>
        )}
      </div>

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
      </div>

      <ul className="commit-feed">
        {feed === undefined ? (
          <li className="commit-empty glass">Loading commits…</li>
        ) : feed.length === 0 ? (
          <li className="commit-empty glass">
            No commits in this view. Add repos and sync from Admin.
          </li>
        ) : (
          feed.map((c) => (
            <li key={c._id} className="commit-card glass">
              <div className="commit-meta">
                <a
                  className="commit-sha"
                  href={c.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortSha(c.sha)}
                </a>
                <span className="pill soft">{c.repoFullName}</span>
                <span className="muted">{c.authorName}</span>
                <span className="muted">{formatWhen(c.authoredAt)}</span>
                {c.branches.slice(0, 3).map((b) => (
                  <span key={b} className="branch-chip">
                    {b}
                  </span>
                ))}
                {c.branches.length > 3 ? (
                  <span className="branch-chip">+{c.branches.length - 3}</span>
                ) : null}
              </div>
              <p className="commit-subject">{subject(c.message)}</p>
              <div className="commit-matches">
                {c.matches.length === 0 ? (
                  <span className="pill">Unmatched</span>
                ) : (
                  c.matches.map((m) => (
                    <div key={m._id} className="match-chip-row">
                      <button
                        type="button"
                        className={`match-chip method-${m.method} status-${m.status}`}
                        onClick={() => setSelectedTaskId(m.taskNizekId)}
                        title={m.reason}
                      >
                        <strong>{m.taskCode ?? "Task"}</strong>
                        <span>{m.taskTitle ?? m.taskNizekId.slice(0, 8)}</span>
                        <em>
                          {Math.round(m.confidence * 100)}% · {m.method} ·{" "}
                          {m.status}
                        </em>
                      </button>
                      {m.status === "suggested" ? (
                        <span className="match-actions">
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
                        </span>
                      ) : null}
                      <span className="muted tiny">
                        {projectName(m.projectId)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </li>
          ))
        )}
      </ul>

      {selectedTaskId ? (
        <TaskDetail
          nizekId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  );
}
