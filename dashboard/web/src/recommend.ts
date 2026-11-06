import { dur, num, STATUS_LABEL } from "./format";
import type { Batch, Telemetry } from "./types";

export type Tone = "ok" | "warn" | "bad" | "info";
export type Rec = { title: string; body: string; tone: Tone };
export type RecIcon = "bolt" | "drop" | "wrench" | "sun" | "sensor";
export type Tip = { icon: RecIcon; text: string };

/** Plain rules over real readings: no model and no invented numbers. The UI states that these are rules. */
export function headline(t: Telemetry | null, last: Batch | undefined): Rec {
  if (!t) return { tone: "info", title: "Belum ada batch", body: "Mulai simulasi atau sambungkan perangkat untuk melihat rekomendasi." };
  const target = t.target_ptco ?? 200, c = t.color_est_ptco;
  switch (t.state) {
    case "FAULT": return { tone: "bad", title: "Periksa unit", body: "Unit melaporkan gangguan. Hentikan pengolahan dan periksa sensor serta sambungan listrik." };
    case "WAITING_SOLAR": return { tone: "warn", title: "Menunggu daya surya", body: `Panel menghasilkan ${num(t.pv_W)} W. Batch dimulai saat daya cukup, atau PLN menambal setelah batas tunggu.` };
    case "PAUSED_SOLAR": return { tone: "warn", title: "Proses dijeda", body: `Daya surya turun ke ${num(t.pv_W)} W. Proses berlanjut saat daya kembali cukup.` };
    case "RUNNING":
      if (c != null && c <= target) return { tone: "ok", title: "Mendekati batas berhenti", body: `Warna air terbaca ${num(c)} Pt-Co, sudah di bawah target ${num(target)} Pt-Co.` };
      return { tone: "warn", title: "Lanjutkan pengolahan", body: `Warna air masih ${num(c)} Pt-Co (di atas target ${num(target)} Pt-Co).${t.eta_s != null ? ` Perkiraan ${dur(t.eta_s)} lagi.` : ""}` };
    case "SETTLING": return { tone: "info", title: "Biarkan mengendap", body: "Arus sudah berhenti. Jangan mengaduk tangki sampai pembacaan warna akhir selesai." };
    case "DONE":
      if (last?.status.startsWith("GAGAL")) return { tone: "bad", title: "Batch terakhir belum lolos", body: `${STATUS_LABEL[last.status] ?? last.status}. Jangan buang atau pakai ulang air ini sebelum diolah lagi.` };
      return { tone: "ok", title: "Batch selesai", body: "Air bisa dipindahkan, lalu verifikasi berkala dengan uji laboratorium." };
    default: return { tone: "info", title: "Menyiapkan batch", body: "Tangki sedang diisi dan sampel awal dibaca." };
  }
}

export function tips(t: Telemetry | null, last: Batch | undefined): Tip[] {
  const out: Tip[] = [];
  const flags = new Set([...(t?.flags ?? []), ...(last?.flags ?? [])]);
  if (flags.has("SENSOR_MACET") || flags.has("SENSOR_MACET_FALLBACK_PREDIKSI")) out.push({ icon: "sensor", text: "Sensor warna terdeteksi macet. Bersihkan ruang ukur dan periksa LED." });
  if (flags.has("ANOMALI_DOSIS_CEK_SENSOR_ATAU_LIMBAH")) out.push({ icon: "sensor", text: "Dosis menyimpang dari prediksi. Cek sensor atau jenis limbah batch ini." });
  if (flags.has("WARNA_MENTOK")) out.push({ icon: "drop", text: "Warna berhenti turun pada batch terakhir. Pewarna ini mungkin perlu olahan lain atau pengenceran." });
  if (flags.has("PASIVASI_TERDETEKSI")) out.push({ icon: "wrench", text: "Tahanan sel sempat naik (pasivasi). Bersihkan elektroda bila berulang." });
  if (flags.has("PLN_DIPAKAI")) out.push({ icon: "sun", text: "PLN ikut terpakai. Periksa kebersihan panel surya bila ini sering terjadi." });
  if (t?.bat_soc != null && t.bat_soc < 0.3) out.push({ icon: "bolt", text: `Baterai tinggal ${num(100 * t.bat_soc)}%. Tunda batch pekat sampai terisi.` });
  if (t && t.U_V > 13) out.push({ icon: "bolt", text: `Tegangan sel ${num(t.U_V, 1)} V, mendekati batas 15 V. Periksa elektroda dan konduktivitas limbah.` });
  // routine, in priority order; sensor first because the sensitivity analysis shows it matters most
  const routine: Tip[] = [
    { icon: "sensor", text: "Nolkan sensor warna dengan air bersih setiap pagi." },
    { icon: "drop", text: "Pantau warna air selama proses; hentikan bila pembacaan tidak berubah." },
    { icon: "wrench", text: "Bersihkan elektroda secara berkala bila kinerja menurun." },
  ];
  for (const r of routine) if (out.length < 3) out.push(r);
  return out;
}

/** Energy per source over a batch, integrated from telemetry samples (W x s). */
export function energySplit(points: Pick<Telemetry, "ts" | "pv_W" | "grid_W" | "load_W">[]) {
  let pv = 0, batt = 0, grid = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], dt = Math.max(0, p.ts - points[i - 1].ts);
    const load = p.load_W ?? 0, g = Math.min(p.grid_W ?? 0, load), s = Math.min(p.pv_W, load - g);
    pv += s * dt; grid += g * dt; batt += Math.max(0, load - s - g) * dt;
  }
  const kwh = (v: number) => v / 3.6e6;
  const total = pv + batt + grid;
  const pct = (v: number) => (total > 0 ? (100 * v) / total : 0);
  return { pv: kwh(pv), batt: kwh(batt), grid: kwh(grid), total: kwh(total), pctPv: pct(pv), pctBatt: pct(batt), pctGrid: pct(grid) };
}

export function greeting(d = new Date()): string {
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }).format(d);
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
}
