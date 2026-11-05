import { useState } from "react";
import { api, ApiError, getSession } from "../api";
import { LineChart, niceTicks } from "../components/LineChart";
import { IconBatch, IconBolt, IconBrain, IconBulb, IconCheck, IconClock, IconLeaf, IconSun, IconSwap, IconCoins, IconHybrid, IconInfo, IconSensor, IconStar, IconTower, IconShield, IconSliders, IconSolar, IconTrend } from "../components/icons";
import { Empty, ErrorNote, Panel, Tabs } from "../components/ui";
import { MODE_LABEL, num, rp } from "../format";
import { usePoll } from "../hooks";
import { useJob } from "../hooks.job";

type Agg = { label?: string; mode: string; fixed_q?: number | null; pass_true_pct: number; pass_sensor_pct: number; kwh_per_m3: number; electrode_g_per_m3: number; run_min_mean: number; cost_rp_per_m3: number; q_mean: number };
type Compare = { n: number; strategies: Record<string, Agg>; fixed_pareto: { q: number; pass_true_pct: number; kwh_per_m3: number }[] };
type Case = { policy: string; policy_label: string; mode: string; pass_true_pct: number; pct_renewable: number; kwh_grid: number; throughput_pct: number; backlog_batches: number; wait_min_mean: number; cost_rp_per_m3: number };
type Energy = { days: number; per_day: number; seeds: number[]; cases: Record<string, Case> };
type SizeRow = Case & { pv_wp: number; battery_wh: number; per_day: number };
type Sizing = { days: number; seeds: number[]; rows: SizeRow[] };
type Tab = "strategi" | "energi" | "ukuran" | "ketahanan";
type SensCell = { pass: number; kwh_m3: number; run_min: number };
type SensRow = { label: string; param: string | null; mult: number; fixed: SensCell; feedback: SensCell; ai: SensCell };
type Sens = { n: number; rows: SensRow[] };
type RobRow = { world: string; n: number; q_median: number | null; mape_physics: number; mape_single: number; mape_random: number; mape_random_corrected: number; cover80_single: number; cover80_random: number };
type Loop = { pass_pct: number; kwh_m3: number; run_min: number; mape: number | null; plateau_stops: number };
type LoopRow = { world: string; off: Loop; on: Loop };
type Rob = { n_train: number; n_test: number; rows: RobRow[]; closed_loop?: { n: number; seeds: number[]; calibration: LoopRow[]; plateau: LoopRow[] } };
const POLICY: Record<string, string> = { solar_only: "Surya murni", solar_first: "Hibrida", grid_only: "PLN saja" };

function useResult<T>(kind: string) {
  const q = usePoll(async () => { try { return await api<T>(`/api/results/${kind}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } }, null);
  return q;
}

function Runner({ kind, query, onDone, label }: { kind: string; query?: string; onDone: () => void; label: string }) {
  const isAdmin = getSession()?.role === "admin";
  const j = useJob(kind, onDone);
  if (!isAdmin) return <span className="stamp">Hanya admin yang dapat menjalankan analisis.</span>;
  return (
    <div className="actions">
      {j.err && <span className="stamp" style={{ color: "var(--negative)" }}>{j.err}</span>}
      {j.running && <span className="stamp">Berjalan… {num(100 * (j.job?.progress ?? 0))}%</span>}
      <button className="btn" disabled={j.running} onClick={() => j.start(query)}>{label}</button>
    </div>
  );
}

export function Compare() {
  const [tab, setTab] = useState<Tab>("strategi");
  return (
    <>
      <h1 className="sr-only">Perbandingan</h1>
      <Tabs<Tab> pill label="Jenis perbandingan" value={tab} onChange={setTab} items={[{ id: "strategi", label: "Strategi kendali", icon: <IconSliders /> }, { id: "energi", label: "Sumber energi", icon: <IconBolt /> }, { id: "ukuran", label: "Ukuran panel dan baterai", icon: <IconSolar /> }, { id: "ketahanan", label: "Ketahanan asumsi", icon: <IconShield /> }]} />
      <Panel id={tab}>
        {tab === "strategi" && <Strategies />}
        {tab === "energi" && <EnergyCases />}
        {tab === "ukuran" && <SizingTable />}
        {tab === "ketahanan" && <Robustness />}
      </Panel>
    </>
  );
}

function markList(d: Compare) {
  const f = d.strategies.feedback, a = d.strategies.ai;
  if (Math.abs(f.q_mean - a.q_mean) < 2 && Math.abs(f.pass_true_pct - a.pass_true_pct) < 0.5)
    return [{ x: a.q_mean, y: a.pass_true_pct, label: `Umpan balik dan AI (${num(a.pass_true_pct)}%)`, color: "#12a150", chip: true }];
  return [
    { x: f.q_mean, y: f.pass_true_pct, label: `Umpan balik (${num(f.pass_true_pct)}%)`, color: "var(--sogan)", chip: true },
    { x: a.q_mean, y: a.pass_true_pct, label: `AI (${num(a.pass_true_pct)}%)`, color: "#12a150", chip: true },
  ];
}

/** The headline is computed from the results, so it cannot outlive them after a re-run. */
export function strategyVerdict(fb: { pass_true_pct: number; kwh_per_m3: number }, safe: { pass_true_pct: number; kwh_per_m3: number }): string {
  const reliable = fb.pass_true_pct >= safe.pass_true_pct, cheap = fb.kwh_per_m3 < safe.kwh_per_m3;
  if (reliable && cheap) return "Umpan balik sensor lebih andal dan lebih hemat daripada waktu tetap yang disetel aman.";
  if (cheap) return "Umpan balik sensor lebih hemat, tetapi kurang andal dibanding waktu tetap yang disetel aman.";
  if (reliable) return "Umpan balik sensor lebih andal, tetapi lebih boros dibanding waktu tetap yang disetel aman.";
  return "Pada hasil ini, waktu tetap yang disetel aman mengungguli umpan balik sensor.";
}

const STRATEGY: { key: string; name: string; icon: JSX.Element; hi?: boolean }[] = [
  { key: "fixed_p50", name: "Waktu tetap, disetel rata-rata", icon: <IconClock /> },
  { key: "fixed_p90", name: "Waktu tetap, disetel aman", icon: <IconShield /> },
  { key: "feedback", name: "Umpan balik sensor", icon: <IconSensor /> },
  { key: "ai", name: "AI, prediksi + umpan balik", icon: <IconBrain />, hi: true },
];

function Strategies() {
  const q = useResult<Compare>("compare");
  const d = q.data;
  const best = d ? Math.max(...STRATEGY.map((x) => Math.round(d.strategies[x.key].pass_true_pct))) : 0;
  const same = d && Math.abs(d.strategies.ai.pass_true_pct - d.strategies.feedback.pass_true_pct) < 0.5;
  return (
    <>
      {q.error && <ErrorNote message={q.error} onRetry={q.reload} />}
      {!d ? <><Empty>Belum ada hasil perbandingan.</Empty><Runner kind="compare" query="?n=60" onDone={q.reload} label="Jalankan perbandingan" /></> : (
        <>
          <div className="banner"><span className="banner-ic"><IconCheck /></span><b>{strategyVerdict(d.strategies.feedback, d.strategies.fixed_p90)}</b></div>
          <div className="strat">
            {STRATEGY.map((x) => {
              const s = d.strategies[x.key], top = Math.round(s.pass_true_pct) === best;
              return (
                <section key={x.key} className={`strat-card ${x.hi ? "hi" : ""}`}>
                  <h3><span className="ic square">{x.icon}</span>{x.name}</h3>
                  <dl>
                    <div><dt>Lolos</dt><dd className={top ? "top" : ""}>{num(s.pass_true_pct)}%</dd></div>
                    <div><dt>Energi</dt><dd>{num(s.kwh_per_m3, 2)}<small>kWh/m³</small></dd></div>
                    <div><dt>Waktu proses</dt><dd>{num(s.run_min_mean)}<small>menit</small></dd></div>
                  </dl>
                </section>
              );
            })}
          </div>
          <section className="card chart-card">
            <div>
              <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconTrend /></span>Waktu tetap perlu muatan besar agar andal</h2></div>
              <LineChart area ariaLabel="Persentase lolos terhadap muatan listrik pada strategi waktu tetap" height={262}
                series={[{ name: "Waktu tetap", points: d.fixed_pareto.map((p): [number, number] => [p.q, p.pass_true_pct]) }]}
                xMin={50} xMax={850} yMin={0} yMax={100} yTicks={[0, 25, 50, 75, 100]} xTicks={[100, 200, 300, 400, 500, 600, 700, 800].map((x) => ({ x, label: String(x) }))}
                pointLabels={(y) => `${num(y)}%`} xTitle="Muatan listrik yang dipakai (C/L)" yTitle="Persentase lolos"
                fmtY={(v) => `${num(v)}%`} fmtX={(v) => `${num(v)} C/L`} unit="lolos" marks={markList(d)} />
            </div>
            <aside className="chart-side">
              <p><b>Garis</b> adalah waktu tetap pada berbagai muatan. <b>Titik hijau</b> adalah strategi berumpan balik pada muatan rata-ratanya, karena muatannya disesuaikan per batch.</p>
              {same && <p>AI dan umpan balik memberi mutu air yang sama di sini. Nilai tambah AI ada pada perkiraan waktu dan penjadwalan energi.</p>}
              <p className="note"><IconInfo />Hasil simulasi, bukan pengukuran alat. {d.n} batch per strategi.</p>
              <Runner kind="compare" query="?n=60" onDone={q.reload} label="Jalankan ulang" />
            </aside>
          </section>
          <details className="more">
            <summary>Rincian besi dan biaya</summary>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Strategi</th><th className="num">Muatan rata-rata</th><th className="num">Besi (g/m³)</th><th className="num">Biaya/m³</th></tr></thead>
              <tbody>{STRATEGY.map((x) => { const s = d.strategies[x.key]; return <tr key={x.key}><td>{x.name}</td><td className="num">{num(s.q_mean)} C/L</td><td className="num">{num(s.electrode_g_per_m3)}</td><td className="num">{rp(s.cost_rp_per_m3)}</td></tr>; })}</tbody>
            </table></div>
          </details>
        </>
      )}
    </>
  );
}

function CaseTable({ rows }: { rows: (Case & { pv_wp?: number; battery_wh?: number; per_day?: number })[] }) {
  return (
    <div className="tbl-wrap"><table>
      <thead><tr><th>Sumber</th><th>Strategi</th><th className="num">Lolos</th><th className="num">Terbarukan</th><th className="num">PLN (kWh)</th><th className="num">Batch selesai</th><th className="num">Tunggu rata-rata</th><th className="num">Biaya/m³</th></tr></thead>
      <tbody>{rows.map((c, i) => (
        <tr key={i}><td>{POLICY[c.policy]}</td><td>{MODE_LABEL[c.mode]}</td><td className="num">{num(c.pass_true_pct, 1)}%</td><td className="num">{num(c.pct_renewable, 1)}%</td>
          <td className="num">{num(c.kwh_grid, 2)}</td><td className="num">{num(c.throughput_pct)}%</td><td className="num">{num(c.wait_min_mean)} m</td><td className="num">{rp(c.cost_rp_per_m3)}</td></tr>))}</tbody>
    </table></div>
  );
}

/** Headline from the results: the hybrid case's actual grid use over the campaign. */
export function energyVerdict(hybrid: { kwh_grid: number }, days: number): string {
  if (hybrid.kwh_grid < 0.1) return "Dengan panel 200 Wp dan baterai 600 Wh, PLN nyaris tidak terpakai.";
  return `Dengan panel 200 Wp dan baterai 600 Wh, PLN tetap menambal ${num(hybrid.kwh_grid, 2)} kWh selama ${days} hari.`;
}

const SOURCES: { policy: string; name: string; desc: string; icon: JSX.Element; hi?: boolean }[] = [
  { policy: "solar_only", name: "Surya murni", desc: "Hanya panel surya dan baterai.", icon: <IconSolar /> },
  { policy: "solar_first", name: "Hibrida, surya dulu", desc: "Utamakan surya, PLN siap sebagai cadangan.", icon: <IconHybrid />, hi: true },
  { policy: "grid_only", name: "PLN saja", desc: "Hanya listrik PLN, tanpa panel surya.", icon: <IconTower /> },
];

function CostBars({ rows }: { rows: { name: string; value: number; color: string }[] }) {
  const ticks = niceTicks(Math.max(...rows.map((r) => r.value), 1), 4), top = ticks[ticks.length - 1];
  return (
    <div className="vbars" role="img" aria-label={`Biaya per meter kubik: ${rows.map((r) => `${r.name} ${rp(r.value)}`).join(", ")}`}>
      <div className="vbars-plot">
        {ticks.map((t) => <div className="vbars-tick" key={t} style={{ bottom: `${(100 * t) / top}%` }}><span>{rp(t)}</span></div>)}
        <div className="vbars-cols">
          {rows.map((r) => <div className="vbars-col" key={r.name}><div className="vbars-bar" style={{ height: `${(100 * r.value) / top}%`, background: r.color }}><b>{rp(r.value)}</b></div></div>)}
        </div>
      </div>
      <div className="vbars-x">{rows.map((r) => <span key={r.name}>{r.name}</span>)}</div>
    </div>
  );
}

function EnergyCases() {
  const q = useResult<Energy>("energy");
  const d = q.data;
  if (q.error) return <ErrorNote message={q.error} onRetry={q.reload} />;
  if (!d) return <><Empty>Belum ada hasil.</Empty><Runner kind="energy" onDone={q.reload} label="Jalankan perbandingan energi" /></>;
  const row = (policy: string) => d.cases[`${policy}/ai`];
  const colors = ["#2fa98a", "#0f7a5f", "#b5e0cc"];
  const best = Math.max(...SOURCES.map((x) => Math.round(row(x.policy).pass_true_pct)));
  return (
    <>
      <div className="banner"><span className="banner-ic"><IconCheck /></span><b>{energyVerdict(row("solar_first"), d.days)}</b></div>
      <div className="strat three">
        {SOURCES.map((x) => {
          const c = row(x.policy);
          return (
            <section key={x.policy} className={`strat-card ${x.hi ? "hi" : ""}`}>
              {x.hi && <span className="badge-rec"><IconStar />Rekomendasi</span>}
              <h3><span className="ic square">{x.icon}</span><span>{x.name}<small>{x.desc}</small></span></h3>
              <dl>
                <div><dt>Lolos</dt><dd className={Math.round(c.pass_true_pct) === best ? "top" : ""}>{num(c.pass_true_pct)}%</dd></div>
                <div><dt>Terbarukan</dt><dd>{num(c.pct_renewable)}%</dd></div>
                <div><dt>Biaya/m³</dt><dd>{rp(c.cost_rp_per_m3)}</dd></div>
              </dl>
            </section>
          );
        })}
      </div>
      <div className="e-grid">
        <section className="card">
          <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconCoins /></span>Perbandingan biaya per m³</h2></div>
          <CostBars rows={SOURCES.map((x, i) => ({ name: x.name, value: row(x.policy).cost_rp_per_m3, color: colors[i] }))} />
        </section>
        <section className="card">
          <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconBatch /></span>Ringkasan per sumber energi</h2></div>
          <div className="tbl-wrap"><table className="soft">
            <thead><tr><th>Sumber</th><th className="num">Lolos</th><th className="num">Terbarukan</th><th className="num">PLN (kWh)</th><th className="num">Batch selesai</th><th className="num">Biaya/m³</th></tr></thead>
            <tbody>{SOURCES.map((x) => { const c = row(x.policy); return (
              <tr key={x.policy} className={x.hi ? "hi" : ""}><td><span className="cell-ic">{x.icon}{x.name}</span></td><td className="num">{num(c.pass_true_pct)}%</td><td className="num">{num(c.pct_renewable)}%</td><td className="num">{num(c.kwh_grid, 2)}</td><td className="num">{num(c.throughput_pct)}%</td><td className="num">{rp(c.cost_rp_per_m3)}</td></tr>); })}</tbody>
          </table></div>
        </section>
      </div>
      <div className="note-bar">
        <span><IconInfo />Kampanye {d.days} hari, {d.per_day} batch per hari, irradiansi Solo 2024, strategi AI, hasil simulasi. Surya murni dan hibrida sama di sini karena PLN tidak sempat terpakai; bedanya terlihat pada panel kecil di tab berikutnya.</span>
        <Runner kind="energy" onDone={q.reload} label="Jalankan ulang" />
      </div>
      <details className="more">
        <summary>Semua strategi, termasuk waktu tetap</summary>
        <CaseTable rows={Object.values(d.cases)} />
      </details>
    </>
  );
}

const SIZE_ROWS: { key: string; policy: string; mode: string; name: string; icon: JSX.Element }[] = [
  { key: "solo", policy: "solar_only", mode: "feedback", name: "Surya murni", icon: <IconSun /> },
  { key: "hyb", policy: "solar_first", mode: "feedback", name: "Hibrida", icon: <IconHybrid /> },
  { key: "ai", policy: "solar_first", mode: "ai", name: "Hibrida + AI", icon: <IconBrain /> },
];

/** Red below 50% (fails most batches), then pale to deep green. Always light enough for dark text. */
export function heatColor(pct: number): string {
  if (pct < 50) return "#f9c6c3";
  if (pct < 80) return "#fbe3c5";
  const t = Math.min(1, (pct - 80) / 20);
  return `rgb(${Math.round(214 - t * 110)} ${Math.round(240 - t * 34)} ${Math.round(222 - t * 74)})`;
}

/** Headline from the selected numbers at the smallest panel. */
export function sizingVerdict(solo: number, hybrid: number): string {
  if (hybrid - solo >= 15) return "Panel kecil butuh PLN: surya murni sering gagal, hibrida menjaga mutu air.";
  return "Pada pilihan ini, surya murni dan hibrida memberi mutu air yang berdekatan.";
}

function Choice<T extends number>({ label, value, options, unit, onChange }: { label: string; value: T; options: T[]; unit?: string; onChange: (v: T) => void }) {
  return (
    <div className="choice"><span>{label}</span>
      <div className="seg" role="group" aria-label={label}>{options.map((o) => <button key={o} aria-pressed={o === value} onClick={() => onChange(o)}>{o}{unit ? ` ${unit}` : ""}</button>)}</div>
    </div>
  );
}

function SizingTable() {
  const q = useResult<Sizing>("sizing");
  const [batt, setBatt] = useState(150);
  const [perDay, setPerDay] = useState(3);
  const d = q.data;
  if (q.error) return <ErrorNote message={q.error} onRetry={q.reload} />;
  if (!d) return <><Empty>Belum ada hasil. Analisis ini butuh beberapa menit.</Empty><Runner kind="sizing" onDone={q.reload} label="Jalankan analisis ukuran" /></>;
  const uniq = (f: (r: SizeRow) => number) => [...new Set(d.rows.map(f))].sort((x, y) => x - y);
  const panels = uniq((r) => r.pv_wp);
  const cell = (rw: { policy: string; mode: string }, pv: number) => d.rows.find((r) => r.pv_wp === pv && r.battery_wh === batt && r.per_day === perDay && r.policy === rw.policy && r.mode === rw.mode);
  const small = panels[0];
  const hyb = cell(SIZE_ROWS[1], small), ai = cell(SIZE_ROWS[2], small), solo = cell(SIZE_ROWS[0], small);
  const trade: { name: string; unit: string; icon: JSX.Element; v: (r: SizeRow) => string }[] = [
    { name: "Waktu tunggu", unit: "menit", icon: <IconClock />, v: (r) => num(r.wait_min_mean) },
    { name: "Batch selesai", unit: "%", icon: <IconShield />, v: (r) => `${num(r.throughput_pct)}%` },
    { name: "Energi terbarukan", unit: "%", icon: <IconLeaf />, v: (r) => `${num(r.pct_renewable)}%` },
  ];
  return (
    <>
      <div className="banner-row">
        <div className="banner"><span className="banner-ic"><IconBulb /></span><b>{solo && hyb ? sizingVerdict(solo.pass_true_pct, hyb.pass_true_pct) : "Ukuran panel menentukan peran PLN."}</b></div>
        <div className="choices">
          <Choice label="Baterai" value={batt} options={uniq((r) => r.battery_wh)} unit="Wh" onChange={setBatt} />
          <Choice label="Batch per hari" value={perDay} options={uniq((r) => r.per_day)} onChange={setPerDay} />
        </div>
      </div>
      <div className="size-grid">
        <section className="card">
          <div className="card-head"><h2 className="with-ic"><span className="ic square pct">%</span><span>Persentase batch lolos<small>Kecil di tiap kotak: batch yang sempat selesai dari yang direncanakan.</small></span></h2></div>
          <div className="heat" style={{ gridTemplateColumns: `minmax(120px, 1.3fr) repeat(${panels.length}, minmax(0, 1fr))` }}>
            <div className="heat-h left">Strategi</div>
            {panels.map((p) => <div className="heat-h" key={p}>{p} Wp</div>)}
            {SIZE_ROWS.map((rw) => (
              <div className="heat-row" key={rw.key}>
                <div className="heat-name"><span className="ic square">{rw.icon}</span>{rw.name}</div>
                {panels.map((p) => { const c = cell(rw, p); return (
                  <div className="heat-cell" key={p} style={{ background: c ? heatColor(c.pass_true_pct) : undefined }}><b>{c ? `${num(c.pass_true_pct)}%` : "–"}</b>{c && <small>selesai {num(c.throughput_pct)}%</small>}</div>); })}
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconSwap /></span><span>Pertukaran pada panel {small} Wp<small>AI memulai lebih cepat, tetapi porsi terbarukan bisa turun.</small></span></h2></div>
          {hyb && ai ? (
            <div className="trade">
              <div /><div className="trade-h">Hibrida</div><div className="trade-h on">Hibrida + AI</div>
              {trade.map((t) => (
                <div className="trade-row" key={t.name}>
                  <div className="trade-name"><span className="ic square">{t.icon}</span><span>{t.name}<small>{t.unit}</small></span></div>
                  <div className="trade-v">{t.v(hyb)}</div><div className="trade-v on">{t.v(ai)}</div>
                </div>
              ))}
            </div>
          ) : <Empty>Tidak ada data untuk pilihan ini.</Empty>}
        </section>
      </div>
      <div className="note-bar">
        <span><IconInfo />Kampanye {d.days} hari, {d.seeds.length} pengulangan, irradiansi Solo 2024, hasil simulasi. Angka bergeser beberapa persen antar pengulangan.</span>
        <Runner kind="sizing" onDone={q.reload} label="Jalankan ulang" />
      </div>
    </>
  );
}

/** Which guessed parameters change the conclusions? Grouped from the one-at-a-time sweep. */
function sensGroups(rows: SensRow[]) {
  const base = rows.find((r) => r.param === null);
  const groups = new Map<string, SensRow[]>();
  for (const r of rows) if (r.param && r.param !== "combo") groups.set(r.label, [...(groups.get(r.label) ?? []), r]);
  return { base, groups: [...groups.entries()].map(([label, rs]) => {
    const passes = [...rs.map((r) => r.feedback.pass), base?.feedback.pass ?? 0];
    const worst = rs.reduce((a, b) => (b.feedback.pass < a.feedback.pass ? b : a));
    return { label, lo: Math.min(...passes), hi: Math.max(...passes), worst };
  }).sort((a, b) => a.lo - b.lo) };
}

const RANGE_LABEL: Record<string, string> = { "reactor.k_d_Fe": "Laju warna" };
const VERDICT_NAME: Record<string, string> = { "sensor.eps_scale": "kalibrasi sensor", "reactor.k_d_Fe": "laju hilang warna", "reactor.recalcitrant_scale": "fraksi warna membandel" };

/** Headline for the assumptions tab, read from the sweep: the guess whose worst case hurts most. */
export function robustVerdict(param: string, label: string, mult: number, basePass: number, worstPass: number) {
  const name = VERDICT_NAME[param] ?? label.toLowerCase();
  if (worstPass >= basePass - 5) return `Tidak ada satu tebakan yang menjatuhkan mutu banyak: batch lolos tetap sekitar ${num(worstPass)}%.`;
  return `Bila ${name} meleset ke ${num(mult, 1)}×, batch lolos jatuh dari ${num(basePass)}% ke ${num(worstPass)}%. Ukur ini lebih dulu saat uji bench.`;
}

function reactorName(label: string) {
  const m = /reaktor (\w+)(?: \((.+)\))?/.exec(label);
  return { name: `Reaktor ${m?.[1] ?? label}`, spec: m?.[2] };
}

function Robustness() {
  const s = useResult<Sens>("sensitivity");
  const r = useResult<Rob>("robustness");
  const d = s.data;
  const g = d ? sensGroups(d.rows) : null;
  const top = g?.groups[0];
  const base = g?.base?.feedback.pass ?? 0;
  const combos = d?.rows.filter((x) => x.param === "combo") ?? [];
  const loop = r.data?.closed_loop;
  // The worlds where correction has something to correct; the full list stays in the details below.
  const pairs = loop ? loop.calibration.filter((x) => (x.off.mape ?? 0) > 30).sort((a, b) => (b.off.mape ?? 0) - (a.off.mape ?? 0)) : [];
  const errMax = Math.max(100, ...pairs.map((x) => x.off.mape ?? 0));
  if (s.error) return <ErrorNote message={s.error} onRetry={s.reload} />;
  if (!d || !g) return <><Empty>Belum ada hasil.</Empty><Runner kind="sensitivity" onDone={s.reload} label="Jalankan analisis" /></>;
  return (
    <>
      {top && g.base && (
        <div className="banner dark"><span className="banner-ic"><IconShield /></span>
          <b>{robustVerdict(top.worst.param ?? "", top.label, top.worst.mult, base, top.worst.feedback.pass)}</b></div>
      )}
      <div className="rob-grid">
        <section className="card">
          <div className="card-head rob-head">
            <h2 className="with-ic"><span className="ic square"><IconTrend /></span><span>Rentang batch lolos bila satu tebakan meleset<small>Satu parameter diubah, lainnya tetap. Strategi umpan balik sensor.</small></span></h2>
          </div>
          <p className="rob-legend"><i />Nilai dasar ({num(base)}%)</p>
          <div className="range" role="list">
            {g.groups.map((x) => (
              <div className="range-row" role="listitem" key={x.label}>
                <span>{RANGE_LABEL[x.worst.param ?? ""] ?? x.label}</span>
                <div className="range-track">
                  <div className={`range-seg ${x.lo < 50 ? "bad" : ""}`} style={{ left: `${x.lo}%`, width: `${x.hi - x.lo}%` }} />
                  <div className="range-tick" style={{ left: `${base}%` }} />
                </div>
                <span className="num">{num(x.lo)} – {num(x.hi)}%</span>
              </div>
            ))}
            <div className="range-row range-axis" aria-hidden="true">
              <span />
              <div className="range-ticks">{[0, 25, 50, 75, 100].map((v) => <i key={v} style={{ left: `${v}%` }}>{v}%</i>)}</div>
              <span />
            </div>
            <div className="range-row range-title" aria-hidden="true"><span /><div>Persentase batch lolos</div><span /></div>
          </div>
        </section>
        <div className="rob-side">
          {pairs.length > 0 && (
            <section className="card">
              <div className="card-head rob-head">
                <h2 className="with-ic"><span className="ic square"><IconBrain /></span><span>Koreksi per unit: galat prediksi<small>Selisih perkiraan muatan dengan yang benar-benar dibutuhkan.</small></span></h2>
                <p className="pair-legend"><span><i className="off" />Tanpa koreksi</span><span><i className="on" />Dengan koreksi</span></p>
              </div>
              <div className="pairs">
                {pairs.map((x) => (
                  <div className="pair" key={x.world}>
                    <span>{x.world}</span>
                    <div className="pair-bars">
                      <div><i className="off" style={{ width: `${(x.off.mape ?? 0) / errMax * 88}%` }} /><b>{num(x.off.mape)}%</b></div>
                      <div><i className="on" style={{ width: `${(x.on.mape ?? 0) / errMax * 88}%` }} /><b>{num(x.on.mape)}%</b></div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="hint">Perkiraan waktu jadi lebih tepat. Mutu dan energi hampir tidak berubah, karena sensor tetap yang memutuskan kapan berhenti.</p>
            </section>
          )}
          {combos.length > 0 && (
            <section className="card">
              <div className="card-head rob-head">
                <h2 className="with-ic"><span className="ic square"><IconBolt /></span><span>Kebutuhan muatan tinggi ±7×<small>Bila kebutuhan muatan setinggi yang tersirat di literatur.</small></span></h2>
              </div>
              <div className="demand">
                {combos.map((c) => {
                  const n = reactorName(c.label);
                  return (
                    <div className="demand-tile" key={c.label}>
                      <h3>{n.name}{n.spec && <small>{n.spec}</small>}</h3>
                      <dl>
                        <div><dt>Lolos</dt><dd className="demand-pass" style={{ background: heatColor(c.feedback.pass) }}>{num(c.feedback.pass)}%</dd></div>
                        <div><dt>Energi</dt><dd>{num(c.feedback.kwh_m3, 1)}<small>kWh/m³</small></dd></div>
                      </dl>
                    </div>
                  );
                })}
              </div>
              <p className="hint">±7× adalah turunan kami dari Fadzli dkk. 2024 (elektroda Al, pH 3), bukan pengukuran elektroda besi pada limbah Laweyan.</p>
            </section>
          )}
        </div>
      </div>
      <div className="note-bar">
        <span><IconInfo />Menguji asumsi, bukan bukti akurasi alat. {d.n} batch per kondisi, hasil simulasi.</span>
        <Runner kind="sensitivity" onDone={s.reload} label="Jalankan ulang" />
      </div>
      {r.error && <ErrorNote message={r.error} onRetry={r.reload} />}
      {r.data && (
        <details className="more">
          <summary>Rincian koreksi per unit, warna mentok, dan galat model AI</summary>
          {loop && <>
            <h3 className="more-h">Koreksi per unit di kontroler: mati → hidup</h3>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Kondisi</th><th className="num">Galat prediksi</th><th className="num">Lolos</th><th className="num">kWh/m³</th></tr></thead>
              <tbody>{loop.calibration.map((x) => <tr key={x.world}><td>{x.world}</td><td className="num">{num(x.off.mape)} → <b>{num(x.on.mape)}</b>%</td><td className="num">{num(x.off.pass_pct)} → {num(x.on.pass_pct)}%</td><td className="num">{num(x.off.kwh_m3, 2)} → {num(x.on.kwh_m3, 2)}</td></tr>)}</tbody>
            </table></div>
            <h3 className="more-h">Deteksi warna mentok: mati → hidup</h3>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Kondisi</th><th className="num">Dihentikan</th><th className="num">Lolos</th><th className="num">kWh/m³</th><th className="num">Waktu proses</th></tr></thead>
              <tbody>{loop.plateau.map((x) => <tr key={x.world}><td>{x.world}</td><td className="num">{num(x.on.plateau_stops, 1)}</td><td className="num">{num(x.off.pass_pct)} → {num(x.on.pass_pct)}%</td><td className="num">{num(x.off.kwh_m3, 2)} → {num(x.on.kwh_m3, 2)}</td><td className="num">{num(x.off.run_min)} → {num(x.on.run_min)} m</td></tr>)}</tbody>
            </table></div>
            <p className="hint">Dihentikan: rata-rata batch yang berhenti karena warna mentok, dari {loop.n} batch berturut-turut.</p>
          </>}
          <h3 className="more-h">Galat model AI pada kondisi yang tidak pernah dilihat saat latihan</h3>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Kondisi uji</th><th className="num">Fisika saja</th><th className="num">Dilatih satu kondisi</th><th className="num">Dilatih kondisi acak</th><th className="num">Acak + koreksi per unit</th><th className="num">Rentang 80% mencakup</th></tr></thead>
            <tbody>{r.data.rows.map((x) => <tr key={x.world}><td>{x.world}</td><td className="num">{num(x.mape_physics)}%</td><td className="num">{num(x.mape_single)}%</td><td className="num">{num(x.mape_random)}%</td><td className="num">{num(x.mape_random_corrected)}%</td><td className="num">{num(x.cover80_random)}%</td></tr>)}</tbody>
          </table></div>
          <p className="hint">Koreksi per unit: prediksi dikali galat rata-rata 5 batch terakhir unit itu, dinilai mulai batch ke-4. {r.data.n_train} batch latih, {r.data.n_test} batch uji per kondisi. Semua simulasi.</p>
        </details>
      )}
    </>
  );
}
