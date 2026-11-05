import { useMemo, useState } from "react";
import { api, getSession } from "../api";
import { Donut } from "../components/Donut";
import { IconBolt, IconCheck, IconClock, IconDrop, IconFlame, IconLayers, IconPlay, IconSparkle, IconSun, IconBattery, IconPlug, IconWave, IconWrench, IconPulse } from "../components/icons";
import { LineChart, niceTicks } from "../components/LineChart";
import { SystemScene } from "../components/SystemScene";
import { ErrorNote } from "../components/ui";
import { logProgress } from "../components/water";
import { dur, hm, num, SOURCE_LABEL, STATE_LABEL, STATUS_LABEL, when } from "../format";
import { usePoll } from "../hooks";
import { energySplit, headline, tips, type RecIcon } from "../recommend";
import type { Batch, EventItem, Presets, Scenario, SimStatus, Telemetry, UnitInfo } from "../types";

type Units = { units: UnitInfo[]; live: SimStatus };

const HERO: Record<string, [string, string]> = {
  RUNNING: ["Sedang Berjalan", "Warna air masih menurun menuju target."],
  FILLING: ["Mengisi Tangki", "Limbah sedang masuk ke reaktor."],
  SAMPLING: ["Membaca Sampel", "Sensor membaca kondisi awal limbah."],
  WAITING_SOLAR: ["Menunggu Surya", "Batch dimulai saat daya surya cukup."],
  PAUSED_SOLAR: ["Dijeda Sementara", "Daya surya turun; proses berlanjut saat cukup."],
  SETTLING: ["Mengendap", "Arus berhenti, gumpalan sedang mengendap."],
  DONE: ["Batch Selesai", "Hasil akhir sudah dibaca sensor."],
  FAULT: ["Ada Gangguan", "Periksa unit sebelum melanjutkan."],
};
const REC_ICON: Record<RecIcon, JSX.Element> = { bolt: <IconBolt />, drop: <IconDrop />, wrench: <IconWrench />, sun: <IconSun />, sensor: <IconPulse /> };

function eventView(msg: string): { title: string; sub: string; icon: JSX.Element; tone: string } {
  const b = msg.match(/^Batch (\S+) selesai: (\S+)$/);
  if (b) return { title: `Batch: ${STATUS_LABEL[b[2]] ?? b[2]}`, sub: b[1], icon: <IconCheck />, tone: b[2] === "LOLOS" ? "green" : "red" };
  const s = msg.match(/^\S+:\s*([A-Z_]+)$/)?.[1];
  const map: Record<string, [string, JSX.Element, string]> = {
    RUNNING: ["Proses pengolahan dimulai", <IconPlay key="p" />, "green"], SAMPLING: ["Pembacaan warna awal", <IconDrop key="d" />, "green"],
    FILLING: ["Tangki mulai diisi", <IconLayers key="l" />, "green"], SETTLING: ["Pengendapan dimulai", <IconClock key="c" />, "amber"],
    DONE: ["Batch selesai", <IconCheck key="k" />, "green"], WAITING_SOLAR: ["Menunggu daya surya", <IconSun key="s" />, "amber"],
    PAUSED_SOLAR: ["Dijeda: daya surya kurang", <IconSun key="s2" />, "amber"], FAULT: ["Gangguan unit", <IconFlame key="f" />, "red"],
  };
  const m = s ? map[s] : undefined;
  return m ? { title: STATE_LABEL[s!] ?? s!, sub: m[0], icon: m[1], tone: m[2] } : { title: msg, sub: "", icon: <IconPulse />, tone: "green" };
}

function Metric({ icon, tone, label, value, unit, foot }: { icon: JSX.Element; tone: string; label: string; value: string; unit?: string; foot: React.ReactNode }) {
  return (
    <div className="metric">
      <span className={`ic ${tone}`}>{icon}</span>
      <div className="metric-b">
        <div className="metric-l">{label}</div>
        <div className="metric-v">{value}{unit && <span className="unit">{unit}</span>}</div>
        <div className="metric-f">{foot}</div>
      </div>
    </div>
  );
}
const Ok = ({ children }: { children: React.ReactNode }) => <span className="f-ok"><IconCheck />{children}</span>;
const Warn = ({ children }: { children: React.ReactNode }) => <span className="f-warn">{children}</span>;

export function Live() {
  const isAdmin = getSession()?.role === "admin";
  const units = usePoll(() => api<Units>("/api/units"), 2000);
  const unitId = units.data?.live.unit_id ?? units.data?.units[0]?.unit_id ?? null;
  const series = usePoll(() => (unitId ? api<{ batch_id: string | null; points: Telemetry[] }>(`/api/units/${unitId}/series?limit=700`) : Promise.resolve(null)), 1500, [unitId]);
  const batches = usePoll(() => api<{ batches: Batch[] }>(`/api/batches?limit=6${unitId ? `&unit_id=${unitId}` : ""}`), 4000, [unitId]);
  const events = usePoll(() => api<{ events: EventItem[] }>("/api/events"), 3000);

  const pts = series.data?.points ?? [];
  const t = pts.length ? pts[pts.length - 1] : null;
  const target = t?.target_ptco ?? 200;
  const last = batches.data?.batches[0];
  const online = !!units.data?.units.find((u) => u.unit_id === t?.unit_id)?.online;
  const color0 = pts.find((p) => p.color_est_ptco != null)?.color_est_ptco ?? null;
  const c = t?.color_est_ptco ?? null;
  const prog = logProgress(color0, c, target);
  const energy = useMemo(() => energySplit(pts), [pts]);
  const rec = headline(t, last);
  const advice = tips(t, last);
  const hero = t ? HERO[t.state] ?? [STATE_LABEL[t.state] ?? t.state, ""] : ["Belum Ada Batch", "Mulai simulasi atau sambungkan perangkat."];

  const view = useMemo(() => {
    if (!pts.length) return null;
    const t0 = pts[0].ts, l = pts[pts.length - 1];
    const color = pts.map((p): [number, number | null] => [(p.ts - t0) / 60, p.color_est_ptco ?? null]);
    const xNow = (l.ts - t0) / 60;
    const fc: [number, number | null][] | null = l.color_est_ptco && l.eta_s != null && l.state === "RUNNING" ? [[xNow, l.color_est_ptco], [xNow + l.eta_s / 60, 0.9 * target]] : null;
    const xMax = Math.max(Math.ceil((xNow + (l.eta_s && l.state === "RUNNING" ? l.eta_s / 60 : 0)) / 10) * 10, 20);
    const yTicks = niceTicks(Math.max(...color.map((p) => p[1] ?? 0), target * 2), 4);
    return { color, fc, xMax, yTicks, step: xMax > 100 ? 30 : xMax > 50 ? 20 : 10 };
  }, [pts, target]);

  const ph = t?.ph, phOk = ph != null && ph >= 6 && ph <= 9;
  const evs = [...(events.data?.events ?? [])].reverse().slice(0, 3);

  return (
    <div className="dash">
      <h1 className="sr-only">Pantauan</h1>
      <p className="sr-only" role="status" aria-live="polite">{t ? `Tahap: ${STATE_LABEL[t.state] ?? t.state}` : ""}</p>
      {units.error && <ErrorNote message={`Tidak dapat memuat unit. ${units.error}`} onRetry={units.reload} />}

      <div className="d-top">
        <section className="hero-card" aria-label="Status proses">
          <div className="hero-tag"><span className="hero-play"><IconPlay /></span>Proses Pengolahan</div>
          <h2>{hero[0]}</h2>
          <p>{hero[1]}</p>
          <div className="hero-box">
            <div className="hero-row">
              <span className="hero-eta"><IconClock /><span><small>Estimasi selesai</small><b>{t?.state === "RUNNING" && t.eta_s != null ? `± ${dur(t.eta_s)}` : "–"}</b></span></span>
              <span className="hero-pct"><small>Progres warna</small><b>{prog == null ? "–" : `${num(100 * prog)}%`}</b></span>
            </div>
            <div className="hero-track"><div style={{ width: `${100 * (prog ?? 0)}%` }} /></div>
          </div>
        </section>

        <div className="scene-wrap"><SystemScene t={t} lastColor={last?.color_end_est} online={online} /></div>

        <section className="reco">
          <h2><span className="spark"><IconSparkle /></span>Rekomendasi Hari Ini</h2>
          <div className={`reco-main ${rec.tone}`}>
            <b>{rec.title}</b>
            <p>{rec.body}</p>
          </div>
          <ul>{advice.map((a) => <li key={a.text}><span className="ic green">{REC_ICON[a.icon]}</span>{a.text}</li>)}</ul>
          <a className="reco-link" href="#/rekomendasi">Aturan rekomendasi dan rincian</a>
        </section>
      </div>

      <div className="metrics">
        <Metric icon={<IconDrop />} tone="green" label="Warna air (Pt-Co)" value={num(c)} foot={<>Target ≤ {num(target)} {c != null && (c <= target ? <Ok>Memenuhi</Ok> : <Warn>Di atas target</Warn>)}</>} />
        <Metric icon={<IconBolt />} tone="amber" label="Energi batch" value={num(t?.kwh, 3)} unit="kWh" foot={energy.total > 0 ? <Ok>{num(energy.pctPv + energy.pctBatt)}% terbarukan</Ok> : "Belum ada arus"} />
        <Metric icon={<IconDrop />} tone="green" label="pH" value={num(ph, 1)} foot={ph == null ? "–" : phOk ? <Ok>Dalam baku mutu 6–9</Ok> : <Warn>Di luar baku mutu 6–9</Warn>} />
        <Metric icon={<IconFlame />} tone="red" label="Suhu" value={num(t?.temp_C, 1)} unit="°C" foot={t == null ? "–" : t.temp_C < 45 ? <Ok>Di bawah batas 45 °C</Ok> : <Warn>Mencapai batas 45 °C</Warn>} />
        <Metric icon={<IconWave />} tone="green" label="Konduktivitas" value={num(t?.ec_uScm)} unit="µS/cm" foot={t == null ? "–" : t.ec_uScm >= 1500 ? <Ok>Hantaran cukup</Ok> : <Warn>Rendah, energi boros</Warn>} />
        <Metric icon={<IconLayers />} tone="green" label="Volume" value={num(t?.V_L, 0)} unit="L" foot="Batch saat ini" />
      </div>

      <div className="d-bottom">
        <section className="card">
          <div className="card-head"><h2>Perkembangan Warna Air</h2><span className="stamp">{t ? `Pt-Co · ${t.batch_id}` : "Pt-Co"}</span></div>
          {view ? (
            <LineChart area
              ariaLabel="Warna air (Pt-Co) terhadap menit sejak batch dimulai"
              series={[{ name: "Warna terbaca", points: view.color }, ...(view.fc ? [{ name: "Perkiraan", points: view.fc, dashed: true, color: "var(--sogan)" }] : [])]}
              xMin={0} xMax={view.xMax} yMin={0} yMax={view.yTicks[view.yTicks.length - 1]} yTicks={view.yTicks}
              xTicks={Array.from({ length: Math.floor(view.xMax / view.step) + 1 }, (_, i) => ({ x: i * view.step, label: `${i * view.step} mnt` }))}
              refs={[{ y: target, label: `Target (${num(target)})` }]}
              summary={c != null ? `Warna terbaca ${num(c)} Pt-Co, target ${num(target)} Pt-Co.` : "Belum ada pembacaan warna."}
              fmtY={(v) => num(v)} fmtX={(v) => `menit ${num(v, 0)}`} unit="Pt-Co" height={158} />
          ) : <div className="empty">Garis muncul setelah sampel awal dibaca.</div>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Sumber Daya Sistem</h2><span className="stamp">batch ini</span></div>
          <div className="power">
            <Donut label={`Energi batch: surya ${num(energy.pctPv)} persen, baterai ${num(energy.pctBatt)} persen, PLN ${num(energy.pctGrid)} persen`}
              parts={[{ pct: energy.pctPv, color: "var(--accent)" }, { pct: energy.pctBatt, color: "#74c2a4" }, { pct: energy.pctGrid, color: "#d9a55b" }]}>
              <b>{num(energy.total, 3)}</b><span>kWh total</span>
            </Donut>
            <ul className="power-l">
              <li><span className="ic plain"><IconSun /></span><span>Panel surya<small>{num(energy.pv, 3)} kWh</small></span><b>{num(energy.pctPv)}%</b></li>
              <li><span className="ic plain"><IconBattery /></span><span>Baterai<small>{t ? `${num(energy.batt, 3)} kWh · ${num(t.bat_V, 1)} V` : "–"}</small></span><b>{num(energy.pctBatt)}%</b></li>
              <li><span className="ic plain"><IconPlug /></span><span>PLN (cadangan)<small>{num(energy.grid, 3)} kWh</small></span><b>{num(energy.pctGrid)}%</b></li>
            </ul>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Aktivitas Terakhir</h2><a className="link-green" href="#/batch">Lihat semua →</a></div>
          {evs.length === 0 ? <div className="empty">Belum ada aktivitas.</div> : (
            <ul className="activity">
              {evs.map((e, i) => { const v = eventView(e.msg); return <li key={i}><time>{hm(e.ts)}</time><span className={`ic ${v.tone}`}>{v.icon}</span><span><b>{v.title}</b><small>{v.sub}</small></span></li>; })}
            </ul>
          )}
        </section>
      </div>
      <div className="dash-foot">
        {t ? <p className="hint">Data: {SOURCE_LABEL[t.source]}{t.source === "simulator" ? ", bukan pengukuran dari perangkat asli" : ""}. Gambar unit adalah ilustrasi, bukan foto alat. Warna air di tangki digambar dari absorbansi sensor; air olahan dari nilai Pt-Co batch terakhir. Diperbarui {when(t.ts)} WIB.</p> : <span />}
        <SimControls status={units.data?.live} isAdmin={isAdmin} onChanged={() => { units.reload(); series.reload(); }} />
      </div>
    </div>
  );
}

function SimControls({ status, isAdmin, onChanged }: { status?: SimStatus; isAdmin: boolean; onChanged: () => void }) {
  const data = usePoll(() => api<Presets>("/api/sim/presets"), null);
  const scen = usePoll(() => api<{ scenarios: Scenario[] }>("/api/scenarios"), null);
  const [mode, setMode] = useState("ai");
  const [speed, setSpeed] = useState(120);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const presets = data.data?.presets ?? {};
  const running = !!status?.running;
  const cur = status?.current ? presets[status.current] : undefined;
  const custom = running && !status?.preset ? status?.scenario : "";
  const now = running ? (
    <span className="stamp"><span className="dot live" />
      {status?.preset === "auto" ? "Otomatis" : status?.preset ? `Simulasi ${status.preset}` : "Simulasi"}
      {cur ? `: ${status?.preset === "auto" ? `batch ini ${status.current}, ` : ""}${cur.name.toLowerCase()}` : custom ? `: ${custom}` : ""}, {status?.speed}×
    </span>
  ) : <span className="stamp">Simulasi berhenti</span>;
  if (!isAdmin) return now;
  const call = async (path: string, json?: unknown) => {
    setBusy(true); setErr(null);
    try { await api(path, { method: "POST", json }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Gagal"); } finally { setBusy(false); }
  };
  const go = (preset: string | null, scenario?: string, m = mode, sp = speed) => call("/api/sim/start", preset ? { preset, mode: m, speed: sp } : { scenario, mode: m, speed: sp });
  // changing strategy or speed applies at once to whatever is running
  const reapply = (m: string, sp: number) => { if (running) go(status?.preset ?? null, status?.scenario, m, sp); };
  const options = [...Object.entries(presets).map(([id, p]) => ({ id, label: id, title: `${p.name}. ${p.description}` })),
    ...(data.data ? [{ id: "auto", label: "Otomatis", title: data.data.auto.description }] : [])];
  return (
    <div className="sim">
      {now}
      {err && <span className="stamp" role="alert" style={{ color: "var(--negative)" }}>{err}</span>}
      <div className="seg" role="group" aria-label="Pilih simulasi">
        {options.map((o) => <button key={o.id} title={o.title} disabled={busy} aria-pressed={running && status?.preset === o.id} onClick={() => go(o.id)}>{o.label}</button>)}
      </div>
      <select className="select sm" aria-label="Skenario lain" value={custom ?? ""} disabled={busy} onChange={(e) => e.target.value && go(null, e.target.value)}>
        <option value="">Skenario lain…</option>
        {(scen.data?.scenarios ?? []).map((s) => <option key={s.id} value={s.id} title={s.description}>{s.name}</option>)}
      </select>
      <select className="select sm" aria-label="Strategi kendali" value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value); reapply(e.target.value, speed); }}>
        <option value="ai">AI</option><option value="feedback">Umpan balik</option><option value="fixed">Waktu tetap</option>
      </select>
      <select className="select sm" aria-label="Kecepatan" value={speed} disabled={busy} onChange={(e) => { setSpeed(+e.target.value); reapply(mode, +e.target.value); }}>
        {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      {running && <button className="btn" disabled={busy} onClick={() => call("/api/sim/stop")}>Hentikan</button>}
    </div>
  );
}
