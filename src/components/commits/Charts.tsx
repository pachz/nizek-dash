import { useMemo, useState } from "react";

type DailyPoint = {
  day: string;
  total: number;
  byProject: Record<string, number>;
};

type ConsistencyRow = {
  projectId: string;
  name: string;
  color: string;
  commits: number;
  activeDays: number;
  coveragePct: number;
  avgPerActiveDay: number;
  longestStreak: number;
  currentStreak: number;
  heatmap: number[];
};

function fmtDay(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DailyVolumeChart({
  daily,
  height = 160,
}: {
  daily: DailyPoint[];
  height?: number;
}) {
  const max = Math.max(1, ...daily.map((d) => d.total));
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(daily.length * 8, 320);
  const pad = 8;
  const chartH = height - 28;

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label="Daily commit volume"
      >
        {daily.map((d, i) => {
          const barW = Math.max(3, w / daily.length - 1.5);
          const x = (i / daily.length) * w + 0.5;
          const h = (d.total / max) * chartH;
          const y = pad + chartH - h;
          const active = hover === i;
          return (
            <rect
              key={d.day}
              x={x}
              y={y}
              width={barW}
              height={Math.max(d.total ? 2 : 0, h)}
              rx={2}
              className={active ? "chart-bar on" : "chart-bar"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {hover != null && daily[hover] ? (
          <text
            x={Math.min(Math.max(24, (hover / daily.length) * w), w - 24)}
            y={14}
            textAnchor="middle"
            className="chart-tip"
          >
            {fmtDay(daily[hover].day)} · {daily[hover].total}
          </text>
        ) : null}
      </svg>
      <div className="chart-axis">
        <span>{daily[0] ? fmtDay(daily[0].day) : ""}</span>
        <span>{daily.at(-1) ? fmtDay(daily.at(-1)!.day) : ""}</span>
      </div>
    </div>
  );
}

export function ConsistencyLines({
  daily,
  consistency,
  height = 180,
}: {
  daily: DailyPoint[];
  consistency: ConsistencyRow[];
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const series = consistency.slice(0, 6);
  const w = 640;
  const padL = 28;
  const padR = 8;
  const padT = 16;
  const padB = 20;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;

  const max = useMemo(() => {
    let m = 1;
    for (const d of daily) {
      for (const s of series) {
        m = Math.max(m, d.byProject[s.projectId] ?? 0);
      }
    }
    return m;
  }, [daily, series]);

  function pathFor(projectId: string) {
    if (daily.length === 0) return "";
    return daily
      .map((d, i) => {
        const x = padL + (i / Math.max(1, daily.length - 1)) * innerW;
        const v = d.byProject[projectId] ?? 0;
        const y = padT + innerH - (v / max) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg consistency-svg"
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label="Commit consistency by project"
      >
        {[0, 0.5, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          return (
            <line
              key={t}
              x1={padL}
              x2={w - padR}
              y1={y}
              y2={y}
              className="chart-grid"
            />
          );
        })}
        {series.map((s) => {
          const on = !active || active === s.projectId;
          return (
            <path
              key={s.projectId}
              d={pathFor(s.projectId)}
              fill="none"
              stroke={s.color}
              strokeWidth={on ? 2.4 : 1}
              opacity={on ? 1 : 0.18}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <button
            key={s.projectId}
            type="button"
            className="legend-item"
            data-dim={active != null && active !== s.projectId}
            onClick={() =>
              setActive((prev) => (prev === s.projectId ? null : s.projectId))
            }
          >
            <span className="dot" style={{ background: s.color }} />
            {s.name}
            <em>{s.coveragePct}%</em>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConsistencyHeatmap({
  consistency,
  days,
}: {
  consistency: ConsistencyRow[];
  days: string[];
}) {
  const rows = consistency.slice(0, 8);
  const max = Math.max(1, ...rows.flatMap((r) => r.heatmap));

  return (
    <div className="heatmap-scroll">
      <table className="heatmap-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            {days.map((d, i) => (
              <th key={d} scope="col" title={d}>
                {i % 7 === 0 ? fmtDay(d) : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.projectId}>
              <th scope="row">
                <span className="dot" style={{ background: r.color }} />
                {r.name}
              </th>
              {r.heatmap.map((v, i) => {
                const intensity = v === 0 ? 0 : 0.2 + (v / max) * 0.8;
                return (
                  <td key={`${r.projectId}-${days[i]}`}>
                    <span
                      className="heatmap-cell"
                      title={`${r.name} · ${days[i]} · ${v} commit${v === 1 ? "" : "s"}`}
                      style={{
                        background:
                          v === 0
                            ? "rgba(28,28,30,0.06)"
                            : `color-mix(in srgb, ${r.color} ${Math.round(intensity * 100)}%, white)`,
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
