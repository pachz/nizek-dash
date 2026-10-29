import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppHeader } from "./components/AppHeader";
import { isAdminUnlocked, lockAdmin, unlockAdmin } from "./lib/admin";

function friendlyError(err: unknown): string {
  if (err instanceof Error) {
    const cleaned = err.message
      .replace(/^\[Request ID:[^\]]+\]\s*/i, "")
      .replace(/^Server Error\s*/i, "")
      .replace(/^Uncaught Error:\s*/i, "")
      .trim();
    return cleaned || err.message;
  }
  return String(err);
}

function LoginGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  return (
    <div className="app admin-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>
      <AppHeader />
      <section className="admin-gate glass-strong">
        <h1>Admin</h1>
        <p>Session, token, and sync controls.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (unlockAdmin(password)) {
              onUnlock();
              return;
            }
            setError(true);
          }}
        >
          <label>
            <span className="sr-only">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              placeholder="Password"
            />
          </label>
          {error ? <p className="admin-error">Wrong password</p> : null}
          <button type="submit" className="primary solid">
            Unlock
          </button>
        </form>
        <a className="admin-back" href="/">
          ← Back to board
        </a>
      </section>
    </div>
  );
}

function AdminPanel({ onLock }: { onLock: () => void }) {
  const settings = useQuery(api.settings.get);
  const projects = useQuery(api.projects.list);
  const gitRepos = useQuery(api.gitRepos.list);
  const githubStatus = useQuery(api.gitRepos.githubStatus);

  const [cookieDraft, setCookieDraft] = useState("");
  const [githubDraft, setGithubDraft] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "err">("ok");
  const [pending, setPending] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(
    null,
  );

  const saveCookie = useMutation(api.settings.saveCookie);
  const saveGithubToken = useMutation(api.gitRepos.saveGithubToken);
  const upsertRepo = useMutation(api.gitRepos.upsert);
  const setRepoEnabled = useMutation(api.gitRepos.setEnabled);
  const setRepoProjects = useMutation(api.gitRepos.setProjectIds);
  const removeRepo = useMutation(api.gitRepos.remove);
  const importExport = useMutation(api.seed.importExport);
  const rotateToken = useAction(api.nizekActions.rotateToken);
  const syncAll = useAction(api.nizekActions.syncAll);
  const syncCommits = useAction(api.gitActions.syncCommits);
  const runMatching = useAction(api.matchActions.runMatching);
  const openaiStatus = useAction(api.matchActions.openaiStatus);

  useEffect(() => {
    void openaiStatus({})
      .then((r) => setOpenaiConfigured(r.configured))
      .catch(() => setOpenaiConfigured(false));
  }, [openaiStatus]);

  function showOk(message: string) {
    setStatusTone("ok");
    setStatus(message);
  }

  function showErr(message: string) {
    setStatusTone("err");
    setStatus(message);
  }

  async function runJob(label: string, job: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    showOk(label);
    try {
      await job();
    } catch (e) {
      showErr(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  const tokenLabel = useMemo(() => {
    if (!settings?.centrifugoExpiresAt) return "Token idle";
    const ms = settings.centrifugoExpiresAt - Date.now();
    if (ms <= 0) return "Token expired";
    const mins = Math.round(ms / 60000);
    return `JWT · ${mins}m left`;
  }, [settings?.centrifugoExpiresAt]);

  return (
    <div className="app admin-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader
        tools={
          <>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                lockAdmin();
                onLock();
              }}
            >
              Lock
            </button>
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() =>
                void runJob("Rotating Centrifugo JWT…", async () => {
                  const r = await rotateToken({});
                  if (!r.ok) {
                    showErr(r.error);
                    return;
                  }
                  showOk(
                    `Rotated · sub ${r.sub?.slice(0, 8) ?? "?"} · ${r.email ?? ""}`,
                  );
                })
              }
            >
              Rotate token
            </button>
            <button
              type="button"
              className="primary solid"
              disabled={pending}
              onClick={() =>
                void runJob("Syncing projects & tasks…", async () => {
                  const r = await syncAll({});
                  if (!r.ok) {
                    showErr(r.error);
                    return;
                  }
                  showOk(`Synced ${r.projects} projects · ${r.tasks} tasks`);
                })
              }
            >
              Sync now
            </button>
          </>
        }
      />

      <div className="status-row">
        <span className="pill">{tokenLabel}</span>
        <span className="pill">{projects?.length ?? 0} projects</span>
        {settings?.sessionEmail ? (
          <span className="pill soft">{settings.sessionEmail}</span>
        ) : null}
        {settings?.lastError ? (
          <span className="pill danger">{settings.lastError}</span>
        ) : null}
        {status ? (
          <span className={`pill ${statusTone === "err" ? "danger" : "soft"}`}>
            {status}
          </span>
        ) : null}
      </div>

      <section className="session-panel glass">
        <div>
          <h2>Auth bridge</h2>
          <p>
            Panel uses <strong>better-auth</strong> cookies (not Supabase) plus a
            rotating Centrifugo JWT from <code>POST /api/centrifugo/token</code>.
            Paste the Cookie header from an authenticated request on{" "}
            <code>panel.nizek.com</code>.
          </p>
          <textarea
            value={cookieDraft}
            onChange={(e) => setCookieDraft(e.target.value)}
            placeholder="better-auth…=…; …"
            rows={3}
          />
          <div className="row">
            <button
              type="button"
              className="primary solid"
              disabled={pending}
              onClick={() =>
                void runJob("Saving cookie…", async () => {
                  await saveCookie({ cookieHeader: cookieDraft });
                  showOk("Cookie saved");
                })
              }
            >
              Save cookie
            </button>
            <button
              type="button"
              className="ghost"
              disabled={pending}
              onClick={() =>
                void runJob("Importing local seed…", async () => {
                  const { default: seed } = await import(
                    "../seed/nizek-export.json"
                  );
                  const r = await importExport({
                    projects: seed.projects.map((p) => ({
                      id: p.id,
                      name: p.name,
                      teamName: p.teamName,
                      taskCount: p.taskCount,
                      enabled: p.enabled ?? true,
                    })),
                    tasks: seed.tasks,
                    user: seed.user,
                  });
                  showOk(`Seeded ${r.projects} projects · ${r.tasks} tasks`);
                })
              }
            >
              Load seed export
            </button>
          </div>
        </div>
      </section>

      <section className="session-panel glass">
        <div>
          <h2>GitHub commits</h2>
          <p>
            One shared PAT (classic <code>repo</code> or fine-grained Contents
            read). Repos are mapped to Nizek projects for task matching. Sync
            pulls ~60 days across all branches; matching runs heuristic then AI.
          </p>
          <div className="status-row" style={{ marginBottom: 12 }}>
            <span className="pill">
              {githubStatus?.hasToken
                ? `Token ${githubStatus.tokenHint}`
                : "No GitHub token"}
            </span>
            <span className="pill soft">
              {gitRepos?.length ?? 0} repos
            </span>
            <span
              className={`pill ${openaiConfigured ? "soft" : "danger"}`}
            >
              {openaiConfigured === null
                ? "OpenAI…"
                : openaiConfigured
                  ? "OpenAI configured"
                  : "OpenAI missing on Convex"}
            </span>
            {githubStatus?.lastCommitSyncAt ? (
              <span className="pill soft">
                Sync{" "}
                {new Date(githubStatus.lastCommitSyncAt).toLocaleString()}
              </span>
            ) : null}
            {githubStatus?.lastCommitError ? (
              <span className="pill danger">{githubStatus.lastCommitError}</span>
            ) : null}
            {githubStatus?.lastMatchError ? (
              <span className="pill danger">{githubStatus.lastMatchError}</span>
            ) : null}
          </div>
          <textarea
            value={githubDraft}
            onChange={(e) => setGithubDraft(e.target.value)}
            placeholder="ghp_… or github_pat_…"
            rows={2}
          />
          <div className="row">
            <button
              type="button"
              className="primary solid"
              disabled={pending}
              onClick={() =>
                void runJob("Saving GitHub token…", async () => {
                  await saveGithubToken({ token: githubDraft });
                  setGithubDraft("");
                  showOk("GitHub token saved");
                })
              }
            >
              Save token
            </button>
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() =>
                void runJob("Syncing commits…", async () => {
                  const r = await syncCommits({});
                  if (!r.ok) {
                    showErr(r.error);
                    return;
                  }
                  showOk(
                    `Commits · ${r.repos} repos · +${r.inserted} new · ~${r.updated} updated`,
                  );
                })
              }
            >
              Sync commits now
            </button>
            <button
              type="button"
              className="ghost"
              disabled={pending}
              onClick={() =>
                void runJob("Matching commits…", async () => {
                  const r = await runMatching({});
                  if (!r.ok) {
                    showErr(r.error);
                    return;
                  }
                  showOk(
                    `Matched · heuristic ${r.heuristic} · AI ${r.ai} · scanned ${r.scanned}`,
                  );
                })
              }
            >
              Run matching now
            </button>
          </div>

          <div className="repo-add-row">
            <input
              value={repoDraft}
              onChange={(e) => setRepoDraft(e.target.value)}
              placeholder="owner/repo"
            />
            <button
              type="button"
              className="primary solid"
              disabled={pending || !repoDraft.trim()}
              onClick={() =>
                void runJob("Adding repo…", async () => {
                  await upsertRepo({ fullName: repoDraft });
                  setRepoDraft("");
                  showOk("Repo added");
                })
              }
            >
              Add repo
            </button>
          </div>

          <ul className="repo-list">
            {(gitRepos ?? []).map((repo) => (
              <li key={repo._id} className="repo-card">
                <div className="repo-card-head">
                  <div>
                    <code>{repo.fullName}</code>
                    {repo.lastError ? (
                      <p className="admin-error">{repo.lastError}</p>
                    ) : null}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="ghost"
                      data-on={repo.enabled}
                      disabled={pending}
                      title={
                        repo.enabled
                          ? "Click to disable sync for this repo"
                          : "Click to enable sync for this repo"
                      }
                      onClick={() =>
                        void runJob(
                          repo.enabled ? "Disabling…" : "Enabling…",
                          async () => {
                            await setRepoEnabled({
                              repoId: repo._id,
                              enabled: !repo.enabled,
                            });
                            showOk(
                              `${repo.fullName} ${repo.enabled ? "disabled" : "enabled"}`,
                            );
                          },
                        )
                      }
                    >
                      {repo.enabled ? "Sync on" : "Sync off — click to enable"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={pending}
                      onClick={() =>
                        void runJob("Removing repo…", async () => {
                          await removeRepo({ repoId: repo._id });
                          showOk(`Removed ${repo.fullName}`);
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <p className="repo-map-label">Map to Nizek projects</p>
                <div className="repo-project-grid">
                  {(projects ?? []).map((p) => {
                    const on = repo.projectIds.includes(p.nizekId);
                    return (
                      <button
                        key={p.nizekId}
                        type="button"
                        className="ghost repo-project-chip"
                        data-on={on}
                        disabled={pending}
                        onClick={() =>
                          void runJob("Updating map…", async () => {
                            const next = on
                              ? repo.projectIds.filter((id) => id !== p.nizekId)
                              : [...repo.projectIds, p.nizekId];
                            await setRepoProjects({
                              repoId: repo._id,
                              projectIds: next,
                            });
                            showOk("Project map updated");
                          })
                        }
                      >
                        <span
                          className="dot"
                          style={{ background: p.color }}
                          aria-hidden
                        />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export default function Admin() {
  const [unlocked, setUnlocked] = useState(() => isAdminUnlocked());

  if (!unlocked) {
    return <LoginGate onUnlock={() => setUnlocked(true)} />;
  }

  return <AdminPanel onLock={() => setUnlocked(false)} />;
}
