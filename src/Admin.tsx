import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
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
      <section className="admin-gate glass-strong">
        <img
          className="brand-mark"
          src="/nizek-logo.png"
          alt="Nizek"
          width={48}
          height={48}
        />
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

  const [cookieDraft, setCookieDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "err">("ok");
  const [pending, setPending] = useState(false);

  const saveCookie = useMutation(api.settings.saveCookie);
  const importExport = useMutation(api.seed.importExport);
  const rotateToken = useAction(api.nizekActions.rotateToken);
  const syncAll = useAction(api.nizekActions.syncAll);

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
            <p className="brand-sub">Admin</p>
          </div>
        </div>
        <div className="top-actions">
          <a className="ghost" href="/">
            Board
          </a>
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
        </div>
      </header>

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
