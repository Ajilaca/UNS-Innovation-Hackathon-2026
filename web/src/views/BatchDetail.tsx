import { api } from "../api";
import { LineChart, logTop, niceTicks } from "../components/LineChart";
import { Card, Cups, Empty, ErrorNote, Kpis, ModePill, StatusPill } from "../components/ui";
import { dur, flagText, MODE_LABEL, num, rp, SOURCE_LABEL, when } from "../format";
import { usePoll } from "../hooks";
import type { Batch, Telemetry } from "../types";

export function BatchDetail({ id }: { id: string }) {
  const q = usePoll(() => api<{ batch: Batch; points: Telemetry[] }>(`/api/batches/${encodeURIComponent(id)}`), null, [id]);
  if (q.error && !q.data) return <><a className="btn text" href="#/batch" style={{ justifySelf: "start" }}>← Semua batch</a><ErrorNote message={`Batch tidak ditemukan atau gagal dimuat. ${q.error}`} onRetry={q.reload} /></>;
  if (!q.data) return <h1 style={{ fontSize: 22 }}>Memuat batch…</h1>;
  const { batch: b, points } = q.data;
  const t0 = points[0]?.ts ?? b.ts_start;
  const xs = (p: Telemetry) => (p.ts - t0) / 60;
  const xMax = Math.max(...points.map(xs), 10);
  const xTicks = Array.from({ length: Math.floor(xMax / 20) + 1 }, (_, i) => ({ x: i * 20, label: `${i * 20}` }));
  const color = points.map((p): [number, number | null] => [xs(p), p.color_est_ptco ?? null]);
  const cur = points.map((p): [number, number | null] => [xs(p), p.I_A]);
  const volt = points.map((p): [number, number | null] => [xs(p), p.U_V > 0 ? p.U_V : null]);
  const yTop = logTop(color.map((c) => c[1]), b.target_ptco);
  const iMax = Math.max(...points.map((p) => p.I_A), 1), uMax = Math.max(...points.map((p) => p.U_V), 1);
  const iT = niceTicks(Math.ceil(iMax), 4), uT = niceTicks(Math.ceil(uMax), 4);
  const diff = b.q_pred ? ((b.q_CperL - b.q_pred) / b.q_pred) * 100 : null;
  return (
    <>
      <a className="btn text" href="#/batch" style={{ justifySelf: "start", marginLeft: -8 }}>← Semua batch</a>
      <div className="title-row">
        <div>
          <h1><span style={{ fontFamily: "var(--mono)", fontSize: 18 }}>{b.batch_id}</span> <StatusPill status={b.status} /> <Cups from={b.color0_est} to={b.color_end_est} /></h1>
          <p className="finding">Selesai {when(b.ts_end)} WIB · {num(b.V_L)} L · <ModePill mode={b.mode} /> · {SOURCE_LABEL[b.source]}</p>
        </div>
      </div>
      <Kpis items={[
        { label: "Warna awal → akhir", value: `${num(b.color0_est)} → ${num(b.color_end_est)}`, unit: "Pt-Co", lead: true, sub: `Target ${num(b.target_ptco)} Pt-Co` },
        { label: "Muatan listrik", value: num(b.q_CperL), unit: "C/L", sub: b.q_pred ? `Prediksi ${num(b.q_pred)} (${diff! >= 0 ? "+" : "−"}${num(Math.abs(diff!))}%)` : "Tanpa prediksi" },
        { label: "Energi", value: num(b.kwh_per_m3, 2), unit: "kWh/m³", sub: `${num(b.kwh, 3)} kWh reaktor` },
        { label: "Waktu proses", value: dur(b.run_s), sub: `Total ${dur(b.total_s)} termasuk endap` },
        { label: "Biaya", value: rp(b.cost_rp_per_m3).replace("Rp", ""), unit: "Rp/m³", sub: `${num(b.pct_renewable)}% energi terbarukan` },
      ]} />
      <div className="grid g-main">
        <Card title="Warna air terhadap waktu">
          {points.length ? (
            <LineChart ariaLabel="Warna air dalam Pt-Co" series={[{ name: "Warna", points: color }]} xMin={0} xMax={xMax} yMin={100} yMax={yTop} log
              yTicks={[100, 300, 1000, 3000, 10000].filter((v) => v <= yTop)} xTicks={xTicks} refs={[{ y: b.target_ptco, label: `Target ${num(b.target_ptco)}` }]}
              fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v)}`} unit="Pt-Co" height={260} />
          ) : <Empty>Data telemetri batch ini tidak tersimpan.</Empty>}
        </Card>
        <Card title="Ringkasan">
          <dl className="kv">
            <div><dt>Besi terlarut</dt><dd className="num">{num(b.electrode_g, 1)} g</dd></div>
            <div><dt>Lumpur (B3)</dt><dd className="num">{num(b.sludge_kg, 2)} kg</dd></div>
            <div><dt>Pembalikan polaritas</dt><dd className="num">{num(b.reversals)}×</dd></div>
            <div><dt>Proses ulang</dt><dd className="num">{num(b.retries)}×</dd></div>
            <div><dt>Surya / baterai / PLN</dt><dd className="num">{num(b.kwh_pv, 3)} / {num(b.kwh_batt, 3)} / {num(b.kwh_grid, 3)} kWh</dd></div>
            <div><dt>Menunggu daya</dt><dd className="num">{dur(b.wait_s)}</dd></div>
            <div><dt>Mode</dt><dd>{MODE_LABEL[b.mode ?? ""] ?? "–"}</dd></div>
            {b.calib_factor != null && b.mode === "ai" && <div><dt>Koreksi per unit</dt><dd className="num">×{num(b.calib_factor, 2)}</dd></div>}
            {b.scenario && <div><dt>Simulasi</dt><dd>{b.scenario}</dd></div>}
          </dl>
        </Card>
      </div>
      <div className="grid g-2">
        <Card title="Arus sel"><LineChart ariaLabel="Arus sel dalam ampere" series={[{ name: "Arus", points: cur }]} xMin={0} xMax={xMax} yMin={0} yMax={iT[iT.length - 1]} yTicks={iT} xTicks={xTicks} fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v)}`} unit="A" height={200} /></Card>
        <Card title="Tegangan sel"><LineChart ariaLabel="Tegangan sel dalam volt" series={[{ name: "Tegangan", points: volt }]} xMin={0} xMax={xMax} yMin={0} yMax={uT[uT.length - 1]} yTicks={uT} xTicks={xTicks} fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v)}`} unit="V" height={200} /></Card>
      </div>
      <div className="grid g-2">
        <Card title="Catatan kontroler">
          {b.flags.length === 0 ? <Empty>Tidak ada kejadian khusus selama batch.</Empty> : <ul className="log">{b.flags.map((f) => <li key={f}><span>{flagText(f)}</span></li>)}</ul>}
        </Card>
        {b.truth ? (
          <Card title="Kebenaran fisik (hanya simulasi)">
            <dl className="kv">
              <div><dt>Warna akhir sebenarnya</dt><dd className="num">{num(b.truth.color_end)} Pt-Co</dd></div>
              <div><dt>Warna akhir menurut sensor</dt><dd className="num">{num(b.color_end_est)} Pt-Co</dd></div>
              <div><dt>Lolos sebenarnya</dt><dd>{b.truth.pass ? "Ya" : "Tidak"}</dd></div>
              <div><dt>COD awal → akhir</dt><dd className="num">{num(b.truth.cod0)} → {num(b.truth.cod_end)} mg/L</dd></div>
              <div><dt>Jenis pewarna</dt><dd>{b.truth.dye.replaceAll("_", " ")}</dd></div>
            </dl>
            <p className="hint" style={{ marginTop: 10 }}>Perangkat asli tidak pernah mengirim blok ini.</p>
          </Card>
        ) : <Card title="Verifikasi"><Empty>Warna akhir adalah estimasi sensor. Verifikasi dengan uji laboratorium (Pt-Co, COD, TSS).</Empty></Card>}
      </div>
    </>
  );
}
