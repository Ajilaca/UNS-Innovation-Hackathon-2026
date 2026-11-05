import { useState, type ReactNode } from "react";
import { api, downloadCsv } from "../api";
import { Donut } from "../components/Donut";
import { IconBolt, IconCheck, IconCoins, IconDownload, IconDrop, IconInfo, IconLayers, IconLeaf, IconShield, IconTrend } from "../components/icons";
import { niceTicks } from "../components/LineChart";
import { Empty, ErrorNote } from "../components/ui";
import { num, rp, STATUS_LABEL } from "../format";
import { usePoll } from "../hooks";
import type { Batch } from "../types";

const DAY = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", month: "short", year: "numeric" });
const monthKey = (ts: number) => new Date(ts * 1000 + 7 * 3600 * 1000).toISOString().slice(0, 7);
const statusColor = (s: string) => (s === "LOLOS" ? "#0f7a5f" : s === "GAGAL_WARNA_MENTOK" ? "#d9a55b" : s.startsWith("GAGAL") ? "#d9694f" : "#9aa7a0");

/** Monthly volume (bars, left axis) and pass rate (line, right axis). Months come from the batches themselves. */
export function monthly(all: Batch[]): { key: string; label: string; m3: number; pass: number; n: number }[] {
  const g = new Map<string, Batch[]>();
  for (const b of all) { const k = monthKey(b.ts_end); g.set(k, [...(g.get(k) ?? []), b]); }
  return [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, bs]) => ({
    key, label: MONTH.format(new Date(bs[0].ts_end * 1000)), n: bs.length,
    m3: bs.reduce((a, b) => a + b.V_L, 0) / 1000, pass: (100 * bs.filter((b) => b.status === "LOLOS").length) / bs.length,
  }));
}

function Trend({ data }: { data: ReturnType<typeof monthly> }) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 720;
  const W = narrow ? 400 : 820, H = narrow ? 270 : 215, L = 44, R = 46, T = 22, B = 36;
  const ticks = niceTicks(Math.max(...data.map((d) => d.m3), 0.1) * 1.1), top = ticks[ticks.length - 1];
  const slot = (W - L - R) / data.length, bw = Math.min(slot * 0.6, 110);
  const sy = (v: number) => H - B - (v / top) * (H - B - T), sp = (v: number) => H - B - (v / 100) * (H - B - T);
  const cx = (i: number) => L + slot * (i + 0.5);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Volume air diolah dan tingkat batch lolos per bulan">
      {ticks.map((t, i) => <g key={t}><line className="grid-l" x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} /><text x={L - 8} y={sy(t) + 4} textAnchor="end">{num(t, t < 10 ? 1 : 0)}</text><text x={W - R + 8} y={sy(t) + 4}>{25 * i}%</text></g>)}
      {data.map((d, i) => <g key={d.key}>
        <rect x={cx(i) - bw / 2} y={sy(d.m3)} width={bw} height={Math.max(H - B - sy(d.m3), 1)} rx={5} fill="#17896b" />
        {H - B - sy(d.m3) > 26 && <text x={cx(i)} y={sy(d.m3) + 18} textAnchor="middle" style={{ fill: "#fff", fontWeight: 600 }}>{num(d.m3, 2)} m³</text>}
        <text x={cx(i)} y={H - B + 20} textAnchor="middle">{d.label}</text>
      </g>)}
      {data.length > 1 && <polyline points={data.map((d, i) => `${cx(i)},${sp(d.pass)}`).join(" ")} fill="none" stroke="#e0a33a" strokeWidth={2.5} strokeLinejoin="round" />}
      {data.map((d, i) => <g key={d.key}><circle cx={cx(i)} cy={sp(d.pass)} r={5} fill="#fff" stroke="#e0a33a" strokeWidth={2.5} /><text x={cx(i)} y={sp(d.pass) - 10} textAnchor="middle" fontWeight={600}>{num(d.pass)}%</text></g>)}
      <text x={12} y={H / 2} transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">Volume (m³)</text>
    </svg>
  );
}

const Head = ({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) => (
  <div className="card-head"><h2 className="with-ic"><span className="ic square">{icon}</span><span>{title}{sub && <small>{sub}</small>}</span></h2></div>
);

export function Laporan() {
  const [source, setSource] = useState("");
  const q = usePoll(() => api<{ batches: Batch[] }>(`/api/batches?limit=200${source ? `&source=${source}` : ""}`), 10000, [source]);
  const all = q.data?.batches ?? [];
  const sum = (f: (b: Batch) => number) => all.reduce((a, b) => a + f(b), 0);
  const m3 = sum((b) => b.V_L) / 1000, kwh = sum((b) => b.kwh_total), cost = sum((b) => b.cost_rp), sludge = sum((b) => b.sludge_kg);
  const statuses = new Map<string, number>();
  for (const b of all) statuses.set(b.status, (statuses.get(b.status) ?? 0) + 1);
  const rows = [...statuses.entries()].sort((a, b) => b[1] - a[1]);
  const pass = statuses.get("LOLOS") ?? 0;
  const t0 = all.length ? Math.min(...all.map((b) => b.ts_end)) : 0, t1 = all.length ? Math.max(...all.map((b) => b.ts_end)) : 0;
  const days = Math.max(1, Math.round((t1 - t0) / 86400));
  const sim = all.some((b) => b.source === "simulator");
  const months = monthly(all);
  const pct = (n: number) => `${num((100 * n) / all.length, 1)}%`;
  return (
    <>
      <h1 className="sr-only">Laporan</h1>
      {q.error && <ErrorNote message={q.error} onRetry={q.reload} />}
      {all.length === 0 ? <Empty>Belum ada batch untuk dilaporkan.</Empty> : (
        <>
          <section className="rep-kpis">
            <div className="rep-lead"><span className="rep-leaf"><IconLeaf /></span><div><div className="rep-k">Ringkasan periode</div><div className="rep-big">{all.length} batch</div><div className="rep-s">{DAY.format(new Date(t0 * 1000))} – {DAY.format(new Date(t1 * 1000))} (± {days} hari)</div></div></div>
            <div className="rep-kpi"><div className="rep-k"><IconDrop />Air diolah</div><div className="rep-v">{num(m3, 2)}<small>m³</small></div></div>
            <div className="rep-kpi"><div className="rep-k"><IconShield />Batch mencapai target warna</div><div className="rep-v">{num((100 * pass) / all.length)}<small>%</small></div><div className="rep-s">{pass} dari {all.length} batch</div></div>
            <div className="rep-kpi"><div className="rep-k"><IconBolt />Energi</div><div className="rep-v">{num(kwh, 2)}<small>kWh</small></div><div className="rep-s">{num(sum((b) => b.kwh_grid), 2)} kWh dari PLN</div></div>
            <div className="rep-kpi"><div className="rep-k"><IconCoins />Estimasi biaya</div><div className="rep-v">{rp(cost)}</div>{m3 > 0 && <div className="rep-s">± {rp(cost / m3)}/m³</div>}</div>
            <div className="batch-bar end rep-actions">
              <div className="actions">
                <select className="select sm" aria-label="Sumber data" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Semua sumber</option><option value="device">Perangkat</option><option value="simulator">Simulasi</option>
                </select>
                <button className="btn primary" onClick={() => downloadCsv(`/api/report.csv${source ? `?source=${source}` : ""}`, "laporan-sebat.csv")}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><IconDownload /> Unduh laporan (CSV)</span></button>
              </div>
            </div>
          </section>
          <div className="grid g-2 rep-row">
            <section className="card">
              <Head icon={<IconLayers />} title="Distribusi hasil batch" />
              <div className="rep-dist">
                <Donut label={`${all.length} batch, ${num((100 * pass) / all.length)}% lolos`} parts={rows.map(([s, n]) => ({ pct: (100 * n) / all.length, color: statusColor(s) }))}><b>{all.length}</b><small>batch</small></Donut>
                <table className="rep-legend"><tbody>{rows.map(([s, n]) => <tr key={s}><td><i style={{ background: statusColor(s) }} />{STATUS_LABEL[s] ?? s}</td><td className="num">{n} batch</td><td className="num"><span className={`pill ${s === "LOLOS" ? "ok" : s.startsWith("GAGAL") ? "bad" : ""}`}>{pct(n)}</span></td></tr>)}</tbody></table>
              </div>
            </section>
            <section className="card">
              <Head icon={<IconLeaf />} title="Dampak pengolahan" sub="Manfaat langsung dari proses pengolahan limbah di periode ini." />
              <div className="rep-impact">
                <div className="demand-tile"><h3>Volume air diolah</h3><dl><div><dd>{num(m3, 2)}<small>m³</small></dd></div></dl></div>
                <div className="demand-tile"><h3>Energi digunakan</h3><dl><div><dd>{num(kwh, 2)}<small>kWh</small></dd></div></dl></div>
                <div className="demand-tile"><h3>Lumpur (B3)</h3><dl><div><dd>{num(sludge, 1)}<small>kg</small></dd><dt>{sim ? "estimasi simulasi · " : ""}besi terlarut {num(sum((b) => b.electrode_g) / 1000, 2)} kg</dt></div></dl></div>
              </div>
            </section>
          </div>
          <div className="grid g-2 rep-row rep-row2">
            <section className="card">
              <Head icon={<IconTrend />} title="Tren bulanan: volume diolah dan tingkat batch lolos" />
              <p className="pair-legend rep-leg"><span><i style={{ background: "#17896b" }} />Volume air diolah (m³)</span><span><i style={{ background: "#e0a33a" }} />Batch lolos (%)</span></p>
              <Trend data={months} />
            </section>
            <section className="card">
              <Head icon={<IconCheck />} title="Ringkasan status batch" />
              <div className="tbl-wrap"><table className="soft">
                <thead><tr><th>Status</th><th className="num">Jumlah</th><th className="num">Porsi</th></tr></thead>
                <tbody>{rows.map(([s, n]) => <tr key={s} className={s === "LOLOS" ? "hl" : ""}><td><i className="dot" style={{ background: statusColor(s) }} />{STATUS_LABEL[s] ?? s}</td><td className="num">{n}</td><td className="num">{pct(n)}</td></tr>)}</tbody>
              </table></div>
            </section>
          </div>
          <div className="note-bar warn"><span><IconInfo /><span><b>{sim ? "Data simulasi" : "Warna estimasi sensor"}</b>{sim ? ", bukan hasil pengukuran laboratorium dan belum untuk pelaporan resmi ke DLH." : ", bukan hasil uji laboratorium."}</span></span></div>
        </>
      )}
    </>
  );
}
