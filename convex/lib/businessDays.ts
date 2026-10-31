/** Sun–Thu work week; Fri–Sat weekend. Default zone: Asia/Kuwait. */

export const BUSINESS_TZ = "Asia/Kuwait";

export type BusinessWindow = {
  /** Calendar days YYYY-MM-DD ascending (Asia/Kuwait). */
  days: string[];
  fromIso: string;
  toIso: string;
  windowKey: string;
  label: string;
  timeZone: string;
};

const WEEKDAY_SHORT = new Set([
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
]);

function formatParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

function dayKeyFromParts(parts: Record<string, string>) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isBusinessWeekday(weekdayShort: string) {
  return weekdayShort !== "Fri" && weekdayShort !== "Sat";
}

/** Offset ms such that `utcMs + offset ≈ wall-clock-as-UTC` in the zone. */
function zoneOffsetMs(utcMs: number, timeZone: string) {
  const parts = formatParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

/** Instant when `day` (YYYY-MM-DD) has wall-clock h:m:s.ms in `timeZone`. */
function zonedDateTimeToUtc(
  day: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const [y, mo, d] = day.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hour, minute, second, ms);
  const offset = zoneOffsetMs(guess, timeZone);
  return new Date(guess - offset);
}

function formatDayLabel(day: string, timeZone: string) {
  const noon = zonedDateTimeToUtc(day, 12, 0, 0, 0, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(noon);
}

/**
 * Last `count` business days, walking backward from `now` in `timeZone`.
 * Today is included when it is a Sun–Thu workday.
 */
export function lastBusinessDays(opts?: {
  count?: number;
  now?: Date | number;
  timeZone?: string;
}): BusinessWindow {
  const count = Math.max(1, Math.min(opts?.count ?? 2, 14));
  const timeZone = opts?.timeZone ?? BUSINESS_TZ;
  const now = new Date(opts?.now ?? Date.now());

  const collected: string[] = [];
  const parts = formatParts(now, timeZone);
  let cursorDay = dayKeyFromParts(parts);

  // Safety: at most ~3 weeks of calendar walk for 2 business days.
  for (let i = 0; i < 28 && collected.length < count; i++) {
    const noon = zonedDateTimeToUtc(cursorDay, 12, 0, 0, 0, timeZone);
    const noonParts = formatParts(noon, timeZone);
    const weekday = noonParts.weekday;
    if (!WEEKDAY_SHORT.has(weekday)) {
      throw new Error(`Unexpected weekday token: ${weekday}`);
    }
    if (isBusinessWeekday(weekday) && !collected.includes(cursorDay)) {
      collected.push(cursorDay);
    }
    const prev = new Date(noon.getTime() - 24 * 60 * 60 * 1000);
    cursorDay = dayKeyFromParts(formatParts(prev, timeZone));
  }

  const days = [...collected].sort();
  const older = days[0]!;
  const newer = days[days.length - 1]!;
  const fromIso = zonedDateTimeToUtc(older, 0, 0, 0, 0, timeZone).toISOString();
  // End of newer day = start of following calendar day − 1ms (avoids ms/offset skew).
  const newerNoon = zonedDateTimeToUtc(newer, 12, 0, 0, 0, timeZone);
  const following = new Date(newerNoon.getTime() + 24 * 60 * 60 * 1000);
  const followingKey = dayKeyFromParts(formatParts(following, timeZone));
  const toIso = new Date(
    zonedDateTimeToUtc(followingKey, 0, 0, 0, 0, timeZone).getTime() - 1,
  ).toISOString();
  const windowKey = `${older}_${newer}`;
  const label =
    days.length === 1
      ? formatDayLabel(older, timeZone)
      : `${formatDayLabel(older, timeZone)} – ${formatDayLabel(newer, timeZone)}`;

  return { days, fromIso, toIso, windowKey, label, timeZone };
}
