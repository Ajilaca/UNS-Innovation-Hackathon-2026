export type Role = "admin" | "viewer";
export type Session = { token: string; role: Role; user: string };

export type Telemetry = {
  ts: number; source: "device" | "simulator"; site_id: string; unit_id: string; batch_id: string; state: string;
  V_L: number; I_A: number; U_V: number; abs_r: number; abs_g: number; abs_b: number;
  turb_ntu: number; ec_uScm: number; ph: number; temp_C: number; pv_W: number; bat_V: number;
  bat_soc?: number; grid_W?: number; load_W?: number; energy_source?: string; q_CperL?: number; kwh?: number;
  color_est_ptco?: number | null; target_ptco?: number; eta_s?: number | null; q_pred?: number | null;
  polarity?: number; dilution?: number; flags?: string[]; mode?: string;
};

export type Batch = {
  batch_id: string; unit_id: string; site_id: string; source: "device" | "simulator"; mode?: string; status: string;
  ts_start: number; ts_end: number; V_L: number; flags: string[]; run_s: number; total_s: number; q_CperL: number;
  q_pred: number | null; kwh: number; kwh_total: number; kwh_per_m3: number; kwh_pv: number; kwh_batt: number;
  kwh_grid: number; pct_renewable: number; policy?: string; electricity_rp: number; wait_s: number;
  electrode_g: number; sludge_kg: number; reversals: number; retries: number; color0_est: number | null;
  color_end_est: number | null; target_ptco: number; cost_rp: number; cost_rp_per_m3: number;
  q_pred_raw?: number | null; calib_factor?: number; scenario?: string | null;
  truth?: { color0: number; color_end: number; pass: boolean; cod0: number; cod_end: number; dye: string } | null;
};

export type UnitInfo = { unit_id: string; site_id: string; source: string; state: string; batch_id: string; ts: number; online: boolean };
export type SimStatus = {
  running: boolean; scenario?: string; preset?: string | null; current?: string | null; mode?: string; speed?: number; unit_id?: string; batches_done: number; log: string[];
};
export type Scenario = { id: string; name: string; description: string };
export type EventItem = { ts: number; rx: number; unit_id: string; batch_id: string; msg: string };
export type Preset = { scenario: string; name: string; description: string };
export type Presets = { presets: Record<string, Preset>; auto: { name: string; description: string; weights: Record<string, number> } };
