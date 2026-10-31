const STORAGE_KEY = "nizek-plus:theme:v1";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const LISTENERS = new Set<() => void>();

function isThemePreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function saveThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore quota / private mode */
  }
  LISTENERS.forEach((fn) => fn());
}

export function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(pref: ThemePreference = loadThemePreference()): Theme {
  return pref === "system" ? getSystemTheme() : pref;
}

export function applyTheme(theme: Theme = resolveTheme()) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? "#0c0e14" : "#e8eef6");
  }
}

/** Toggle between explicit light and dark (leaves system once the user chooses). */
export function toggleTheme() {
  const next: Theme = resolveTheme() === "dark" ? "light" : "dark";
  saveThemePreference(next);
  applyTheme(next);
  return next;
}

export function subscribeTheme(onChange: () => void) {
  LISTENERS.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (loadThemePreference() === "system") {
      applyTheme();
      onChange();
    }
  };
  mq.addEventListener("change", onSystem);
  return () => {
    LISTENERS.delete(onChange);
    mq.removeEventListener("change", onSystem);
  };
}

export function getThemeSnapshot() {
  return resolveTheme();
}
