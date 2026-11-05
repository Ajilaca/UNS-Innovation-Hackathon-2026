import { num, STATE_LABEL } from "../format";
import type { Telemetry } from "../types";
import { waterFromAbs, waterFromPtco } from "./water";

/** The unit picture with live values on top. The drawn tank and glass are empty on purpose:
 *  tank water comes from the sensor's absorbance, the glass from the last batch's result.
 *  Coordinates are pixels of scene/sistem.png (1536 x 1024). */
const TANK = {
  // inner corners of the glass on its floor, measured on the picture
  backLeft: [537, 800], backRight: [1090, 790], frontRight: [1128, 838], frontLeft: [592, 848],
  rise: { front: 208, back: 198 },   // height of a full tank in pixels; the back wall is further away, so shorter
};

/** The water as a box inside the glass: side view plus top surface, for a fill level from 0 to 1. Exported for tests. */
export function tankWater(level: number) {
  const { backLeft: bl, backRight: br, frontRight: fr, frontLeft: fl, rise } = TANK;
  const up = (p: number[], h: number) => [p[0], p[1] - h * level];
  const tbl = up(bl, rise.back), tbr = up(br, rise.back), tfr = up(fr, rise.front), tfl = up(fl, rise.front);
  const path = (pts: number[][]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") + " Z";
  return { body: path([bl, tbl, tbr, tfr, fr, fl]), surface: path([tbl, tbr, tfr, tfl]) };
}

export function SystemScene({ t, lastColor, online }: { t: Telemetry | null; lastColor?: number | null; online: boolean }) {
  const running = !!t && online && t.I_A > 0.05;
  const water = waterFromAbs(t?.abs_r, t?.abs_g, t?.abs_b, t?.dilution ?? 1);
  const level = t ? Math.min(1, t.V_L / 50) : 0;
  const shape = tankWater(level);
  const state = t ? (online ? STATE_LABEL[t.state] ?? t.state : "Tidak ada data baru") : "Tidak aktif";
  return (
    <div className="scene" role="img"
      aria-label={t ? `Skema unit: panel surya ${num(t.pv_W)} watt, baterai ${t.bat_soc == null ? "tidak diketahui" : `${num(100 * t.bat_soc)} persen`}, reaktor ${state}, arus ${num(t.I_A, 1)} ampere` : "Skema unit, belum ada data"}>
      <svg viewBox="0 0 1536 1024" aria-hidden>
        <image href="scene/sistem.png" width="1536" height="1024" />
        {t && level > 0 && <><path className="water" d={shape.body} style={{ fill: water }} /><path className="surface" d={shape.surface} /></>}
        {running && [610, 700, 800, 900, 985, 1090].map((x, i) => <circle key={x} className="bub" cx={x} cy={830} r={i % 2 ? 5 : 7.5} style={{ animationDelay: `${i * 0.36}s` }} />)}
        {lastColor != null && <path className="water" d="M1264 708 L1274 828 Q1345 862 1416 828 L1426 708 Q1345 728 1264 708 Z" style={{ fill: waterFromPtco(lastColor) }} />}
      </svg>
      <div className="tag t-pv"><b>Panel Surya</b><em>{t ? `${num(t.pv_W)} W` : "–"}</em></div>
      <div className="tag t-esp"><b>ESP32</b><small>Kontrol dan pengirim data</small></div>
      <div className="tag t-rx"><b>Reaktor Elektrokoagulasi</b><small>{t ? `Arus ${num(t.I_A, 1)} A · ${num(t.U_V, 1)} V` : "Arus –"}</small><span className={running ? "chip on" : "chip"}>{state}</span></div>
      <div className="tag t-bat"><b>Baterai</b><em>{t?.bat_soc == null ? "–" : `${num(100 * t.bat_soc)}%`}</em><small>{t ? `${num(t.bat_V, 1)} V` : ""}</small></div>
      <div className="tag t-in"><b>Limbah masuk</b></div>
      <div className="tag t-out"><b>Air olahan</b><small>{lastColor != null ? `${num(lastColor)} Pt-Co` : "belum ada"}</small></div>
    </div>
  );
}
