import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { waterFromPtco } from "./water";
import { MODE_LABEL, STATE_LABEL, STATUS_LABEL, STATUS_TONE } from "../format";

export function Pill({ tone = "neutral", children }: { tone?: "ok" | "bad" | "warn" | "neutral"; children: ReactNode }) {
  return <span className={`pill ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}
export const StatusPill = ({ status }: { status: string }) => <Pill tone={STATUS_TONE(status)}>{STATUS_LABEL[status] ?? status}</Pill>;
export const ModePill = ({ mode }: { mode?: string }) => (mode ? <Pill>{MODE_LABEL[mode] ?? mode}</Pill> : <span className="muted">–</span>);
export function StatePill({ state }: { state: string }) {
  const tone = state === "RUNNING" ? "ok" : state === "FAULT" ? "bad" : state === "PAUSED_SOLAR" || state === "WAITING_SOLAR" ? "warn" : "neutral";
  return <Pill tone={tone}>{STATE_LABEL[state] ?? state}</Pill>;
}

/** Before and after water, as two small cups. */
export function Cups({ from, to }: { from?: number | null; to?: number | null }) {
  return (
    <span className="cups" aria-hidden>
      <span className="cup" style={{ background: waterFromPtco(from) }} />→<span className="cup" style={{ background: waterFromPtco(to) }} />
    </span>
  );
}

export type KpiItem = { label: string; value: ReactNode; unit?: string; sub?: ReactNode; lead?: boolean; icon?: ReactNode };
export function Kpis({ items, loading }: { items: KpiItem[]; loading?: boolean }) {
  return (
    <div className="kpis" style={{ ["--n" as string]: items.length }}>
      {items.map((k) => (
        <div className={`kpi ${k.icon ? "has-ic" : ""}`} key={k.label}>
          {k.icon && <span className="kpi-ic" aria-hidden>{k.icon}</span>}
          <div className="kpi-label">{k.label}</div>
          <div className={`kpi-value ${k.lead ? "lead" : ""}`}>
            {loading ? <span className="skeleton" style={{ width: 72, height: k.lead ? 30 : 24 }} aria-label="Memuat" /> : <>{k.value}{k.unit && <span className="unit">{k.unit}</span>}</>}
          </div>
          {!loading && k.sub && <div className="kpi-sub">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, right, icon, className, children }: { title?: string; right?: ReactNode; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || right) && (
        <div className="card-head">
          {title && <h2>{icon && <span className="h-ic" aria-hidden>{icon}</span>}{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="err" role="alert">
      <span>{message}</span>
      {onRetry && <button className="btn text" onClick={onRetry}>Coba lagi</button>}
    </div>
  );
}

export function Bars({ rows, hueIndex, max: fixedMax }: { rows: { label: string; value: number; text: string }[]; hueIndex?: number; max?: number }) {
  const max = fixedMax ?? Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="row" key={r.label}>
          <span>{r.label}</span>
          <div className="track"><div className={`fill ${i === hueIndex ? "hue" : ""}`} style={{ width: `${(100 * r.value) / max}%` }} /></div>
          <span className="num" style={{ textAlign: "right" }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export const tabIds = (id: string) => ({ tab: `tab-${id}`, panel: `panel-${id}` });

export function Tabs<T extends string>({ items, value, onChange, label, pill }: { items: { id: T; label: string; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; pill?: boolean }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => { // keep the active tab fully visible when the row scrolls sideways on a phone, without moving the page
    const el = refs.current[value], row = el?.parentElement;
    if (!el || !row) return;
    const a = el.getBoundingClientRect(), b = row.getBoundingClientRect();
    if (a.left < b.left) row.scrollLeft -= b.left - a.left + 8;
    else if (a.right > b.right) row.scrollLeft += a.right - b.right + 8;
  }, [value]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = items.length - 1;
    const n = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].id);
    refs.current[items[n].id]?.focus();
  };
  return (
    <div className={pill ? "tabs tabs-pill" : "tabs"} role="tablist" aria-label={label}>
      {items.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={tabIds(t.id).tab} aria-controls={tabIds(t.id).panel}
          aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => onChange(t.id)}>{t.icon}{t.label}</button>
      ))}
    </div>
  );
}

export function Panel({ id, children }: { id: string; children: ReactNode }) {
  return <div role="tabpanel" id={tabIds(id).panel} aria-labelledby={tabIds(id).tab} tabIndex={0} className="panel">{children}</div>;
}
