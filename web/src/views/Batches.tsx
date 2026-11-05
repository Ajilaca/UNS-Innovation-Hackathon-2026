import { useState } from "react";
import { api, downloadCsv } from "../api";
import { IconDownload } from "../components/icons";
import { Cups, Empty, ErrorNote, Kpis, ModePill, Panel, StatusPill, Tabs } from "../components/ui";
import { num, rp, SOURCE_LABEL, when } from "../format";
import { usePoll } from "../hooks";
import type { Batch } from "../types";

type Tab = "semua" | "lolos" | "gagal" | "lain";

export function Batches() {
  const [tab, setTab] = useState<Tab>("semua");
  const [source, setSource] = useState("");
  const q = usePoll(() => api<{ batches: Batch[] }>(`/api/batches?limit=200${source ? `&source=${source}` : ""}`), 5000, [source]);
  const all = q.data?.batches ?? [];
  const rows = all.filter((b) => tab === "semua" || (tab === "lolos" && b.status === "LOLOS") || (tab === "gagal" && b.status.startsWith("GAGAL")) || (tab === "lain" && !b.status.startsWith("GAGAL") && b.status !== "LOLOS"));
  const count = (f: (b: Batch) => boolean) => all.filter(f).length;
  const avg = (f: (b: Batch) => number | null | undefined) => { // skip batches that could not report the value (a device restart mid-batch)
    const v = all.map(f).filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return (
    <>
      <h1 className="sr-only">Batch</h1>
      {all.length > 0 ? <section className="summary"><Kpis items={[
        { label: "Lolos baku mutu warna", value: num((100 * count((b) => b.status === "LOLOS")) / all.length), unit: "%", lead: true, sub: `${count((b) => b.status === "LOLOS")} dari ${all.length} batch` },
        { label: "Energi rata-rata", value: num(avg((b) => b.kwh_per_m3), 2), unit: "kWh/m³", sub: "per m³ air olahan" },
        { label: "Biaya rata-rata", value: num(avg((b) => b.cost_rp_per_m3)), unit: "Rp/m³", sub: "listrik, elektroda, lumpur" },
        { label: "Energi terbarukan", value: num(avg((b) => b.pct_renewable)), unit: "%", sub: "rata-rata per batch" },
      ]} /></section> : <p className="finding" style={{ marginTop: 0 }}>Belum ada batch.</p>}
      <div className="batch-bar">
        <Tabs<Tab> pill label="Filter status batch" value={tab} onChange={setTab} items={[
          { id: "semua", label: `Semua ${all.length}` }, { id: "lolos", label: `Lolos ${count((b) => b.status === "LOLOS")}` },
          { id: "gagal", label: `Gagal ${count((b) => b.status.startsWith("GAGAL"))}` },
          { id: "lain", label: `Tanpa verifikasi ${count((b) => !b.status.startsWith("GAGAL") && b.status !== "LOLOS")}` },
        ]} />
        <div className="actions">
          <select className="select sm" aria-label="Sumber data" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Semua sumber</option><option value="device">Perangkat</option><option value="simulator">Simulasi</option>
          </select>
          <button className="btn primary" onClick={() => downloadCsv(`/api/report.csv${source ? `?source=${source}` : ""}`, "laporan-sebat.csv")}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><IconDownload /> Laporan DLH (CSV)</span>
          </button>
        </div>
      </div>
      <Panel id={tab}>
      {q.error && <ErrorNote message={`Tidak dapat memuat batch. ${q.error}`} onRetry={q.reload} />}
      {rows.length === 0 ? <Empty>{all.length ? "Tidak ada batch pada tab ini." : "Batch muncul di sini setelah proses pertama selesai."}</Empty> : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Selesai (WIB)</th><th>Batch</th><th>Status</th><th>Strategi</th><th className="num">Warna awal → akhir (Pt-Co)</th>
                <th className="num">Muatan (C/L)</th><th className="num">kWh/m³</th><th className="num">Terbarukan</th><th className="num">Biaya/m³</th><th>Sumber</th></tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.batch_id} className="link" onClick={() => { location.hash = `#/batch/${b.batch_id}`; }}>
                  <td>{when(b.ts_end)}</td>
                  <td className="id"><a href={`#/batch/${b.batch_id}`}>{b.batch_id}</a></td>
                  <td><StatusPill status={b.status} /></td><td><ModePill mode={b.mode} /></td>
                  <td className="num"><Cups from={b.color0_est} to={b.color_end_est} /> {num(b.color0_est)} → {num(b.color_end_est)}</td>
                  <td className="num">{num(b.q_CperL)}{b.q_pred ? <span className="unit">/ {num(b.q_pred)}</span> : null}</td>
                  <td className="num">{num(b.kwh_per_m3, 2)}</td><td className="num">{num(b.pct_renewable)}%</td>
                  <td className="num">{rp(b.cost_rp_per_m3)}</td><td>{SOURCE_LABEL[b.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </Panel>
      <p className="hint">Muatan: terpakai / prediksi AI. Warna adalah estimasi sensor, bukan hasil uji laboratorium.</p>
    </>
  );
}
