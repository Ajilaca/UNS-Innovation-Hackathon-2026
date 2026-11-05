import { useState } from "react";
import { api, getSession } from "../api";
import { IconBolt, IconInfo, IconSensor, IconTrend } from "../components/icons";
import { Bars, Empty, ErrorNote, Kpis } from "../components/ui";
import { num } from "../format";
import { usePoll } from "../hooks";
import { useJob } from "../hooks.job";

type Meta = { trained?: boolean; n?: number; mape_ml?: number; mape_physics?: number; r2_ln_oof?: number; importance?: Record<string, number>; scatter?: { obs: number; pred: number }[]; q_obs_median?: number; q_obs_p90?: number };
type Pred = { q: number; q_lo: number; q_hi: number; minutes: number; minutes_lo: number; minutes_hi: number; source: string };
const FEAT: Record<string, string> = { ln_ratio: "Warna awal terhadap target", ph: "pH", ec_k: "Konduktivitas", temp: "Suhu", ln_turb: "Kekeruhan", r_rel: "Rasio kanal merah", b_rel: "Rasio kanal biru", ln_c0: "Warna awal" };

export function Model() {
  const q = usePoll(() => api<Meta>("/api/model"), null);
  const m = q.data;
  const isAdmin = getSession()?.role === "admin";
  const job = useJob("train", q.reload);
  const retrain = isAdmin && (
    <div className="model-bar">
      <button className="btn primary" disabled={job.running} onClick={() => job.start("?n=1200")}>{job.running ? `Melatih… ${num(100 * (job.job?.progress ?? 0))}%` : "Latih ulang (±1 menit)"}</button>
    </div>
  );
  return (
    <>
      <h1 className="sr-only">Model AI</h1>
      {q.error && <ErrorNote message={q.error} onRetry={q.reload} />}
      {m?.trained ? (
        <>
          <section className="summary inline"><Kpis items={[
            { label: "Galat prediksi model", value: num(100 * (m.mape_ml ?? 0), 1), unit: "%", lead: true, sub: "validasi silang 5-lipatan" },
            { label: "Galat fisika saja", value: num(100 * (m.mape_physics ?? 0), 1), unit: "%", sub: "tanpa pembelajaran" },
            { label: "Batch latih", value: num(m.n), sub: "simulasi, lolos verifikasi sensor" },
            { label: "Median muatan", value: num(m.q_obs_median), unit: "C/L", sub: `P90 ${num(m.q_obs_p90)} C/L` },
          ]} />{retrain}</section>
          <div className="grid g-2" style={{ alignItems: "stretch" }}>
            <section className="card">
              <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconSensor /></span><span>Fitur yang paling berpengaruh<small>Bagian mana dari pembacaan sensor yang paling menentukan perkiraan.</small></span></h2></div>
              <div className="model-bars"><Bars hueIndex={0} rows={Object.entries(m.importance ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: FEAT[k] ?? k, value: v, text: `${num(100 * v)}%` }))} /></div>
            </section>
            <section className="card">
              <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconTrend /></span><span>Prediksi terhadap kenyataan<small>Titik yang dekat garis putus-putus berarti perkiraan tepat.</small></span></h2></div>
              <Scatter pts={m.scatter ?? []} />
            </section>
          </div>
        </>
      ) : <>{retrain}<Empty>Latih model dulu untuk melihat metrik.</Empty></>}
      <WhatIf />
      <div className="note-bar"><span><IconInfo />Dilatih dari batch simulasi milik sendiri, bukan data lapangan. Setelah ada data uji bench dan batch dari reaktor asli, model dilatih ulang dari data tersebut. Hasil di sini belum membuktikan akurasi di lapangan.</span></div>
    </>
  );
}

function Scatter({ pts }: { pts: { obs: number; pred: number }[] }) {
  if (!pts.length) return <Empty>Tidak ada data.</Empty>;
  const W = 460, H = 270, L = 46, B = 46, T = 26, R = 30;
  const max = Math.ceil(Math.max(...pts.flatMap((p) => [p.obs, p.pred])) / 200) * 200;
  const sx = (v: number) => L + (v / max) * (W - L - R), sy = (v: number) => H - B - (v / max) * (H - B - T);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 520, display: "block", margin: "0 auto" }} role="img" aria-label="Muatan prediksi terhadap muatan sebenarnya">
      {ticks.map((t) => <g key={t}><line className="grid-l" x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} /><text x={L - 6} y={sy(t) + 4} textAnchor="end">{num(t)}</text><text x={sx(t)} y={H - B + 18} textAnchor="middle">{num(t)}</text></g>)}
      <line className="ref" x1={sx(0)} y1={sy(0)} x2={sx(max)} y2={sy(max)} />
      {pts.map((p, i) => <circle key={i} cx={sx(p.obs)} cy={sy(p.pred)} r={2.5} fill="var(--chart-1)" opacity={0.55} />)}
      <text x={W - R} y={H - 6} textAnchor="end">muatan sebenarnya (C/L)</text>
      <text x={L - 38} y={12}>muatan prediksi (C/L)</text>
    </svg>
  );
}

function WhatIf() {
  const [f, setF] = useState({ color0_ptco: 2500, ph: 9.5, ec_uScm: 3000, temp_C: 31, turb_ntu: 800 });
  const [r, setR] = useState<Pred | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setErr(null); try { setR(await api<Pred>("/api/predict", { method: "POST", json: f })); } catch (e) { setErr(e instanceof Error ? e.message : "Gagal"); } };
  const fld = (k: keyof typeof f, label: string, unit: string) => (
    <label className="field"><span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}><input className="input num" type="number" step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} style={{ width: "100%" }} /><span className="unit">{unit}</span></span></label>
  );
  return (
    <section className="card">
      <div className="card-head"><h2 className="with-ic"><span className="ic square"><IconBolt /></span><span>Coba prediksi dosis<small>Isi kondisi limbah awal, lalu lihat muatan listrik yang diperkirakan.</small></span></h2></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", alignItems: "end" }}>
        {fld("color0_ptco", "Warna awal", "Pt-Co")}{fld("ph", "pH", "")}{fld("ec_uScm", "Konduktivitas", "µS/cm")}{fld("temp_C", "Suhu", "°C")}{fld("turb_ntu", "Kekeruhan", "NTU")}
        <button className="btn primary" onClick={go}>Hitung prediksi</button>
      </div>
      {err && <p className="hint" role="alert" style={{ color: "var(--negative)", marginTop: 10 }}>{err}</p>}
      {r && <div className="whatif-out">
        <div className="demand-tile"><h3>Muatan dibutuhkan</h3><dl><div><dd>{num(r.q)}<small>C/L</small></dd><dt>rentang {num(r.q_lo)}–{num(r.q_hi)}</dt></div></dl></div>
        <div className="demand-tile"><h3>Waktu proses<small>pada 5 A, 50 L</small></h3><dl><div><dd>±{num(r.minutes)}<small>menit</small></dd><dt>rentang {num(r.minutes_lo)}–{num(r.minutes_hi)}</dt></div></dl></div>
        <p className="hint">Sumber: {r.source === "ml" ? "model terlatih" : "fisika saja"}. Jenis pewarna tidak diketahui di sini, jadi rasio kanal warna diisi nilai tengah.</p>
      </div>}
    </section>
  );
}
