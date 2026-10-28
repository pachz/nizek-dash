import { useEffect, useEffectEvent, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { buildTaskPrompt } from "../lib/prompt";
import {
  formatHours,
  formatWhen,
  stageLabel,
  taskCode,
} from "../lib/stages";

type Extras = {
  questions: Array<{ question: string; answer: string }>;
  attachments: Array<{ name: string; url: string }>;
  comments: Array<{
    author: string;
    body: string;
    at?: string | null;
    imageUrl?: string | null;
  }>;
  proofOfWork: Array<{
    name: string;
    url?: string | null;
    author?: string | null;
    at?: string | null;
  }>;
  activity: Array<{
    action: string;
    author: string;
    summary: string;
    at?: string | null;
  }>;
};

const emptyExtras: Extras = {
  questions: [],
  attachments: [],
  comments: [],
  proofOfWork: [],
  activity: [],
};

const priorityClass: Record<string, string> = {
  VERY_HIGH: "prio-vh",
  HIGH: "prio-h",
  NORMAL: "prio-n",
  LOW: "prio-l",
  VERY_LOW: "prio-vl",
};

function isImage(url: string) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

export function TaskDetail({
  nizekId,
  onClose,
}: {
  nizekId: string;
  onClose: () => void;
}) {
  const task = useQuery(api.tasks.get, { nizekId });
  const fetchDetail = useAction(api.nizekActions.fetchTaskDetail);
  const [extras, setExtras] = useState<Extras>(emptyExtras);
  const [enriching, setEnriching] = useState(true);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enrich = useEffectEvent(async (id: string) => {
    setEnriching(true);
    setEnrichNote(null);
    try {
      const r = await fetchDetail({ nizekId: id });
      if (!r.ok) {
        setEnrichNote(r.error);
        return;
      }
      setExtras({
        questions: r.questions,
        attachments: r.attachments,
        comments: r.comments,
        proofOfWork: r.proofOfWork,
        activity: r.activity,
      });
      if (!r.refreshed) {
        const hasCached =
          r.questions.length +
            r.attachments.length +
            r.comments.length +
            r.proofOfWork.length >
          0;
        setEnrichNote(
          hasCached
            ? "Showing cached Panel details — paste a Session cookie to refresh live."
            : "Paste a Session cookie to pull Questions, Attachments, and Comments from Panel.",
        );
      }
    } catch (e) {
      setEnrichNote(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(false);
    }
  });

  useEffect(() => {
    const cached = (task as { extras?: Extras | null } | undefined)?.extras;
    if (!cached) return;
    setExtras({
      questions: cached.questions ?? [],
      attachments: cached.attachments ?? [],
      comments: cached.comments ?? [],
      proofOfWork: cached.proofOfWork ?? [],
      activity: cached.activity ?? [],
    });
  }, [task]);

  useEffect(() => {
    void enrich(nizekId);
  }, [nizekId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function copyPrompt() {
    if (!task) return;
    const text = buildTaskPrompt({
      ...task,
      ...extras,
    });
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="sheet-root" role="dialog" aria-modal="true">
      <button
        type="button"
        className="sheet-backdrop"
        aria-label="Close task details"
        onClick={onClose}
      />
      <aside className="sheet glass-strong">
        <header className="sheet-head">
          <div className="sheet-head-copy">
            {task ? (
              <>
                <div className="sheet-kicker">
                  <span
                    className="project-chip"
                    style={{ ["--pc" as string]: task.projectColor }}
                  >
                    {task.projectName}
                  </span>
                  <span className="card-code">
                    {taskCode(task.taskType, task.taskNumber)}
                  </span>
                  {enriching ? (
                    <span className="pill soft">Refreshing…</span>
                  ) : null}
                </div>
                <h2>{task.title}</h2>
              </>
            ) : (
              <h2>Loading task…</h2>
            )}
          </div>
          <button type="button" className="ghost sheet-close" onClick={onClose}>
            Close
          </button>
        </header>

        {task ? (
          <div className="sheet-body">
            <div className="sheet-actions">
              <button
                type="button"
                className="primary solid"
                onClick={() => void copyPrompt()}
              >
                {copied ? "Copied" : "Copy prompt"}
              </button>
              {task.panelUrl ? (
                <a
                  className="ghost link-btn"
                  href={task.panelUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Panel
                </a>
              ) : null}
            </div>

            <dl className="detail-grid">
              <div>
                <dt>Stage</dt>
                <dd>{stageLabel(task.stage)}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd className={priorityClass[task.priority] ?? "prio-n"}>
                  {task.priority.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{task.taskType}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>{formatHours(task.estimatedMinutes) ?? "—"}</dd>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>
                  <span className="assignee">
                    {task.assigneeImage ? (
                      <img src={task.assigneeImage} alt="" />
                    ) : (
                      <span className="avatar-fallback">
                        {(task.assigneeName ?? "?").slice(0, 1)}
                      </span>
                    )}
                    <span>{task.assigneeName ?? "Unassigned"}</span>
                  </span>
                </dd>
              </div>
              <div>
                <dt>Team</dt>
                <dd>{task.teamName ?? "—"}</dd>
              </div>
              <div>
                <dt>Sprint</dt>
                <dd>
                  {task.sprintName
                    ? `${task.sprintName}${task.sprintStatus ? ` · ${task.sprintStatus}` : ""}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatWhen(task.startedAt) ?? "—"}</dd>
              </div>
              <div>
                <dt>Stage entered</dt>
                <dd>{formatWhen(task.stageEnteredAt) ?? "—"}</dd>
              </div>
            </dl>

            {extras.questions.length ? (
              <section className="detail-block">
                <h3>Questions</h3>
                <div className="qa-list">
                  {extras.questions.map((q) => (
                    <article key={q.question} className="qa-item">
                      <h4>{q.question}</h4>
                      <pre className="detail-prose">{q.answer}</pre>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <section className="detail-block">
                <h3>Description</h3>
                {task.description?.trim() ? (
                  <pre className="detail-prose">{task.description}</pre>
                ) : (
                  <p className="hint">
                    No description on this task
                    {enriching ? " — checking Panel…" : "."}
                  </p>
                )}
              </section>
            )}

            {extras.attachments.length ? (
              <section className="detail-block">
                <h3>Attachments</h3>
                <div className="attach-grid">
                  {extras.attachments.map((a) => (
                    <a
                      key={a.url}
                      className="attach-card"
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      title={a.name}
                    >
                      {isImage(a.url) ? (
                        <img src={a.url} alt={a.name} loading="lazy" />
                      ) : (
                        <div className="attach-file">{a.name}</div>
                      )}
                      <span className="attach-name">{a.name}</span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            {extras.proofOfWork.length ? (
              <section className="detail-block">
                <h3>Proof of work</h3>
                <ul className="comment-list">
                  {extras.proofOfWork.map((p) => (
                    <li key={p.name}>
                      <strong>{p.author ?? "Uploader"}</strong>
                      {p.at ? (
                        <span className="hint"> · {formatWhen(p.at)}</span>
                      ) : null}
                      <p>{p.name}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {extras.comments.length ? (
              <section className="detail-block">
                <h3>Comments</h3>
                <ul className="comment-list">
                  {extras.comments.map((c, i) => (
                    <li key={`${c.author}-${i}`}>
                      <div className="comment-head">
                        {c.imageUrl ? (
                          <img
                            className="comment-avatar"
                            src={c.imageUrl}
                            alt=""
                          />
                        ) : (
                          <span className="avatar-fallback">
                            {c.author.slice(0, 1)}
                          </span>
                        )}
                        <strong>{c.author}</strong>
                        {c.at ? (
                          <span className="hint"> · {formatWhen(c.at)}</span>
                        ) : null}
                      </div>
                      <p>{c.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {extras.activity.length ? (
              <section className="detail-block">
                <h3>Activity</h3>
                <ul className="activity-list">
                  {extras.activity.slice(0, 20).map((a, i) => (
                    <li key={`${a.summary}-${i}`}>
                      <strong>{a.author}</strong>
                      <span>{a.summary}</span>
                      {a.at ? (
                        <span className="hint">{formatWhen(a.at)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {enrichNote ? <p className="hint sheet-note">{enrichNote}</p> : null}
          </div>
        ) : (
          <div className="sheet-body">
            <p className="hint">Loading…</p>
          </div>
        )}
      </aside>
    </div>
  );
}
