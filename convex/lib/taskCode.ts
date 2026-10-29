/** Mirror of src/lib/stages.ts taskCode — kept here for Convex actions. */
export function taskCode(type: string, num: number) {
  const prefix =
    type === "BUG"
      ? "B"
      : type === "ENHANCEMENT"
        ? "E"
        : type === "FEATURE"
          ? "F"
          : "T";
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

export function parseTaskCode(text: string): string[] {
  const re = /\b([FEBT])-(\d{1,5})\b/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const code = `${m[1]!.toUpperCase()}-${m[2]!.padStart(3, "0")}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}
