import { api } from "../api";
import { IconBolt, IconClock, IconCoins, IconDrop, IconFlask, IconInfo, IconLayers, IconTrend, IconWave } from "../components/icons";
import { LineChart, niceTicks, type Pt } from "../components/LineChart";
import { Card, Empty, ErrorNote, Kpis, StatusPill } from "../components/ui";
import { waterFromPtco } from "../components/water";
import { dur, flagText, MODE_LABEL, num, rp, SOURCE_LABEL, when } from "../format";
import { usePoll } from "../hooks";
import type { Batch, Telemetry } from "../types";

/** Voltage band below which a change is treated as noise when drawing the line. */
const U_BAND_V = 1;

/**
 * Flatten a voltage trace for display. Within each run of samples the line holds
 * one value (the run's mean) and only moves when a reading departs from it by at
 * least `band` volts, so sensor noise and the small sawtooth from polarity
 * reversals do not show up as spikes.
 */
export function flatSteps(points: Pt[], band = U_BAND_V): Pt[] {
  const out: Pt[] = [];
  let i = 0;
  while (i < points.length) {
    if (points[i][1] == null) { out.push(points[i]); i++; continue; }
    let j = i;
    while (j < points.length && points[j][1] != null) j++;
    const seg = points.slice(i, j) as [number, number][];
    let held = seg.reduce((a, p) => a + p[1], 0) / seg.length;
    for (const [x, y] of seg) {
      if (Math.abs(y - held) >= band) held = y;
      out.push([x, held]);
    }
    i = j;
  }
  return out;
}

export function BatchDetail({ id }: { id: string }) {
  const q = usePoll(() => api<{ batch: Batch; points: Telemetry[] }>(`/api/batches/${encodeURIComponent(id)}`), null, [id]);
  if (q.error && !q.data) return <><a className="btn text" href="#/batch" style={{ justifySelf: "start" }}>← Semua batch</a><ErrorNote message={`Batch tidak ditemukan atau gagal dimuat. ${q.error}`} onRetry={q.reload} /></>;
  if (!q.data) return <h1 style={{ fontSize: 22 }}>Memuat batch…</h1>;
  const { batch: b, points } = q.data;
  const t0 = points[0]?.ts ?? b.ts_start;
  const xs = (p: Telemetry) => (p.ts - t0) / 60;
  const xMax = Math.max(...points.map(xs), 10);
  const xTicks = Array.from({ length: Math.floor(xMax / 20) + 1 }, (_, i) => ({ x: i * 20, label: `${i * 20}` }));
  const color = points.map((p): Pt => [xs(p), p.color_est_ptco ?? null]);
  const cur = points.map((p): Pt => [xs(p), p.I_A]);
  const voltRaw = points.map((p): Pt => [xs(p), p.U_V > 0 ? p.U_V : null]);
  const volt = flatSteps(voltRaw);
  const uVals = voltRaw.flatMap((p) => (p[1] == null ? [] : [p[1]]));
  const cMax = Math.max(...color.map((c) => c[1] ?? 0), b.target_ptco * 1.5);
  const cT = niceTicks(cMax * 1.08, 4);
  const iMax = Math.max(...points.map((p) => p.I_A), 1), uMax = Math.max(...uVals, 1);
  const iT = niceTicks(Math.ceil(iMax * 1.2), 4), uT = niceTicks(Math.ceil(uMax * 1.6), 4);
  const diff = b.q_pred ? ((b.q_CperL - b.q_pred) / b.q_pred) * 100 : null;
  const lastColor = [...color].reverse().find((c) => c[1] != null) as [number, number] | undefined;
  const info = `Mode ${MODE_LABEL[b.mode ?? ""] ?? "–"} · sumber ${SOURCE_LABEL[b.source] ?? b.source}. Warna akhir diperkirakan dari sensor optik.`;
  return (
    <>
      <a className="btn text" href="#/batch" style={{ justifySelf: "start", marginLeft: -8 }}>← Semua batch</a>
      <div className="bd-head">
        <h1>
          <span>{b.batch_id}</span>
          <StatusPill status={b.status} />
          <span className="bd-swatch" style={{ background: waterFromPtco(b.color_end_est) }} title={`Warna air akhir ±${num(b.color_end_est)} Pt-Co`} aria-label={`Warna air akhir ±${num(b.color_end_est)} Pt-Co`} role="img" />
          <button type="button" className="bd-info" title={info} aria-label={info}><IconInfo /></button>
        </h1>
        <p>Selesai: {when(b.ts_end)} WIB <i>•</i> Air: <b>{SOURCE_LABEL[b.source] ?? b.source}</b> <i>•</i> Volume: {num(b.V_L)} L</p>
      </div>
      <Kpis items={[
        { icon: <IconDrop />, label: "Warna awal → akhir", value: `${num(b.color0_est)} → ${num(b.color_end_est)}`, unit: "Pt-Co", sub: `Target ≤ ${num(b.target_ptco)} Pt-Co` },
        { icon: <IconLayers />, label: "Muatan listrik", value: num(b.q_CperL), unit: "C/L", sub: b.q_pred ? `Prediksi: ${num(b.q_pred)} C/L (${diff! >= 0 ? "+" : "−"}${num(Math.abs(diff!))}%)` : "Tanpa prediksi" },
        { icon: <IconBolt />, label: "Energi", value: num(b.kwh_per_m3, 2), unit: "kWh/m³", sub: `${num(b.kwh, 3)} kWh reaktor` },
        { icon: <IconClock />, label: "Waktu proses", value: dur(b.run_s), sub: `Total: ${dur(b.total_s)} termasuk endap` },
        { icon: <IconCoins />, label: "Biaya", value: rp(b.cost_rp_per_m3).replace("Rp", ""), unit: "Rp/m³", sub: `${num(b.pct_renewable)}% energi terbarukan` },
      ]} />
      <div className="grid g-main">
        <Card title="Warna air terhadap waktu" icon={<IconTrend />} className="bd-fill">
          {points.length ? (
            <LineChart ariaLabel="Warna air dalam Pt-Co" series={[{ name: "Warna", points: color }]} xMin={0} xMax={xMax} yMin={0} yMax={cT[cT.length - 1]}
              yTicks={cT} xTicks={xTicks} refs={[{ y: b.target_ptco, label: "" }]}
              legend={[{ label: "Warna (Pt-Co)" }, { label: `Target (${num(b.target_ptco)} Pt-Co)`, dashed: true }]}
              marks={lastColor ? [{ x: lastColor[0], y: lastColor[1], label: `${num(lastColor[1])} Pt-Co`, chip: true, color: "var(--chart-1)" }] : undefined}
              xTitle="Waktu (menit)" yTitle="Warna (Pt-Co)"
              fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v)}`} unit="Pt-Co" height={260} fill />
          ) : <Empty>Data telemetri batch ini tidak tersimpan.</Empty>}
        </Card>
        <Card title="Ringkasan" icon={<IconLayers />}>
          <dl className="kv">
            <div><dt>Besi terlarut</dt><dd className="num">{num(b.electrode_g, 1)} g</dd></div>
            <div><dt>Lumpur (B3)</dt><dd className="num">{num(b.sludge_kg, 2)} kg</dd></div>
            <div><dt>Pembalikan polaritas</dt><dd className="num">{num(b.reversals)}×</dd></div>
            <div><dt>Proses ulang</dt><dd className="num">{num(b.retries)}×</dd></div>
            <div><dt>Surya / baterai / PLN</dt><dd className="num">{num(b.kwh_pv, 3)} / {num(b.kwh_batt, 3)} / {num(b.kwh_grid, 3)} kWh</dd></div>
            <div><dt>Menunggu daya</dt><dd className="num">{dur(b.wait_s)}</dd></div>
            <div><dt>Metode</dt><dd><b>{MODE_LABEL[b.mode ?? ""] ?? "–"}</b></dd></div>
            {b.calib_factor != null && b.mode === "ai" && <div><dt>Koreksi per unit</dt><dd className="num">×{num(b.calib_factor, 2)}</dd></div>}
            {b.scenario && <div><dt>Simulasi</dt><dd>{b.scenario}</dd></div>}
            <div className="kv-note">
              <dt>Catatan kontroler</dt>
              <dd>{b.flags.length === 0 ? <span className="muted">Tidak ada kejadian khusus</span> : <ul>{b.flags.map((f) => <li key={f}>{flagText(f)}</li>)}</ul>}</dd>
            </div>
          </dl>
        </Card>
      </div>
      <div className="grid g-2 bd-row">
        <Card title="Arus sel" icon={<IconBolt />}>
          <LineChart ariaLabel="Arus sel dalam ampere" series={[{ name: "Arus", points: cur }]} xMin={0} xMax={xMax} yMin={0} yMax={iT[iT.length - 1]} yTicks={iT} xTicks={xTicks}
            xTitle="Waktu (menit)" yTitle="Arus (A)" fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v)}`} unit="A" height={200} />
        </Card>
        <Card title="Tegangan sel" icon={<IconWave />}>
          <LineChart ariaLabel="Tegangan sel dalam volt" series={[{ name: "Tegangan", points: volt }]} xMin={0} xMax={xMax} yMin={0} yMax={uT[uT.length - 1]} yTicks={uT} xTicks={xTicks}
            xTitle="Waktu (menit)" yTitle="Tegangan (V)" fmtY={(v) => num(v, 1)} fmtX={(v) => `menit ${num(v)}`} unit="V" height={200}
            summary={uVals.length ? `Tegangan terukur ${num(Math.min(...uVals), 1)} sampai ${num(Math.max(...uVals), 1)} V.` : undefined} />
          {uVals.length > 0 && <p className="hint bd-hint">Perubahan di bawah {U_BAND_V} V diratakan. Terukur {num(Math.min(...uVals), 1)}–{num(Math.max(...uVals), 1)} V, rata-rata {num(uVals.reduce((a, v) => a + v, 0) / uVals.length, 1)} V.</p>}
        </Card>
      </div>
      {b.truth ? (
        <Card title="Keberhasilan (hanya simulasi)" icon={<IconFlask />}>
          <dl className="kv kv-2">
            <div><dt>Warna akhir sebenarnya</dt><dd className="num">{num(b.truth.color_end)} Pt-Co</dd></div>
            <div><dt>Warna akhir menurut sensor</dt><dd className="num">{num(b.color_end_est)} Pt-Co</dd></div>
            <div><dt>Lolos sebenarnya</dt><dd>{b.truth.pass ? "Ya" : "Tidak"}</dd></div>
            <div><dt>COD awal → akhir</dt><dd className="num">{num(b.truth.cod0)} → {num(b.truth.cod_end)} mg/L</dd></div>
            <div><dt>Jenis pewarna</dt><dd>{b.truth.dye.replaceAll("_", " ")}</dd></div>
            <div><dt>Asal data</dt><dd>Hanya simulator; perangkat asli tidak mengirim blok ini</dd></div>
          </dl>
        </Card>
      ) : <Card title="Verifikasi" icon={<IconFlask />}><Empty>Warna akhir adalah estimasi sensor. Verifikasi dengan uji laboratorium (Pt-Co, COD, TSS).</Empty></Card>}
    </>
  );
}
