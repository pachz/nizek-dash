import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppHeader } from "./components/AppHeader";
import { taskCode } from "./lib/stages";
import {
  buildReleaseBrief,
  buildReleaseDoc,
  docsImportUrl,
  formatRangeLabel,
  generateViaDocsApi,
  suggestReleaseMeta,
  type ReleaseCommit,
  type ReleaseDoc,
  type ReleaseTask,
} from "./lib/releaseNotes";

type Step = 1 | 2 | 3 | 4;

type PresetId = "7d" | "14d" | "30d" | "month" | "custom";

const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: 1, label: "Project", hint: "What are we shipping?" },
  { id: 2, label: "Window", hint: "Pick the release timeframe" },
  { id: 3, label: "Items", hint: "Tasks + commits on main" },
  { id: 4, label: "Release", hint: "Generate the notes" },
];

const DOCS_URL =
  (import.meta.env.VITE_NIZEK_DOCS_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) || "http://127.0.0.1:5173";

function startOfDayIso(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function endOfDayIso(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function toDateInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInput(value: string, end = false) {
  const d = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return d.toISOString();
}

function resolvePreset(preset: PresetId): { fromIso: string; toIso: string } {
  const now = new Date();
  const toIso = endOfDayIso(now);
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { fromIso: startOfDayIso(start), toIso };
  }
  const days = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { fromIso: startOfDayIso(from), toIso };
}

function typeTone(type: string) {
  if (type === "FEATURE") return "feature";
  if (type === "ENHANCEMENT") return "enhance";
  if (type === "BUG") return "bug";
  return "other";
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatCommitWhen(iso: string) {
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

function downloadJson(doc: ReleaseDoc, slug: string) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-release-notes.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReleaseMaker() {
  const projects = useQuery(api.projects.list);

  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState("");
  const [preset, setPreset] = useState<PresetId>("14d");
  const [fromIso, setFromIso] = useState(() => resolvePreset("14d").fromIso);
  const [toIso, setToIso] = useState(() => resolvePreset("14d").toIso);
  const [includeUndated, setIncludeUndated] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedCommitIds, setSelectedCommitIds] = useState<Set<string>>(
    new Set(),
  );
  const [version, setVersion] = useState("");
  const [author, setAuthor] = useState("Nizek Product");
  const [notes, setNotes] = useState("");
  const [breakingText, setBreakingText] = useState("");
  const [support, setSupport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [doc, setDoc] = useState<ReleaseDoc | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [mode, setMode] = useState<"ai" | "structured">("ai");
  const [fillingMeta, setFillingMeta] = useState(false);
  const [versionSource, setVersionSource] = useState<string | null>(null);

  const suggestMeta = useAction(api.releaseActions.suggestMeta);
  const readProjectVersion = useAction(api.releaseActions.readProjectVersion);

  const project = useMemo(
    () => projects?.find((p) => p.nizekId === projectId) ?? null,
    [projects, projectId],
  );

  const release = useQuery(
    api.tasks.listForRelease,
    projectId && fromIso && toIso
      ? { projectId, fromIso, toIso, includeUndated }
      : "skip",
  );

  useEffect(() => {
    if (!release) return;
    setSelectedTaskIds(new Set(release.tasks.map((t) => t.nizekId)));
    setSelectedCommitIds(new Set(release.commits.map((c) => c._id)));
  }, [release]);

  useEffect(() => {
    if (preset === "custom") return;
    const next = resolvePreset(preset);
    setFromIso(next.fromIso);
    setToIso(next.toIso);
  }, [preset]);

  const selectedTasks: ReleaseTask[] = useMemo(() => {
    if (!release) return [];
    return release.tasks.filter((t) => selectedTaskIds.has(t.nizekId));
  }, [release, selectedTaskIds]);

  const selectedCommits: ReleaseCommit[] = useMemo(() => {
    if (!release) return [];
    return release.commits.filter((c) => selectedCommitIds.has(c._id));
  }, [release, selectedCommitIds]);

  const counts = useMemo(() => {
    return {
      tasksTotal: release?.tasks.length ?? 0,
      commitsTotal: release?.commits.length ?? 0,
      tasksSelected: selectedTasks.length,
      commitsSelected: selectedCommits.length,
      features: selectedTasks.filter((t) => t.taskType === "FEATURE").length,
      fixes: selectedTasks.filter((t) => t.taskType === "BUG").length,
      enhance: selectedTasks.filter((t) => t.taskType === "ENHANCEMENT").length,
      matchedCommits: selectedCommits.filter((c) => c.matchedTasks.length > 0)
        .length,
    };
  }, [release, selectedTasks, selectedCommits]);

  function toggleTask(id: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCommit(id: string) {
    setSelectedCommitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(on: boolean) {
    if (!release) return;
    setSelectedTaskIds(on ? new Set(release.tasks.map((t) => t.nizekId)) : new Set());
    setSelectedCommitIds(
      on ? new Set(release.commits.map((c) => c._id)) : new Set(),
    );
  }

  function metaForGenerate() {
    const breaking = breakingText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      projectName: project?.name ?? "Project",
      version: version.trim() || "1.0.0",
      author: author.trim() || "Nizek Product",
      fromIso,
      toIso,
      notes: notes.trim() || undefined,
      breaking,
      support: support.trim() || undefined,
    };
  }

  async function runGenerate() {
    if (!project || (selectedTasks.length === 0 && selectedCommits.length === 0)) {
      setError("Select at least one task or main commit.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    const meta = metaForGenerate();
    const nextBrief = buildReleaseBrief(selectedTasks, selectedCommits, meta);
    setBrief(nextBrief);

    try {
      if (mode === "structured") {
        const structured = buildReleaseDoc(selectedTasks, selectedCommits, meta);
        setDoc(structured);
        setStatus("Structured release notes ready.");
        return;
      }
      const generated = await generateViaDocsApi({
        docsUrl: DOCS_URL,
        brief: nextBrief,
        projectHint: meta.projectName,
        authorHint: meta.author,
      });
      setDoc(generated);
      setStatus("Generated via Nizek Docs.");
    } catch (err) {
      const structured = buildReleaseDoc(selectedTasks, selectedCommits, meta);
      setDoc(structured);
      setMode("structured");
      setError(
        err instanceof Error
          ? `${err.message} — fell back to structured notes.`
          : "Docs API unavailable — fell back to structured notes.",
      );
      setStatus("Structured release notes ready.");
    } finally {
      setBusy(false);
    }
  }

  function openInDocs() {
    if (!doc) return;
    window.open(docsImportUrl(DOCS_URL, doc), "_blank", "noopener,noreferrer");
  }

  async function copyJson() {
    if (!doc) return;
    await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    setStatus("JSON copied.");
  }

  async function copyBrief() {
    if (!brief) return;
    await navigator.clipboard.writeText(brief);
    setStatus("Brief copied.");
  }

  const hasSelection =
    selectedTasks.length > 0 || selectedCommits.length > 0;

  const canNext =
    step === 1
      ? Boolean(projectId)
      : step === 2
        ? Boolean(fromIso && toIso && Date.parse(fromIso) <= Date.parse(toIso))
        : step === 3
          ? hasSelection
          : true;

  return (
    <div className="app release-app">
      <div className="atmosphere" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <AppHeader />

      <section className="release-hero glass">
        <div>
          <p className="release-eyebrow">Wizard</p>
          <h1>Ship a release note</h1>
          <p>
            Built from finished tasks and commits that landed on{" "}
            <code>main</code>, then shaped into a Nizek Docs release note.
          </p>
        </div>
        <ol className="release-steps" aria-label="Steps">
          {STEPS.map((s) => (
            <li key={s.id} data-active={step === s.id} data-done={step > s.id}>
              <button
                type="button"
                onClick={() => {
                  if (s.id <= step) setStep(s.id);
                }}
              >
                <span className="release-step-num">{s.id}</span>
                <span className="release-step-copy">
                  <strong>{s.label}</strong>
                  <em>{s.hint}</em>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <div className="status-row">
        {project ? (
          <span
            className="pill soft"
            style={{ ["--pc" as string]: project.color }}
          >
            <i className="project-dot" />
            {project.name}
          </span>
        ) : (
          <span className="pill">No project yet</span>
        )}
        <span className="pill">{formatRangeLabel(fromIso, toIso)}</span>
        <span className="pill">{counts.tasksSelected} tasks</span>
        <span className="pill soft">{counts.commitsSelected} on main</span>
        {version.trim() ? (
          <span className="pill soft">v{version.trim()}</span>
        ) : null}
      </div>

      <section className="release-panel glass-strong" data-step={step}>
        {step === 1 ? (
          <>
            <header className="release-panel-head">
              <h2>Select project</h2>
              <p>One project per release note.</p>
            </header>
            {!projects ? (
              <p className="loading">Loading projects…</p>
            ) : projects.length === 0 ? (
              <p className="hint">No projects synced yet. Run sync from Admin.</p>
            ) : (
              <div className="release-project-grid">
                {projects.map((p) => (
                  <button
                    key={p.nizekId}
                    type="button"
                    className="release-project-card"
                    data-on={projectId === p.nizekId}
                    style={{ ["--pc" as string]: p.color }}
                    onClick={() => {
                      setProjectId(p.nizekId);
                      setDoc(null);
                      setBrief(null);
                      setVersionSource(null);
                      void (async () => {
                        try {
                          const vr = await readProjectVersion({
                            projectId: p.nizekId,
                          });
                          if (vr.ok) {
                            setVersion(vr.version);
                            setVersionSource(vr.source);
                            return;
                          }
                        } catch {
                          // fall through to calendar stub
                        }
                        if (!version.trim()) {
                          const stamp = new Date();
                          setVersion(
                            `${stamp.getFullYear()}.${stamp.getMonth() + 1}.0`,
                          );
                        }
                      })();
                    }}
                  >
                    <span className="release-project-swatch" />
                    <strong>{p.name}</strong>
                    <em>
                      {p.teamName ? `${p.teamName} · ` : ""}
                      {p.taskCount} tasks
                    </em>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <header className="release-panel-head">
              <h2>Release window</h2>
              <p>
                Pulls finished tasks in this range, plus commits on{" "}
                <code>main</code> / <code>master</code> authored in the same
                window (from linked repos).
              </p>
            </header>
            <div className="release-presets">
              {(
                [
                  ["7d", "Last 7 days"],
                  ["14d", "Last 14 days"],
                  ["30d", "Last 30 days"],
                  ["month", "This month"],
                  ["custom", "Custom"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  data-on={preset === id}
                  onClick={() => setPreset(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="release-date-row">
              <label>
                From
                <input
                  type="date"
                  value={toDateInput(fromIso)}
                  onChange={(e) => {
                    setPreset("custom");
                    setFromIso(fromDateInput(e.target.value, false));
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={toDateInput(toIso)}
                  onChange={(e) => {
                    setPreset("custom");
                    setToIso(fromDateInput(e.target.value, true));
                  }}
                />
              </label>
              <label className="release-check">
                <input
                  type="checkbox"
                  checked={includeUndated}
                  onChange={(e) => setIncludeUndated(e.target.checked)}
                />
                Include finished tasks with no date
              </label>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <header className="release-panel-head">
              <div>
                <h2>Curate tasks &amp; main commits</h2>
                <p>
                  {release === undefined
                    ? "Loading…"
                    : `${counts.tasksTotal} tasks · ${counts.commitsTotal} commits on main · ${counts.tasksSelected + counts.commitsSelected} selected`}
                </p>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="tiny"
                  onClick={() => selectAll(true)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => selectAll(false)}
                >
                  None
                </button>
              </div>
            </header>

            <div className="release-kpi">
              <span>
                <strong>{counts.features}</strong> New
              </span>
              <span>
                <strong>{counts.enhance}</strong> Improvements
              </span>
              <span>
                <strong>{counts.fixes}</strong> Fixes
              </span>
              <span>
                <strong>{counts.commitsSelected}</strong> Main
              </span>
              <span>
                <strong>{counts.matchedCommits}</strong> Matched
              </span>
            </div>

            {release === undefined ? (
              <p className="loading">Scanning tasks &amp; main…</p>
            ) : (
              <div className="release-split">
                <div>
                  <h3 className="release-section-title">Tasks</h3>
                  {release.tasks.length === 0 ? (
                    <p className="hint">
                      No finished tasks in window (matched main commits still
                      pull linked tasks in).
                    </p>
                  ) : (
                    <ul className="release-task-list">
                      {release.tasks.map((t) => {
                        const on = selectedTaskIds.has(t.nizekId);
                        return (
                          <li key={t.nizekId} data-on={on}>
                            <button
                              type="button"
                              onClick={() => toggleTask(t.nizekId)}
                            >
                              <span
                                className="release-type"
                                data-tone={typeTone(t.taskType)}
                              >
                                {taskCode(t.taskType, t.taskNumber)}
                              </span>
                              <span className="release-task-copy">
                                <strong>{t.title}</strong>
                                <em>
                                  {t.viaMainCommit ? "via main · " : ""}
                                  {t.stage.replaceAll("_", " ")}
                                  {t.assigneeName
                                    ? ` · ${t.assigneeName}`
                                    : ""}
                                </em>
                              </span>
                              <span className="release-check-mark" aria-hidden>
                                {on ? "✓" : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="release-section-title">Commits on main</h3>
                  {release.commits.length === 0 ? (
                    <p className="hint">
                      No main commits in this window for linked repos. Sync
                      commits from Admin if needed.
                    </p>
                  ) : (
                    <ul className="release-task-list release-commit-list">
                      {release.commits.map((c) => {
                        const on = selectedCommitIds.has(c._id);
                        const match = c.matchedTasks[0];
                        return (
                          <li key={c._id} data-on={on}>
                            <button
                              type="button"
                              onClick={() => toggleCommit(c._id)}
                            >
                              <span className="release-type" data-tone="commit">
                                {shortSha(c.sha)}
                              </span>
                              <span className="release-task-copy">
                                <strong>{c.subject}</strong>
                                <em>
                                  {c.repoFullName} · {c.authorName} ·{" "}
                                  {formatCommitWhen(c.authoredAt)}
                                  {match
                                    ? ` · ${match.status} ${match.taskCode ?? ""}`
                                    : " · unmatched"}
                                </em>
                              </span>
                              <span className="release-check-mark" aria-hidden>
                                {on ? "✓" : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="release-meta-head">
              <div>
                <h3 className="release-section-title">Release meta</h3>
                <p className="hint">
                  AI drafts these from selected tasks and commits on main —
                  edit freely.
                </p>
              </div>
              <button
                type="button"
                className="primary"
                disabled={!hasSelection || !project || fillingMeta}
                onClick={() => {
                  if (!project) return;
                  void (async () => {
                    setFillingMeta(true);
                    setError(null);
                    setStatus(null);
                    try {
                      const result = await suggestMeta({
                        projectId: project.nizekId,
                        projectName: project.name,
                        fromIso,
                        toIso,
                        currentVersion: version.trim() || undefined,
                        currentAuthor: author.trim() || undefined,
                        tasks: selectedTasks.map((t) => ({
                          code: taskCode(t.taskType, t.taskNumber),
                          title: t.title,
                          taskType: t.taskType,
                          stage: t.stage,
                          description: t.description ?? null,
                          assigneeName: t.assigneeName ?? null,
                          viaMainCommit: Boolean(t.viaMainCommit),
                        })),
                        commits: selectedCommits.map((c) => ({
                          sha: c.sha,
                          subject: c.subject,
                          message: c.message,
                          authorName: c.authorName,
                          authoredAt: c.authoredAt,
                          repoFullName: c.repoFullName,
                          matched: c.matchedTasks[0]
                            ? `${c.matchedTasks[0].status} ${c.matchedTasks[0].taskCode ?? ""} ${c.matchedTasks[0].taskTitle ?? ""}`.trim()
                            : undefined,
                        })),
                      });

                      if (result.ok) {
                        setVersion(result.version);
                        setVersionSource(result.versionSource);
                        setAuthor(result.author);
                        setNotes(result.notes);
                        setBreakingText(result.breaking.join("\n"));
                        setSupport(result.support);
                        const verBit = result.versionSource
                          ? ` · version from ${result.versionSource}`
                          : "";
                        setStatus(
                          result.breaking.length
                            ? `AI filled meta (breaking signals noted)${verBit}.`
                            : `AI filled meta from tasks + main commits${verBit}.`,
                        );
                        return;
                      }

                      let repoVer: string | null = null;
                      let repoSrc: string | null = null;
                      try {
                        const vr = await readProjectVersion({
                          projectId: project.nizekId,
                        });
                        if (vr.ok) {
                          repoVer = vr.version;
                          repoSrc = vr.source;
                        }
                      } catch {
                        // ignore
                      }

                      const draft = suggestReleaseMeta({
                        projectName: project.name,
                        tasks: selectedTasks,
                        commits: selectedCommits,
                        fromIso,
                        toIso,
                        currentAuthor: author,
                      });
                      setVersion(repoVer ?? draft.version);
                      setVersionSource(repoSrc);
                      setAuthor(draft.author);
                      setNotes(draft.notes);
                      setBreakingText(draft.breakingText);
                      setSupport(draft.support);
                      setError(
                        `${result.error} — used local heuristic draft instead.`,
                      );
                      setStatus(
                        repoSrc
                          ? `Filled with local draft · version from ${repoSrc}.`
                          : "Filled with local heuristic draft.",
                      );
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "AI fill failed.",
                      );
                    } finally {
                      setFillingMeta(false);
                    }
                  })();
                }}
              >
                {fillingMeta ? "Asking AI…" : "Fill with AI"}
              </button>
            </div>

            {error && step === 3 ? (
              <p className="release-banner err">{error}</p>
            ) : null}
            {status && step === 3 ? (
              <p className="release-banner ok">{status}</p>
            ) : null}

            <div className="release-meta-grid">
              <label>
                Version
                <span className="release-version-row">
                  <input
                    value={version}
                    onChange={(e) => {
                      setVersion(e.target.value);
                      setVersionSource(null);
                    }}
                    placeholder="1.2.0"
                  />
                  <button
                    type="button"
                    className="tiny"
                    disabled={!projectId || fillingMeta}
                    title="Read version from linked repo (package.json, etc.)"
                    onClick={() => {
                      if (!projectId) return;
                      void (async () => {
                        setFillingMeta(true);
                        setError(null);
                        try {
                          const vr = await readProjectVersion({ projectId });
                          if (vr.ok) {
                            setVersion(vr.version);
                            setVersionSource(vr.source);
                            setStatus(`Version from ${vr.source}`);
                          } else {
                            setError(vr.error);
                          }
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Could not read repo version.",
                          );
                        } finally {
                          setFillingMeta(false);
                        }
                      })();
                    }}
                  >
                    From repo
                  </button>
                </span>
                {versionSource ? (
                  <em className="release-version-source">{versionSource}</em>
                ) : null}
              </label>
              <label>
                Author
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Nizek Product"
                />
              </label>
              <label className="release-span-2">
                Highlights / context
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional narrative for the Highlights paragraph…"
                />
              </label>
              <label className="release-span-2">
                Breaking changes (one per line)
                <textarea
                  rows={2}
                  value={breakingText}
                  onChange={(e) => setBreakingText(e.target.value)}
                  placeholder="Clients must…"
                />
              </label>
              <label className="release-span-2">
                Support callout
                <input
                  value={support}
                  onChange={(e) => setSupport(e.target.value)}
                  placeholder="Questions: #project-channel"
                />
              </label>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <header className="release-panel-head">
              <div>
                <h2>Generate release notes</h2>
                <p>
                  Uses the Nizek Docs builder ({DOCS_URL}) with kind{" "}
                  <code>release-notes</code>.
                </p>
              </div>
            </header>

            <div className="release-mode-row">
              <button
                type="button"
                className="chip"
                data-on={mode === "ai"}
                onClick={() => setMode("ai")}
              >
                Docs AI
              </button>
              <button
                type="button"
                className="chip"
                data-on={mode === "structured"}
                onClick={() => setMode("structured")}
              >
                Structured (no AI)
              </button>
            </div>

            <div className="release-summary glass">
              <p>
                <strong>{project?.name}</strong> · v
                {version.trim() || "1.0.0"} · {counts.tasksSelected} tasks ·{" "}
                {counts.commitsSelected} main commits ·{" "}
                {formatRangeLabel(fromIso, toIso)}
              </p>
              <p className="hint">
                {counts.features} new · {counts.enhance} improvements ·{" "}
                {counts.fixes} fixes · {counts.matchedCommits} matched commits
              </p>
            </div>

            <div className="row release-generate-actions">
              <button
                type="button"
                className="primary solid"
                disabled={busy || !hasSelection}
                onClick={() => void runGenerate()}
              >
                {busy ? "Generating…" : "Generate release note"}
              </button>
              {doc ? (
                <>
                  <button type="button" className="primary" onClick={openInDocs}>
                    Open in Docs
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      downloadJson(
                        doc,
                        (project?.name ?? "release")
                          .toLowerCase()
                          .replace(/\s+/g, "-"),
                      )
                    }
                  >
                    Download JSON
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void copyJson()}
                  >
                    Copy JSON
                  </button>
                  {brief ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void copyBrief()}
                    >
                      Copy brief
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>

            {error ? <p className="release-banner err">{error}</p> : null}
            {status ? <p className="release-banner ok">{status}</p> : null}

            {doc ? (
              <article className="release-doc-preview">
                <header>
                  <p className="release-eyebrow">{doc.cover.eyebrow}</p>
                  <h3>{doc.cover.headline ?? doc.meta.title}</h3>
                  <p>{doc.meta.subtitle}</p>
                  <p className="hint">
                    {doc.meta.project} · v{doc.meta.version} · {doc.meta.date} ·{" "}
                    {doc.meta.author}
                  </p>
                </header>
                <div className="release-doc-sections">
                  {doc.sections.map((section, i) => {
                    const type = String(section.type ?? "");
                    const title =
                      typeof section.title === "string" ? section.title : null;
                    if (type === "paragraph") {
                      return (
                        <section key={i}>
                          {title ? <h4>{title}</h4> : null}
                          <p>{String(section.body ?? "")}</p>
                        </section>
                      );
                    }
                    if (type === "list") {
                      const items = Array.isArray(section.items)
                        ? (section.items as string[])
                        : [];
                      return (
                        <section key={i}>
                          {title ? <h4>{title}</h4> : null}
                          <ul>
                            {items.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      );
                    }
                    if (type === "callout") {
                      return (
                        <section key={i} className="release-callout">
                          {title ? <h4>{title}</h4> : null}
                          <p>{String(section.body ?? "")}</p>
                        </section>
                      );
                    }
                    return null;
                  })}
                </div>
              </article>
            ) : (
              <p className="hint">
                Generate to preview. Open in Docs to print / save PDF with the
                full Nizek chrome.
              </p>
            )}
          </>
        ) : null}

        <footer className="release-nav">
          <button
            type="button"
            className="ghost"
            disabled={step === 1}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          >
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              className="primary solid"
              disabled={!canNext}
              onClick={() => setStep((s) => (s < 4 ? ((s + 1) as Step) : s))}
            >
              Continue
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
