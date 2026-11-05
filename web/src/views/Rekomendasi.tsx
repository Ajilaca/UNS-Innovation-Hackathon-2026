import { api } from "../api";
import { IconBolt, IconCheck, IconCheckSquare, IconClipboard, IconDrop, IconFlask, IconInfo, IconLayers, IconShield, IconTrash } from "../components/icons";
import { Empty } from "../components/ui";
import { dur, flagText, num } from "../format";
import { usePoll } from "../hooks";
import { headline, tips } from "../recommend";
import type { Batch, Telemetry, UnitInfo } from "../types";

export function Rekomendasi() {
  const units = usePoll(() => api<{ units: UnitInfo[] }>("/api/units"), 5000);
  const id = units.data?.units[0]?.unit_id;
  const latest = usePoll(() => (id ? api<Telemetry>(`/api/units/${id}/latest`).catch(() => null) : Promise.resolve(null)), 3000, [id]);
  const batches = usePoll(() => api<{ batches: Batch[] }>("/api/batches?limit=20"), 8000);
  const t = latest.data, all = batches.data?.batches ?? [], last = all[0];
  const rec = headline(t, last);
  const seen = new Map<string, number>();
  for (const b of all) for (const f of b.flags) seen.set(f, (seen.get(f) ?? 0) + 1);
  const running = t?.state === "RUNNING" && t.q_pred ? Math.min(1, Math.max(0, (t.q_CperL ?? 0) / t.q_pred)) : null;
  const routine = [
    { icon: <IconDrop />, text: "Nolkan sensor warna dengan air bersih setiap pagi; pada analisis simulasi, kalibrasi sensor paling menentukan mutu." },
    { icon: <IconBolt />, text: "Elektrolisis menghasilkan gas hidrogen: pastikan ventilasi dan jauhkan dari api." },
    { icon: <IconTrash />, text: "Endapan diperlakukan sebagai limbah B3 (PP 22/2021), jangan dibuang ke saluran." },
    { icon: <IconFlask />, text: "Verifikasi berkala dengan uji laboratorium (warna, COD, TSS); warna di sini adalah estimasi sensor." },
  ];
  const Head = ({ icon, title }: { icon: JSX.Element; title: string }) => <div className="card-head"><h2 className="with-ic"><span className="ic square">{icon}</span><span>{title}</span></h2></div>;
  return (
    <>
      <h1 className="sr-only">Rekomendasi</h1>
      <section className={`reco-banner ${rec.tone}`}>
        <span className="banner-ic">{rec.tone === "bad" || rec.tone === "info" ? <IconInfo /> : <IconCheck />}</span>
        <div className="reco-banner-t"><b>{rec.title}</b><p>{rec.body}</p></div>
        {running != null && <div className="reco-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * running)} aria-label="Muatan terpakai dari prediksi"><i style={{ width: `${100 * running}%` }} /><span>{t?.eta_s != null ? `≈ ${dur(t.eta_s)}` : `${num(100 * running)}%`}</span></div>}
      </section>
      <div className="grid g-2" style={{ alignItems: "stretch" }}>
        <section className="card">
          <Head icon={<IconClipboard />} title="Yang perlu dilakukan" />
          <ul className="reco-list">{tips(t, last).map((a) => <li key={a.text}><span className="reco-ck"><IconCheckSquare /></span><span>{a.text}</span></li>)}</ul>
        </section>
        <section className="card">
          <Head icon={<IconLayers />} title={`Catatan dari ${all.length} batch terakhir`} />
          {seen.size === 0 ? <Empty>Tidak ada catatan kontroler.</Empty> : <ul className="reco-list">{[...seen.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => <li key={f}><span className="reco-n">{n}×</span><span>{flagText(f)}</span></li>)}</ul>}
        </section>
      </div>
      <section className="card">
        <Head icon={<IconShield />} title="Rutin dan keselamatan" />
        <ul className="reco-list">{routine.map((r) => <li key={r.text}><span className="reco-ic">{r.icon}</span><span>{r.text}</span></li>)}</ul>
      </section>
      <div className="note-bar"><span><IconInfo />Disusun dari aturan tetap atas pembacaan unit, bukan dari model AI, supaya alasannya selalu bisa ditelusuri.</span></div>
    </>
  );
}
