import {
  DEFAULT_VISIBLE_STAGES,
  type StageKey,
  BOARD_COLUMNS,
} from "./stages";

const STORAGE_KEY = "nizek-plus:board-prefs:v1";

export type BoardPrefs = {
  visibleStages: StageKey[];
  types: string[];
  priorities: string[];
  assignees: string[];
  activeSprintOnly: boolean;
  /** Project nizekIds the user turned off. Empty = all on. */
  disabledProjectIds: string[];
};

const STAGE_KEYS = new Set(BOARD_COLUMNS.map((c) => c.key));

export const DEFAULT_PREFS: BoardPrefs = {
  visibleStages: [...DEFAULT_VISIBLE_STAGES],
  types: [],
  priorities: [],
  assignees: [],
  activeSprintOnly: false,
  disabledProjectIds: [],
};

function isStageKey(v: unknown): v is StageKey {
  return typeof v === "string" && STAGE_KEYS.has(v as StageKey);
}

export function loadBoardPrefs(): BoardPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS, visibleStages: [...DEFAULT_VISIBLE_STAGES] };
    const parsed = JSON.parse(raw) as Partial<BoardPrefs>;
    const stages = Array.isArray(parsed.visibleStages)
      ? parsed.visibleStages.filter(isStageKey)
      : [...DEFAULT_VISIBLE_STAGES];
    return {
      visibleStages: stages.length ? stages : [...DEFAULT_VISIBLE_STAGES],
      types: Array.isArray(parsed.types)
        ? parsed.types.filter((x): x is string => typeof x === "string")
        : [],
      priorities: Array.isArray(parsed.priorities)
        ? parsed.priorities.filter((x): x is string => typeof x === "string")
        : [],
      assignees: Array.isArray(parsed.assignees)
        ? parsed.assignees.filter((x): x is string => typeof x === "string")
        : [],
      activeSprintOnly: Boolean(parsed.activeSprintOnly),
      disabledProjectIds: Array.isArray(parsed.disabledProjectIds)
        ? parsed.disabledProjectIds.filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    };
  } catch {
    return { ...DEFAULT_PREFS, visibleStages: [...DEFAULT_VISIBLE_STAGES] };
  }
}

export function saveBoardPrefs(prefs: BoardPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}
