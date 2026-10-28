export const BOARD_COLUMNS = [
  { key: "BACKLOG", label: "Backlog", tone: "#64748b" },
  { key: "NEXT", label: "Next", tone: "#0ea5e9" },
  { key: "PLANNED", label: "Planned", tone: "#38bdf8" },
  { key: "TODO", label: "Todo", tone: "#14b8a6" },
  { key: "IN_DEVELOPMENT", label: "In Development", tone: "#3b82f6" },
  { key: "INTERNAL_REVIEW", label: "Internal Review", tone: "#f59e0b" },
  { key: "DONE", label: "Done", tone: "#22c55e" },
  { key: "SHIPPED", label: "Shipped", tone: "#84cc16" },
  { key: "COMPLETED", label: "Completed", tone: "#a3e635" },
] as const;

export type StageKey = (typeof BOARD_COLUMNS)[number]["key"];

export const DEFAULT_VISIBLE_STAGES: StageKey[] = [
  "TODO",
  "IN_DEVELOPMENT",
  "INTERNAL_REVIEW",
  "DONE",
];

export function taskCode(type: string, num: number) {
  const prefix =
    type === "BUG" ? "B" : type === "ENHANCEMENT" ? "E" : type === "FEATURE" ? "F" : "T";
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

export function formatHours(minutes: number | null | undefined) {
  if (minutes == null) return null;
  const h = minutes / 60;
  if (h < 1) return `${minutes}m`;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}
