import { num } from "../format";
import type { Telemetry } from "../types";

/** The product's own element: where the reactor's power comes from right now. Stroke width ~ watts. */
export function EnergyFlow({ t }: { t: Telemetry | null }) {
  const pv = t?.pv_W ?? 0, grid = t?.grid_W ?? 0, load = t?.load_W ?? 0, soc = t?.bat_soc;
  const fromPv = Math.min(pv, load);
  const battOut = Math.max(0, load - fromPv - grid);
  const pvToBatt = Math.max(0, pv - load);
  const sw = (w: number) => (w < 0.5 ? 1.5 : Math.min(2 + w / 22, 9));
  const cls = (w: number, extra = "") => `link ${extra} ${w < 0.5 ? "off" : ""}`;
  // nodes: left column Surya / Baterai / PLN, right Reaktor
  return (
    <svg className="flow" viewBox="0 0 380 270" width="100%" role="img"
      aria-label={`Aliran daya: surya ${num(pv)} W, PLN ${num(grid)} W, beban reaktor ${num(load)} W`}>
      <path className={cls(fromPv, "pv")} strokeWidth={sw(fromPv)} d="M128 38 H236 V112 H256" />
      <path className={cls(pvToBatt, "pv")} strokeWidth={sw(pvToBatt)} d="M68 68 V104" />
      <path className={cls(battOut)} strokeWidth={sw(battOut)} d="M128 134 H256" />
      <path className={cls(grid)} strokeWidth={sw(grid)} d="M128 230 H236 V156 H256" />
      <g>
        <rect className="node" x="6" y="8" width="122" height="60" rx="8" />
        <text x="18" y="33" style={{ fontSize: 15, fontWeight: 500 }}>Surya</text><text className="sub" x="18" y="53" style={{ fontSize: 14 }}>{num(pv)} W</text>
        <rect className="node" x="6" y="104" width="122" height="60" rx="8" />
        <text x="18" y="129" style={{ fontSize: 15, fontWeight: 500 }}>Baterai</text><text className="sub" x="18" y="149" style={{ fontSize: 14 }}>{soc == null ? "–" : `${num(100 * soc)}%`} · {t ? num(t.bat_V, 1) : "–"} V</text>
        <rect className="node" x="6" y="200" width="122" height="60" rx="8" />
        <text x="18" y="225" style={{ fontSize: 15, fontWeight: 500 }}>PLN</text><text className="sub" x="18" y="245" style={{ fontSize: 14 }}>{num(grid)} W</text>
        <rect className="node" x="256" y="92" width="118" height="84" rx="8" />
        <text x="268" y="119" style={{ fontSize: 15, fontWeight: 500 }}>Reaktor</text><text className="sub" x="268" y="139" style={{ fontSize: 14 }}>{num(load)} W</text>
        <text className="sub" x="268" y="158" style={{ fontSize: 14 }}>{t?.energy_source && t.energy_source !== "-" ? t.energy_source : "tidak aktif"}</text>
      </g>
    </svg>
  );
}
