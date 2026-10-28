import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Kanban } from "./components/Kanban";
import {
  BOARD_COLUMNS,
  DEFAULT_VISIBLE_STAGES,
  type StageKey,
} from "./lib/stages";

export default function App() {
  const settings = useQuery(api.settings.get);
  const projects = useQuery(api.projects.list);
  const options = useQuery(api.tasks.filterOptions);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [visibleStages, setVisibleStages] = useState<StageKey[]>([
    ...DEFAULT_VISIBLE_STAGES,
  ]);
  const [types, setTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [activeSprintOnly, setActiveSprintOnly] = useState(false);
  const [cookieDraft, setCookieDraft] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tasks = useQuery(api.tasks.listForBoard, {
    search: deferredSearch || undefined,
    stages: visibleStages,
    types: types.length ? types : undefined,
    priorities: priorities.length ? priorities : undefined,
    assignees: assignees.length ? assignees : undefined,
    activeSprintOnly: activeSprintOnly || undefined,
  });

  const saveCookie = useMutation(api.settings.saveCookie);
  const setEnabled = useMutation(api.projects.setEnabled);
  const setAllEnabled = useMutation(api.projects.setAllEnabled);
  const importExport = useMutation(api.seed.importExport);
  const rotateToken = useAction(api.nizekActions.rotateToken);
  const syncAll = useAction(api.nizekActions.syncAll);

  const enabledCount = useMemo(
    () => projects?.filter((p) => p.enabled).length ?? 0,
    [projects],
  );

  const tokenLabel = useMemo(() => {
    if (!settings?.centrifugoExpiresAt) return "Token idle";
    const ms = settings.centrifugoExpiresAt - Date.now();
    if (ms <= 0) return "Token expired";
    const mins = Math.round(ms / 60000);
    return `JWT · ${mins}m left`;
  }, [settings?.centrifugoExpiresAt]);

  function toggleStage(key: StageKey) {
    setVisibleStages((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  }

  function toggleMulti(
    value: string,
    list: string[],
    setList: (v: string[]) => void,
  ) {
    setList(
      list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    );
  }

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />
      <header className="top">
        <div className="brand-block">
          <p className="brand">Nizek+</p>
          <h1>Combined board</h1>
          <p className="lede">
            All projects, one pipeline — search, filter, and toggle what you see.
          </p>
        </div>
        <div className="top-actions">
          <label className="search">
            <span className="sr-only">Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks, people, projects…"
            />
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => setActiveSprintOnly((v) => !v)}
            data-on={activeSprintOnly}
          >
            Active sprint
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setPanelOpen((v) => !v)}
          >
            Session
          </button>
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setStatus("Rotating Centrifugo JWT…");
                try {
                  const r = await rotateToken({});
                  setStatus(
                    `Rotated · sub ${r.sub?.slice(0, 8) ?? "?"} · ${r.email ?? ""}`,
                  );
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e));
                  setPanelOpen(true);
                }
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
              startTransition(async () => {
                setStatus("Syncing projects & tasks…");
                try {
                  const r = await syncAll({});
                  setStatus(`Synced ${r.projects} projects · ${r.tasks} tasks`);
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e));
                  setPanelOpen(true);
                }
              })
            }
          >
            Sync now
          </button>
        </div>
      </header>

      <div className="status-row">
        <span className="pill">{tokenLabel}</span>
        <span className="pill">
          {enabledCount}/{projects?.length ?? 0} projects
        </span>
        <span className="pill">{tasks?.length ?? 0} cards</span>
        {settings?.sessionEmail ? (
          <span className="pill soft">{settings.sessionEmail}</span>
        ) : null}
        {settings?.lastError ? (
          <span className="pill danger">{settings.lastError}</span>
        ) : null}
        {status ? <span className="pill soft">{status}</span> : null}
      </div>

      {panelOpen ? (
        <section className="session-panel">
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
                onClick={() =>
                  startTransition(async () => {
                    await saveCookie({ cookieHeader: cookieDraft });
                    setStatus("Cookie saved");
                  })
                }
              >
                Save cookie
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  startTransition(async () => {
                    setStatus("Importing local seed…");
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
                    setStatus(
                      `Seeded ${r.projects} projects · ${r.tasks} tasks`,
                    );
                  })
                }
              >
                Load seed export
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="projects-strip">
        <div className="strip-head">
          <h2>Projects</h2>
          <div className="row">
            <button
              type="button"
              className="tiny"
              onClick={() => void setAllEnabled({ enabled: true })}
            >
              All on
            </button>
            <button
              type="button"
              className="tiny"
              onClick={() => void setAllEnabled({ enabled: false })}
            >
              All off
            </button>
          </div>
        </div>
        <div className="project-toggles">
          {(projects ?? []).map((p) => (
            <button
              key={p._id}
              type="button"
              className="project-toggle"
              data-on={p.enabled}
              style={{ ["--pc" as string]: p.color }}
              onClick={() =>
                void setEnabled({ nizekId: p.nizekId, enabled: !p.enabled })
              }
            >
              <span className="swatch" />
              <span className="pname">{p.name}</span>
              <span className="pmeta">
                {p.teamName ?? "—"} · {p.taskCount}
              </span>
            </button>
          ))}
          {!projects?.length ? (
            <p className="hint">
              No projects yet — open Session and load the seed, or sync with a
              cookie.
            </p>
          ) : null}
        </div>
      </section>

      <section className="filters">
        <div className="filter-group">
          <span>Stages</span>
          <div className="chips">
            {BOARD_COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                className="chip"
                data-on={visibleStages.includes(c.key)}
                onClick={() => toggleStage(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {options?.types?.length ? (
          <div className="filter-group">
            <span>Type</span>
            <div className="chips">
              {options.types.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  data-on={types.includes(t)}
                  onClick={() => toggleMulti(t, types, setTypes)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {options?.priorities?.length ? (
          <div className="filter-group">
            <span>Priority</span>
            <div className="chips">
              {options.priorities.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  data-on={priorities.includes(t)}
                  onClick={() => toggleMulti(t, priorities, setPriorities)}
                >
                  {t.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {options?.assignees?.length ? (
          <div className="filter-group">
            <span>Assignee</span>
            <div className="chips wrap">
              {options.assignees.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  data-on={assignees.includes(t)}
                  onClick={() => toggleMulti(t, assignees, setAssignees)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <main>
        {tasks === undefined ? (
          <div className="loading">Loading board…</div>
        ) : (
          <Kanban tasks={tasks} stages={visibleStages} />
        )}
      </main>
    </div>
  );
}
