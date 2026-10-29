import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppHeader } from "./components/AppHeader";
import { Kanban } from "./components/Kanban";
import { TaskDetail } from "./components/TaskDetail";
import { BOARD_COLUMNS, type StageKey } from "./lib/stages";
import {
  loadBoardPrefs,
  saveBoardPrefs,
  type BoardPrefs,
} from "./lib/prefs";

export default function App() {
  const projects = useQuery(api.projects.list);

  const [prefs, setPrefs] = useState<BoardPrefs>(() => loadBoardPrefs());
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    saveBoardPrefs(prefs);
  }, [prefs]);

  const projectIds = useMemo(() => {
    if (!projects) return undefined;
    const disabled = new Set(prefs.disabledProjectIds);
    return projects
      .filter((p) => !disabled.has(p.nizekId))
      .map((p) => p.nizekId);
  }, [projects, prefs.disabledProjectIds]);

  const options = useQuery(
    api.tasks.filterOptions,
    projectIds === undefined ? "skip" : { projectIds },
  );

  const tasks = useQuery(
    api.tasks.listForBoard,
    projectIds === undefined
      ? "skip"
      : {
          search: deferredSearch || undefined,
          stages: prefs.visibleStages,
          types: prefs.types.length ? prefs.types : undefined,
          priorities: prefs.priorities.length ? prefs.priorities : undefined,
          assignees: prefs.assignees.length ? prefs.assignees : undefined,
          activeSprintOnly: prefs.activeSprintOnly || undefined,
          projectIds,
        },
  );

  const enabledCount = projectIds?.length ?? 0;

  function patchPrefs(partial: Partial<BoardPrefs>) {
    setPrefs((prev) => ({ ...prev, ...partial }));
  }

  function toggleStage(key: StageKey) {
    setPrefs((prev) => ({
      ...prev,
      visibleStages: prev.visibleStages.includes(key)
        ? prev.visibleStages.filter((s) => s !== key)
        : [...prev.visibleStages, key],
    }));
  }

  function toggleMulti(key: keyof Pick<BoardPrefs, "types" | "priorities" | "assignees">, value: string) {
    setPrefs((prev) => {
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(value)
          ? list.filter((x) => x !== value)
          : [...list, value],
      };
    });
  }

  function toggleProject(nizekId: string) {
    setPrefs((prev) => {
      const off = prev.disabledProjectIds.includes(nizekId);
      return {
        ...prev,
        disabledProjectIds: off
          ? prev.disabledProjectIds.filter((id) => id !== nizekId)
          : [...prev.disabledProjectIds, nizekId],
      };
    });
  }

  function setAllProjects(enabled: boolean) {
    if (!projects) return;
    patchPrefs({
      disabledProjectIds: enabled ? [] : projects.map((p) => p.nizekId),
    });
  }

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader
        tools={
          <>
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
              onClick={() =>
                patchPrefs({ activeSprintOnly: !prefs.activeSprintOnly })
              }
              data-on={prefs.activeSprintOnly}
            >
              Active sprint
            </button>
          </>
        }
      />

      <div className="status-row">
        <span className="pill">
          {enabledCount}/{projects?.length ?? 0} projects
        </span>
        <span className="pill">{tasks?.length ?? 0} cards</span>
      </div>

      <section className="projects-strip glass">
        <div className="strip-head">
          <h2>Projects</h2>
          <div className="row">
            <button
              type="button"
              className="tiny"
              onClick={() => setAllProjects(true)}
            >
              All on
            </button>
            <button
              type="button"
              className="tiny"
              onClick={() => setAllProjects(false)}
            >
              All off
            </button>
          </div>
        </div>
        <div className="project-toggles">
          {(projects ?? []).map((p) => {
            const on = !prefs.disabledProjectIds.includes(p.nizekId);
            return (
              <button
                key={p._id}
                type="button"
                className="project-toggle"
                data-on={on}
                style={{ ["--pc" as string]: p.color }}
                onClick={() => toggleProject(p.nizekId)}
              >
                <span className="swatch" />
                <span className="pname">{p.name}</span>
                <span className="pmeta">{p.taskCount}</span>
              </button>
            );
          })}
          {!projects?.length ? (
            <p className="hint">
              No projects yet — ask an admin to sync from{" "}
              <a href="/admin">/admin</a>.
            </p>
          ) : null}
        </div>
      </section>

      <section className="filters glass">
        <div className="filter-group">
          <span>Stages</span>
          <div className="chips">
            {BOARD_COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                className="chip"
                data-on={prefs.visibleStages.includes(c.key)}
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
                  data-on={prefs.types.includes(t)}
                  onClick={() => toggleMulti("types", t)}
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
                  data-on={prefs.priorities.includes(t)}
                  onClick={() => toggleMulti("priorities", t)}
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
                  data-on={prefs.assignees.includes(t)}
                  onClick={() => toggleMulti("assignees", t)}
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
          <Kanban
            tasks={tasks}
            stages={prefs.visibleStages}
            onSelect={(task) => setSelectedTaskId(task.nizekId)}
          />
        )}
      </main>

      {selectedTaskId ? (
        <TaskDetail
          nizekId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  );
}
