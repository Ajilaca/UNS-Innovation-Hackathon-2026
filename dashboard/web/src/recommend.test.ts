import { describe, expect, it } from "vitest";
import { energySplit, greeting, headline, tips } from "./recommend";
import type { Batch, Telemetry } from "./types";

const T = (o: Partial<Telemetry>) => ({ state: "RUNNING", target_ptco: 200, pv_W: 100, U_V: 8, flags: [], ...o }) as Telemetry;

describe("headline", () => {
  it("says continue only while the colour is above target", () => {
    expect(headline(T({ color_est_ptco: 1142 }), undefined).title).toBe("Lanjutkan pengolahan");
    expect(headline(T({ color_est_ptco: 150 }), undefined).tone).toBe("ok");
  });
  it("never reports a failed batch as finished", () => {
    const last = { status: "GAGAL_WARNA", flags: [] } as unknown as Batch;
    expect(headline(T({ state: "DONE" }), last).tone).toBe("bad");
  });
  it("has an honest empty state", () => { expect(headline(null, undefined).title).toBe("Belum ada batch"); });
});

describe("tips", () => {
  it("puts real problems before routine and stays at three", () => {
    const r = tips(T({ flags: ["PASIVASI_TERDETEKSI"], bat_soc: 0.2 }), undefined);
    expect(r).toHaveLength(3);
    expect(r[0].text).toContain("pasivasi");
    expect(r[1].text).toContain("Baterai");
  });
});

describe("energySplit", () => {
  it("splits load by source and sums to the total", () => {
    const pts = [{ ts: 0, pv_W: 0, grid_W: 0, load_W: 0 }, { ts: 3600, pv_W: 60, grid_W: 20, load_W: 100 }];
    const e = energySplit(pts);
    expect(e.pv).toBeCloseTo(0.06); expect(e.grid).toBeCloseTo(0.02); expect(e.batt).toBeCloseTo(0.02);
    expect(e.pctPv + e.pctBatt + e.pctGrid).toBeCloseTo(100);
  });
  it("does not count surplus PV as used", () => {
    const e = energySplit([{ ts: 0, pv_W: 0, grid_W: 0, load_W: 0 }, { ts: 3600, pv_W: 500, grid_W: 0, load_W: 100 }]);
    expect(e.pv).toBeCloseTo(0.1);
  });
  it("is zero, not NaN, with no data", () => { expect(energySplit([]).pctPv).toBe(0); });
});

it("greets by Jakarta time, not the browser's", () => {
  expect(greeting(new Date("2026-11-04T01:00:00Z"))).toBe("Selamat pagi");   // 08:00 WIB
  expect(greeting(new Date("2026-11-04T12:00:00Z"))).toBe("Selamat malam");  // 19:00 WIB
});
