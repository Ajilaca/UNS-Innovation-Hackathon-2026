const nf = (d: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const cache: Record<number, Intl.NumberFormat> = {};
const get = (d: number) => (cache[d] ??= nf(d));

export const DASH = "–";
export const num = (v: number | null | undefined, d = 0): string => (v == null || Number.isNaN(v) ? DASH : get(d).format(v));
export const signed = (v: number | null | undefined, d = 0): string =>
  v == null || Number.isNaN(v) ? DASH : (v > 0 ? "+" : v < 0 ? "−" : "") + get(d).format(Math.abs(v));
export const rp = (v: number | null | undefined): string => (v == null ? DASH : "Rp" + get(0).format(Math.round(v)));

export function dur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return DASH;
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} jam ${String(m).padStart(2, "0")} menit`;
  if (m > 0) return `${m} menit`;
  return `${s} detik`;
}

const WIB = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
export const when = (ts: number | null | undefined): string => (ts ? WIB.format(new Date(ts * 1000)).replace(".", ":") : DASH);
const HM = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });
export const hm = (ts: number): string => HM.format(new Date(ts * 1000)).replace(".", ":");

export const STATE_LABEL: Record<string, string> = {
  IDLE: "Siaga", FILLING: "Mengisi", SAMPLING: "Membaca sampel", WAITING_SOLAR: "Menunggu surya",
  RUNNING: "Memproses", PAUSED_SOLAR: "Dijeda: daya surya kurang", SETTLING: "Mengendap", DONE: "Selesai", FAULT: "Gangguan",
};
export const STATUS_LABEL: Record<string, string> = {
  LOLOS: "Lolos", GAGAL_WARNA: "Gagal warna", GAGAL_WARNA_MENTOK: "Gagal: warna mentok", GAGAL_WAKTU: "Gagal: batas waktu", GAGAL_SENSOR: "Gagal: sensor",
  GAGAL_TANPA_DAYA: "Gagal: tanpa daya", GAGAL_PENGAMAN_SUHU: "Gagal: suhu", GAGAL_PENGAMAN_LISTRIK: "Gagal: pengaman listrik", GAGAL_LEVEL: "Gagal: level air", SELESAI_TANPA_VERIFIKASI: "Tanpa verifikasi",
  SELESAI: "Selesai",
};
export const STATUS_TONE = (s: string): "ok" | "bad" | "neutral" => (s === "LOLOS" ? "ok" : s.startsWith("GAGAL") ? "bad" : "neutral");
export const MODE_LABEL: Record<string, string> = { fixed: "Waktu tetap", feedback: "Umpan balik", ai: "AI" };
export const SOURCE_LABEL: Record<string, string> = { simulator: "Simulasi", device: "Perangkat" };
export const FLAG_LABEL: Record<string, string> = {
  PENGENCERAN_OTOMATIS: "Sampel diencerkan otomatis (warna terlalu pekat untuk sensor)",
  TUNDA_MENUNGGU_SURYA: "Batch menunggu daya surya",
  JEDA_DAYA_SURYA: "Proses dijeda karena daya surya turun",
  PLN_DIPAKAI: "PLN dipakai sebagai cadangan",
  BATAS_TUNGGU_SURYA_HABIS: "Batas tunggu surya habis, beralih ke PLN",
  PRAKIRAAN_SURYA_KURANG: "Prakiraan surya tidak cukup: mulai langsung dengan PLN menambal",
  PASIVASI_TERDETEKSI: "Tahanan sel naik (pasivasi), polaritas dibalik",
  ULANG_PROSES: "Warna belum lolos setelah pengendapan, proses diulang sekali",
  WARNA_MENTOK: "Warna berhenti turun walau arus berjalan, proses dihentikan agar tidak boros",
  SENSOR_MACET: "Sensor warna macet",
  SENSOR_MACET_FALLBACK_PREDIKSI: "Sensor warna macet: berhenti berdasarkan prediksi AI",
  ANOMALI_DOSIS_CEK_SENSOR_ATAU_LIMBAH: "Dosis menyimpang dari prediksi: cek sensor atau jenis limbah",
  // dari firmware perangkat
  TEGANGAN_LEBIH: "Tegangan sel melewati batas, arus dimatikan",
  ARUS_LEBIH: "Arus melewati batas, arus dimatikan",
  ARUS_TIDAK_MENGALIR: "Arus diperintah tetapi tidak mengalir: periksa elektroda dan catu",
  SENSOR_ARUS_HILANG: "Sensor arus tidak terbaca, arus dimatikan",
  SUHU_LEBIH: "Suhu melewati batas pengaman",
  LEVEL_RENDAH: "Level air rendah: elektroda tidak terendam atau tangki tidak terisi",
  SENSOR_GAGAL_BACA: "Sensor air gagal terbaca berulang kali",
  DIHENTIKAN_OPERATOR: "Dihentikan operator",
  RESTART_TENGAH_BATCH: "Perangkat mati di tengah batch: periksa air sebelum memulai lagi",
  KALIBRASI_PROBE_BELUM: "Probe pH, EC, atau kekeruhan belum dikalibrasi",
  NOL_SENSOR_KEDALUWARSA: "Sensor warna belum dinolkan lebih dari 36 jam",
};
export const flagText = (f: string): string => FLAG_LABEL[f] ?? f.toLowerCase().replaceAll("_", " ");
