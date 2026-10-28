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

/** Pull project ids/names from /dashboard/projects RSC HTML (not pathname hrefs). */
export function extractProjectsFromList(html: string): Array<{
  id: string;
  name: string;
  teamName: string | null;
}> {
  // Work on lightly unescaped flight text. Match id+name first, then require
  // project-only fields nearby (logoUrl/teamId/sprintsEnabled) so we don't
  // swallow long descriptions into the next object or pick projectRole rows.
  const un = deepUnescape(html);
  const out: Array<{ id: string; name: string; teamName: string | null }> = [];
  const seen = new Set<string>();

  const re = /"id":"(cm[a-z0-9]+)","name":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(un))) {
    const id = m[1]!;
    const name = m[2]!;
    if (seen.has(id) || !name || name.length > 80) continue;

    const window = un.slice(m.index, m.index + 4000);
    const logoAt = window.indexOf('"logoUrl":');
    const teamIdAt = window.indexOf('"teamId":"cm');
    const sprintsAt = window.indexOf('"sprintsEnabled":');
    const isAdminAt = window.indexOf('"isAdmin":');
    // Roles: isAdmin appears before logoUrl (or logoUrl missing).
    if (logoAt < 0 || teamIdAt < 0 || sprintsAt < 0) continue;
    if (isAdminAt >= 0 && isAdminAt < logoAt) continue;

    seen.add(id);
    const team = window.match(/"team":\{"id":"[^"]+","name":"([^"]+)"\}/);
    out.push({ id, name, teamName: team?.[1] ?? null });
  }

  for (const hit of html.matchAll(/\/dashboard\/projects\/(cm[a-z0-9]+)/g)) {
    const id = hit[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: id, teamName: null });
  }

  return out;
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

/** Normalize TipTap JSON / HTML / plain description payloads into readable text. */
export function normalizeDescription(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return normalizeDescription(JSON.parse(trimmed));
      } catch {
        /* fall through */
      }
    }
    const text = trimmed
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text || null;
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map((n) => normalizeDescription(n))
      .filter((s): s is string => Boolean(s));
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof raw === "object") {
    const node = raw as {
      type?: string;
      text?: string;
      content?: unknown[];
      description?: unknown;
    };
    if (typeof node.text === "string" && node.text.trim()) return node.text;
    if (node.content) return normalizeDescription(node.content);
    if ("description" in node) return normalizeDescription(node.description);
  }
  return null;
}

export type TaskAttachment = { name: string; url: string };
export type TaskQA = { question: string; answer: string };
export type TaskComment = {
  author: string;
  body: string;
  at?: string | null;
  imageUrl?: string | null;
};
export type TaskProof = {
  name: string;
  url?: string | null;
  author?: string | null;
  at?: string | null;
};
export type TaskActivity = {
  action: string;
  author: string;
  summary: string;
  at?: string | null;
};

export type TaskDetailExtras = {
  description: string | null;
  title?: string;
  stage?: string;
  priority?: string;
  estimatedMinutes?: number | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  sprintName?: string | null;
  sprintStatus?: string | null;
  stageEnteredAt?: string | null;
  startedAt?: string | null;
  questions: TaskQA[];
  attachments: TaskAttachment[];
  comments: TaskComment[];
  proofOfWork: TaskProof[];
  activity: TaskActivity[];
};

/** Resolve Next.js flight text refs like `$1d` → `1d:T5a6,<text>`. */
export function resolveFlightRef(html: string, ref: string): string | null {
  const id = ref.trim().replace(/^\$/, "");
  if (!id) return null;
  const re = new RegExp(`${id}:T([0-9a-fA-F]+),`);
  const m = re.exec(html);
  if (!m || m.index == null) return null;
  const len = parseInt(m[1]!, 16);
  if (!Number.isFinite(len) || len < 0 || len > 500_000) return null;
  return html.slice(m.index + m[0].length, m.index + m[0].length + len);
}

function decodeJsonStringish(raw: string): string {
  let cur = raw;
  if (
    (cur.startsWith('"') && cur.endsWith('"')) ||
    (cur.startsWith("'") && cur.endsWith("'"))
  ) {
    try {
      return JSON.parse(cur) as string;
    } catch {
      cur = cur.slice(1, -1);
    }
  }
  return cur
    .replace(/\\u0026/g, "&")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function resolveAnswerValue(html: string, raw: string): string {
  const decoded = decodeJsonStringish(raw).trim();
  if (/^\$[0-9a-z]+$/i.test(decoded)) {
    return resolveFlightRef(html, decoded) ?? decoded;
  }
  return decoded;
}

export function parseAttachmentBlob(val: string): TaskAttachment[] {
  const out: TaskAttachment[] = [];
  const seen = new Set<string>();
  for (const part of val.split("|||")) {
    const idx = part.indexOf("::");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const url = part
      .slice(idx + 2)
      .trim()
      .replace(/\\+$/g, "");
    if (!name || !/^https?:\/\//i.test(url)) continue;
    if (url.includes("/branding/") || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out;
}

function extractAttachmentsFromHtml(html: string): TaskAttachment[] {
  const out: TaskAttachment[] = [];
  const seen = new Set<string>();
  const re =
    /([^"|:<>]+?\.(?:png|jpe?g|webp|gif|pdf|mp4|mov|webm))::(https:\/\/pub-[^"|\\\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 60) {
    const name = m[1]!.trim();
    const url = m[2]!.replace(/\\+$/g, "").trim();
    if (url.includes("/branding/") || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out;
}

function extractQuestionCatalog(html: string): Array<{
  id: string;
  question: string;
  taskType: string;
}> {
  const out: Array<{ id: string; question: string; taskType: string }> = [];
  const re =
    /"id":"([^"]+)","question":"((?:\\.|[^"\\])*)","type":"([^"]+)"[\s\S]{0,240}?"taskType":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 80) {
    out.push({
      id: m[1]!,
      question: decodeJsonStringish(`"${m[2]}"`),
      taskType: m[4]!,
    });
  }
  return out;
}

function extractJsonObjectAt(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < html.length && /\s/.test(html[i]!)) i++;
  if (html[i] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const from = i;
  for (; i < html.length; i++) {
    const ch = html[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(from, i + 1);
    }
  }
  return null;
}

function readJsonString(source: string, start: number): { value: string; end: number } | null {
  if (source[start] !== '"') return null;
  let i = start + 1;
  let esc = false;
  let out = "";
  for (; i < source.length; i++) {
    const ch = source[i]!;
    if (esc) {
      if (ch === "n") out += "\n";
      else if (ch === "t") out += "\t";
      else if (ch === "r") out += "\r";
      else if (ch === '"') out += '"';
      else if (ch === "\\") out += "\\";
      else if (ch === "u" && i + 4 < source.length) {
        const hex = source.slice(i + 1, i + 5);
        out += String.fromCharCode(parseInt(hex, 16) || 0);
        i += 4;
      }       else if (ch === "\n" || ch === "\r") {
        // RSC line-continuation backslash → keep as newline
        out += "\n";
      } else out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') return { value: out, end: i + 1 };
    out += ch;
  }
  return null;
}

function extractAnswerMap(
  html: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const obj =
    extractJsonObjectAt(html, '"initialAnswers":') ??
    extractJsonObjectAt(html, '"answers":');
  if (!obj) return map;

  // Manual scan — RSC payloads are not always strict JSON after unescape
  let i = 1; // skip opening {
  while (i < obj.length - 1 && map.size < 120) {
    while (i < obj.length && (obj[i] === "," || /\s/.test(obj[i]!))) i++;
    if (obj[i] === "}") break;
    const key = readJsonString(obj, i);
    if (!key) break;
    i = key.end;
    while (i < obj.length && /\s/.test(obj[i]!)) i++;
    if (obj[i] !== ":") break;
    i++;
    while (i < obj.length && /\s/.test(obj[i]!)) i++;
    if (obj[i] === "n" && obj.slice(i, i + 4) === "null") {
      i += 4;
      continue;
    }
    const val = readJsonString(obj, i);
    if (!val) break;
    i = val.end;
    const value = resolveAnswerValue(html, val.value);
    if (!value || value === "null" || value.length < 2) continue;
    if (value === "{" || value === "[") continue;
    map.set(key.value, value);
  }
  return map;
}

function extractActivity(html: string, taskId: string): {
  comments: TaskComment[];
  proofOfWork: TaskProof[];
  activity: TaskActivity[];
} {
  const comments: TaskComment[] = [];
  const proofOfWork: TaskProof[] = [];
  const activity: TaskActivity[] = [];

  const re =
    /\{"id":"cm[^"]+","action":"([^"]+)","field":("(?:\\.|[^"\\])*"|null),"oldValue":("(?:\\.|[^"\\])*"|null),"newValue":("(?:\\.|[^"\\])*"|null),"taskId":"([^"]+)","userId":"[^"]+","createdAt":"([^"]+)","user":\{"id":"[^"]+","name":"([^"]+)","imageUrl":("(?:\\.|[^"\\])*"|null)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && activity.length < 80) {
    if (m[5] !== taskId) continue;
    const action = m[1]!;
    const field = m[2] === "null" ? null : decodeJsonStringish(m[2]!);
    const newValue =
      m[4] === "null" ? null : resolveAnswerValue(html, m[4]!);
    const at = m[6]!.startsWith("$D") ? m[6]!.slice(2) : m[6]!;
    const author = m[7]!;
    const imageUrl =
      m[8] === "null" ? null : decodeJsonStringish(m[8]!);

    if (action === "comment" && newValue) {
      comments.push({ author, body: newValue, at, imageUrl });
      continue;
    }
    if (action === "proof_of_work" && newValue) {
      proofOfWork.push({ name: newValue, author, at, url: null });
      activity.push({
        action,
        author,
        summary: `uploaded proof of work: ${newValue}`,
        at,
      });
      continue;
    }
    if (action === "moved" && newValue) {
      activity.push({
        action,
        author,
        summary: `moved → ${newValue.replaceAll("_", " ")}`,
        at,
      });
      continue;
    }
    if (action === "created") {
      activity.push({
        action,
        author,
        summary: "created this task",
        at,
      });
      continue;
    }
    if (action === "updated" && field) {
      activity.push({
        action,
        author,
        summary: `updated ${field}`,
        at,
      });
    }
  }

  // Also catch free-form comment payloads
  const commentRe =
    /"action":"comment"[\s\S]{0,500}?"newValue":("(?:\\.|[^"\\])*"|\$[0-9a-z]+)[\s\S]{0,300}?"name":"((?:\\.|[^"\\])*)"/gi;
  while ((m = commentRe.exec(html)) && comments.length < 40) {
    const body = resolveAnswerValue(html, m[1]!);
    const author = decodeJsonStringish(`"${m[2]}"`);
    if (body && !comments.some((c) => c.body === body && c.author === author)) {
      comments.push({ author, body, at: null, imageUrl: null });
    }
  }

  return { comments, proofOfWork, activity };
}

/** Pull a single task (Q&A, attachments, comments, activity) from a task-detail RSC page. */
export function extractTaskDetail(
  html: string,
  taskId: string,
): TaskDetailExtras | null {
  const un = deepUnescape(html);
  const tasks = extractTasks(un);
  const match = tasks.find((t) => t.id === taskId) ?? null;
  const taskType = match?.taskType;

  const catalog = extractQuestionCatalog(un);
  const answers = extractAnswerMap(un);
  const questions: TaskQA[] = [];
  for (const q of catalog) {
    if (taskType && q.taskType !== taskType) continue;
    const raw = answers.get(q.id);
    if (!raw) continue;
    if (parseAttachmentBlob(raw).length) continue; // attachments handled separately
    const answer = raw.trim();
    if (!answer || answer === "null") continue;
    questions.push({ question: q.question, answer });
  }

  const attachments = extractAttachmentsFromHtml(un);
  // Also pull attachment blobs from answers map
  for (const val of answers.values()) {
    for (const a of parseAttachmentBlob(val)) {
      if (!attachments.some((x) => x.url === a.url)) attachments.push(a);
    }
  }

  const { comments, proofOfWork, activity } = extractActivity(un, taskId);

  let description = match ? normalizeDescription(match.description) : null;
  if (!description && questions.length) {
    description = questions
      .map((q) => `### ${q.question}\n${q.answer}`)
      .join("\n\n");
  }

  if (
    !match &&
    !description &&
    !attachments.length &&
    !comments.length &&
    !questions.length
  ) {
    return null;
  }

  return {
    description,
    title: match?.title,
    stage: match?.stage,
    priority: match?.priority,
    estimatedMinutes: match?.estimatedMinutes ?? null,
    assigneeName: match?.assigneeName ?? null,
    assigneeImage: match?.assigneeImage ?? null,
    sprintName: match?.sprintName ?? null,
    sprintStatus: match?.sprintStatus ?? null,
    stageEnteredAt: match?.stageEnteredAt ?? null,
    startedAt: match?.startedAt ?? null,
    questions,
    attachments,
    comments,
    proofOfWork,
    activity,
  };
}
