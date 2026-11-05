import { useEffect, useId, useMemo, useRef, useState } from "react";

export type Pt = [number, number | null];
export type Series = { name: string; points: Pt[]; color?: string; dashed?: boolean };
export type Mark = { x: number; y: number; label: string; color?: string; chip?: boolean };
type Props = {
  series: Series[]; xMin: number; xMax: number; yMin: number; yMax: number; log?: boolean;
  yTicks: number[]; xTicks: { x: number; label: string }[]; height?: number;
  refs?: { y: number; label: string }[]; markers?: { x: number; label: string }[]; marks?: Mark[];
  fmtY?: (v: number) => string; fmtX?: (v: number) => string; unit?: string; ariaLabel: string;
  span?: { x0: number; x1: number }; fill?: boolean; summary?: string; area?: boolean;
  pointLabels?: (y: number) => string; xTitle?: string; yTitle?: string;
};


export function LineChart(p: Props) {
  const M = { l: p.yTitle ? 60 : 48, r: 18, t: p.pointLabels ? 34 : 22, b: p.xTitle ? 46 : 26 };
  const box = useRef<HTMLDivElement>(null);
  const sid = useId();
  const [w, setW] = useState(640);
  const [fh, setFh] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { setW(Math.max(280, Math.floor(e.contentRect.width))); setFh(Math.floor(e.contentRect.height)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = p.fill ? Math.max(fh, p.height ?? 220) : (p.height ?? 260);
  const iw = w - M.l - M.r, ih = h - M.t - M.b;
  const sx = (x: number) => M.l + ((x - p.xMin) / (p.xMax - p.xMin || 1)) * iw;
  const ty = (y: number) => (p.log ? Math.log(Math.max(y, 1e-9)) : y);
  const sy = (y: number) => M.t + ih - ((ty(y) - ty(p.yMin)) / (ty(p.yMax) - ty(p.yMin) || 1)) * ih;
  const fy = p.fmtY ?? ((v: number) => String(v));

  const paths = useMemo(
    () => p.series.map((s) => {
      const segs: string[] = [];
      let cur = "";
      for (const [x, y] of s.points) {
        if (y == null) { if (cur) segs.push(cur); cur = ""; continue; }
        cur += `${cur ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
      }
      if (cur) segs.push(cur);
      return segs.join(" ");
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.series, w, h, p.xMin, p.xMax, p.yMin, p.yMax, p.log],
  );

  const main = p.series[0]?.points.filter((q): q is [number, number] => q[1] != null) ?? [];
  const nearest = hover == null || !main.length ? null : main.reduce((a, b) => (Math.abs(b[0] - hover) < Math.abs(a[0] - hover) ? b : a));

  return (
    <div ref={box} style={p.fill ? { position: "relative", flex: 1, minHeight: p.height ?? 220 } : { position: "relative" }}>
      <svg className="chart" width={w} height={h} style={p.fill ? { position: "absolute", inset: 0 } : undefined} role="img" aria-label={p.ariaLabel} aria-describedby={p.summary ? sid : undefined}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(p.xMin + (((e.clientX - r.left) * (w / r.width) - M.l) / iw) * (p.xMax - p.xMin));  /* w/r.width undoes CSS zoom */ }}
        onMouseLeave={() => setHover(null)}>
        {p.span && <rect className="span" x={sx(p.span.x0)} y={M.t} width={Math.max(0, sx(p.span.x1) - sx(p.span.x0))} height={ih} />}
        {p.yTicks.map((t) => (
          <g key={t}>
            <line className="grid-l" x1={M.l} x2={w - M.r} y1={sy(t)} y2={sy(t)} />
            <text x={M.l - 8} y={sy(t) + 4} textAnchor="end">{fy(t)}</text>
          </g>
        ))}
        <line className="base" x1={M.l} x2={w - M.r} y1={M.t + ih} y2={M.t + ih} />
        {p.xTicks.map((t) => (
          <text key={t.label} x={sx(t.x)} y={M.t + ih + 18} textAnchor={sx(t.x) > w - M.r - 24 ? "end" : "middle"}>{t.label}</text>
        ))}
        {p.refs?.map((r) => (
          <g key={r.label}>
            <line className="ref" x1={M.l} x2={w - M.r} y1={sy(r.y)} y2={sy(r.y)} />
            <text x={w - M.r} y={sy(r.y) - 5} textAnchor="end">{r.label}</text>
          </g>
        ))}
        {p.markers?.map((m) => (
          <g key={m.label + m.x}>
            <line className="ref" x1={sx(m.x)} x2={sx(m.x)} y1={M.t - 4} y2={M.t + ih} />
            <text x={Math.min(sx(m.x) + 4, w - M.r - 60)} y={M.t - 8}>{m.label}</text>
          </g>
        ))}
        {p.area && main.length > 1 && (
          <path className="area" d={`M${sx(main[0][0])} ${M.t + ih} ${main.map((q) => `L${sx(q[0]).toFixed(1)} ${sy(q[1]).toFixed(1)}`).join(" ")} L${sx(main[main.length - 1][0])} ${M.t + ih} Z`} />
        )}
        {p.series.map((s, i) => (
          <path key={s.name} d={paths[i]} className={s.dashed ? "fc" : "line"} stroke={s.color ?? "var(--chart-1)"} />
        ))}
        {p.yTitle && <text x={14} y={M.t + ih / 2} textAnchor="middle" transform={`rotate(-90 14 ${M.t + ih / 2})`}>{p.yTitle}</text>}
        {p.xTitle && <text x={M.l + iw / 2} y={h - 6} textAnchor="middle">{p.xTitle}</text>}
        {p.pointLabels && main.map(([x, y]) => (
          <g key={x}>
            <circle cx={sx(x)} cy={sy(y)} r={4} fill="#fff" stroke={p.series[0].color ?? "var(--chart-1)"} strokeWidth={2} />
            {w >= 560 && <g className="pt-chip"><rect x={sx(x) - 20} y={sy(y) - 28} width={40} height={19} rx={6} /><text x={sx(x)} y={sy(y) - 14} textAnchor="middle">{p.pointLabels!(y)}</text></g>}
          </g>
        ))}
        {p.marks?.map((m) => {
          const cw = m.label.length * 6.6 + 18;
          const cx = Math.min(Math.max(sx(m.x), M.l + cw / 2), w - M.r - cw / 2);
          return (
            <g key={m.label}>
              <circle cx={sx(m.x)} cy={sy(m.y)} r={m.chip ? 6 : 5} fill={m.color ?? "var(--sogan)"} stroke="#fff" strokeWidth={1.5} />
              {m.chip ? <g className="mk-chip"><rect x={cx - cw / 2} y={sy(m.y) - 34} width={cw} height={22} rx={7} /><text x={cx} y={sy(m.y) - 19} textAnchor="middle">{m.label}</text></g>
                : <text x={sx(m.x) + 9} y={sy(m.y) + 4}>{m.label}</text>}
            </g>
          );
        })}
        {nearest && (
          <g>
            <line x1={sx(nearest[0])} x2={sx(nearest[0])} y1={M.t} y2={M.t + ih} stroke="#a89e88" strokeWidth={1} />
            <circle cx={sx(nearest[0])} cy={sy(nearest[1])} r={3.5} fill={p.series[0].color ?? "var(--chart-1)"} />
          </g>
        )}
      </svg>
      {p.summary && <p className="sr-only" id={sid}>{p.summary}</p>}
      {nearest && (
        <div style={{ position: "absolute", left: Math.min(sx(nearest[0]) + 10, w - 150), top: 4, fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", pointerEvents: "none" }}>
          {(p.fmtX ?? String)(nearest[0])} · <b style={{ fontWeight: 500 }}>{fy(nearest[1])}</b>{p.unit ? ` ${p.unit}` : ""}
        </div>
      )}
    </div>
  );
}

/** Log-axis top: smallest of 300/1000/3000/10000 above the data with headroom. */
export function logTop(values: (number | null | undefined)[], floor: number): number {
  const top = Math.max(...values.map((v) => v ?? 0), floor * 1.5);
  return [300, 1000, 3000, 10000].find((v) => v >= top * 1.15) ?? 10000;
}

/** "Nice" tick helpers */
export function niceTicks(max: number, n = 4): number[] {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
}
