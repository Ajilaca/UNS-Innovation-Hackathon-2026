/** Single-purpose ring. Segments are percentages that sum to 100, or none when there is no data. */
export function Donut({ parts, children, label }: { parts: { pct: number; color: string }[]; children: React.ReactNode; label: string }) {
  const r = 44, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut" role="img" aria-label={label}>
      <svg viewBox="0 0 110 110" aria-hidden>
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--active)" strokeWidth="12" />
        {parts.filter((p) => p.pct > 0).map((p, i) => {
          const len = (p.pct / 100) * C, off = -acc; acc += len;
          return <circle key={i} cx="55" cy="55" r={r} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off} transform="rotate(-90 55 55)" />;
        })}
      </svg>
      <div className="donut-c">{children}</div>
    </div>
  );
}
