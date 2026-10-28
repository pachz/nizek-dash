/** Deep-unescape Next.js RSC flight string payloads from panel.nizek.com */
export function deepUnescape(s: string): string {
  let cur = s;
  for (let i = 0; i < 12; i++) {
    const next = cur
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

export type ParsedTask = {
  id: string;
  title: string;
  description: string | null;
  taskNumber: number;
  taskType: string;
  stage: string;
  order: number;
  priority: string;
  estimatedMinutes: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  projectId: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintStatus: string | null;
  stageEnteredAt: string | null;
  startedAt: string | null;
};

export function extractTasks(str: string, forceProjectId?: string): ParsedTask[] {
  const out: ParsedTask[] = [];
  let i = 0;
  while (out.length < 800 && i < str.length) {
    const start = str.indexOf('{"id":"cm', i);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let j = start; j < Math.min(str.length, start + 300000); j++) {
      const ch = str[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) {
      i = start + 1;
      continue;
    }
    const slice = str.slice(start, end);
    i = end;
    if (!slice.includes('"taskNumber":')) continue;
    try {
      const obj = JSON.parse(slice) as Record<string, unknown>;
      const assignee = obj.assignee as
        | { name?: string; imageUrl?: string }
        | undefined;
      const sprint = obj.sprint as
        | { name?: string; status?: string }
        | undefined;
      out.push({
        id: String(obj.id),
        title: String(obj.title ?? ""),
        description: (obj.description as string | null) ?? null,
        taskNumber: Number(obj.taskNumber ?? 0),
        taskType: String(obj.taskType ?? "FEATURE"),
        stage: String(obj.stage ?? "TODO"),
        order: Number(obj.order ?? 0),
        priority: String(obj.priority ?? "NORMAL"),
        estimatedMinutes: (obj.estimatedMinutes as number | null) ?? null,
        assigneeId: (obj.assigneeId as string | null) ?? null,
        assigneeName: assignee?.name ?? null,
        assigneeImage: assignee?.imageUrl ?? null,
        projectId: forceProjectId ?? String(obj.projectId ?? ""),
        sprintId: (obj.sprintId as string | null) ?? null,
        sprintName: sprint?.name ?? (obj.sprintName as string | null) ?? null,
        sprintStatus: sprint?.status ?? null,
        stageEnteredAt: (obj.stageEnteredAt as string | null) ?? null,
        startedAt: (obj.startedAt as string | null) ?? null,
      });
    } catch {
      // skip malformed objects
    }
  }
  const map = new Map<string, ParsedTask>();
  for (const t of out) map.set(t.id, t);
  return [...map.values()];
}

export function extractProjectMeta(
  html: string,
  id: string,
): { name: string; teamName: string | null } {
  const un = deepUnescape(html);
  const nameMatch = un.match(new RegExp(`"id":"${id}","name":"([^"]+)"`));
  const teamMatch = un.match(/"team":\{"id":"[^"]+","name":"([^"]+)"\}/);
  return {
    name: nameMatch?.[1] ?? id,
    teamName: teamMatch?.[1] ?? null,
  };
}

const PALETTE = [
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#c026d3",
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#7c3aed",
  "#db2777",
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
