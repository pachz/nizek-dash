import { formatHours, formatWhen, stageLabel, taskCode } from "./stages";

export type PromptTask = {
  nizekId: string;
  projectId: string;
  projectName: string;
  teamName?: string | null;
  title: string;
  description?: string | null;
  taskNumber: number;
  taskType: string;
  stage: string;
  priority: string;
  estimatedMinutes?: number | null;
  assigneeName?: string | null;
  sprintName?: string | null;
  sprintStatus?: string | null;
  stageEnteredAt?: string | null;
  startedAt?: string | null;
  panelUrl?: string | null;
  questions?: Array<{ question: string; answer: string }>;
  attachments?: Array<{ name: string; url: string }>;
  comments?: Array<{ author: string; body: string; at?: string | null }>;
  proofOfWork?: Array<{ name: string; author?: string | null }>;
  activity?: Array<{ author: string; summary: string; at?: string | null }>;
};

export function buildTaskPrompt(task: PromptTask): string {
  const code = taskCode(task.taskType, task.taskNumber);
  const estimate = formatHours(task.estimatedMinutes);
  const lines: string[] = [
    `# Nizek task ${code}`,
    "",
    `Title: ${task.title}`,
    `Project: ${task.projectName}${task.teamName ? ` (${task.teamName})` : ""}`,
    `Type: ${task.taskType}`,
    `Priority: ${task.priority.replaceAll("_", " ")}`,
    `Stage: ${stageLabel(task.stage)}`,
    `Assignee: ${task.assigneeName ?? "Unassigned"}`,
  ];

  if (estimate) lines.push(`Estimate: ${estimate}`);
  if (task.sprintName) {
    lines.push(
      `Sprint: ${task.sprintName}${task.sprintStatus ? ` · ${task.sprintStatus}` : ""}`,
    );
  }
  if (task.startedAt) lines.push(`Started: ${formatWhen(task.startedAt)}`);
  if (task.stageEnteredAt) {
    lines.push(`Stage entered: ${formatWhen(task.stageEnteredAt)}`);
  }
  if (task.panelUrl) lines.push(`Panel: ${task.panelUrl}`);
  lines.push(`Task ID: ${task.nizekId}`);

  if (task.questions?.length) {
    lines.push("", "## Questions");
    for (const q of task.questions) {
      lines.push("", `### ${q.question}`, q.answer);
    }
  } else {
    lines.push("", "## Description");
    lines.push(
      task.description?.trim()
        ? task.description.trim()
        : "_No description provided in Nizek._",
    );
  }

  if (task.attachments?.length) {
    lines.push("", "## Attachments");
    for (const a of task.attachments) {
      lines.push(`- ${a.name}: ${a.url}`);
    }
  }

  if (task.proofOfWork?.length) {
    lines.push("", "## Proof of work");
    for (const p of task.proofOfWork) {
      lines.push(`- ${p.name}${p.author ? ` (by ${p.author})` : ""}`);
    }
  }

  if (task.comments?.length) {
    lines.push("", "## Comments");
    for (const c of task.comments) {
      const when = c.at ? ` (${formatWhen(c.at)})` : "";
      lines.push(`- ${c.author}${when}: ${c.body}`);
    }
  }

  if (task.activity?.length) {
    lines.push("", "## Recent activity");
    for (const a of task.activity.slice(0, 12)) {
      const when = a.at ? ` (${formatWhen(a.at)})` : "";
      lines.push(`- ${a.author}${when}: ${a.summary}`);
    }
  }

  lines.push(
    "",
    "## Ask",
    "Please help with this task end-to-end: clarify intent, propose a plan, then implement or diagnose as appropriate. Call out assumptions, risks, and test steps.",
  );

  return lines.join("\n");
}
