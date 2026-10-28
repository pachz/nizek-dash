import { formatHours, taskCode, type StageKey, BOARD_COLUMNS } from "../lib/stages";

export type BoardTask = {
  _id: string;
  nizekId: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  title: string;
  taskNumber: number;
  taskType: string;
  stage: string;
  priority: string;
  estimatedMinutes?: number | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  sprintName?: string | null;
  sprintStatus?: string | null;
};

const priorityClass: Record<string, string> = {
  VERY_HIGH: "prio-vh",
  HIGH: "prio-h",
  NORMAL: "prio-n",
  LOW: "prio-l",
  VERY_LOW: "prio-vl",
};

export function Kanban({
  tasks,
  stages,
}: {
  tasks: BoardTask[];
  stages: StageKey[];
}) {
  const cols = BOARD_COLUMNS.filter((c) => stages.includes(c.key));

  return (
    <div className="board" style={{ ["--cols" as string]: cols.length }}>
      {cols.map((col) => {
        const items = tasks.filter((t) => t.stage === col.key);
        return (
          <section key={col.key} className="column" style={{ ["--tone" as string]: col.tone }}>
            <header className="column-head">
              <div>
                <h2>{col.label}</h2>
                <p>{items.length} tasks</p>
              </div>
              <span className="column-dot" />
            </header>
            <div className="column-body">
              {items.length === 0 ? (
                <div className="empty-col">No tasks</div>
              ) : (
                items.map((task, i) => (
                  <article
                    key={task._id}
                    className="card"
                    style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                  >
                    <div className="card-top">
                      <span
                        className="project-chip"
                        style={{ ["--pc" as string]: task.projectColor }}
                      >
                        {task.projectName}
                      </span>
                      <span className={`prio ${priorityClass[task.priority] ?? "prio-n"}`}>
                        {task.priority.replace("_", " ")}
                      </span>
                    </div>
                    <div className="card-code">
                      {taskCode(task.taskType, task.taskNumber)}
                    </div>
                    <h3>{task.title}</h3>
                    <footer className="card-foot">
                      <div className="assignee">
                        {task.assigneeImage ? (
                          <img src={task.assigneeImage} alt="" />
                        ) : (
                          <span className="avatar-fallback">
                            {(task.assigneeName ?? "?").slice(0, 1)}
                          </span>
                        )}
                        <span>{task.assigneeName ?? "Unassigned"}</span>
                      </div>
                      <div className="meta">
                        {task.sprintName ? <span>{task.sprintName}</span> : null}
                        {formatHours(task.estimatedMinutes) ? (
                          <span>{formatHours(task.estimatedMinutes)}</span>
                        ) : null}
                      </div>
                    </footer>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
