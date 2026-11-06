import { describe, expect, it } from "vitest";
import { energyVerdict, heatColor, robustVerdict, sizingVerdict, strategyVerdict } from "./Compare";

const v = (p: number, k: number) => ({ pass_true_pct: p, kwh_per_m3: k });
describe("strategyVerdict", () => {
  it("only claims both when both are true", () => {
    expect(strategyVerdict(v(95, 0.99), v(89, 1.49))).toContain("lebih andal dan lebih hemat");
    expect(strategyVerdict(v(80, 0.99), v(89, 1.49))).toContain("kurang andal");
    expect(strategyVerdict(v(95, 1.6), v(89, 1.49))).toContain("lebih boros");
    expect(strategyVerdict(v(80, 1.6), v(89, 1.49))).toContain("mengungguli");
  });
});

describe("energyVerdict", () => {
  it("says the grid is barely used only when that is true", () => {
    expect(energyVerdict({ kwh_grid: 0 }, 10)).toContain("nyaris tidak terpakai");
    const v = energyVerdict({ kwh_grid: 1.5 }, 10);
    expect(v).not.toContain("nyaris"); expect(v).toContain("1,50 kWh");
  });
});

describe("sizing", () => {
  it("claims solar fails only when the numbers show it", () => {
    expect(sizingVerdict(12, 96)).toContain("sering gagal");
    expect(sizingVerdict(93, 93)).not.toContain("gagal");
  });
  it("marks a failing cell differently from a passing one", () => {
    expect(heatColor(12)).not.toBe(heatColor(97));
    expect(heatColor(49)).toBe(heatColor(12));
  });
});

describe("robustVerdict", () => {
  it("names the worst guess with its real numbers", () => {
    const t = robustVerdict("sensor.eps_scale", "Skala sensor sebenarnya", 0.6, 97.5, 0);
    expect(t).toContain("kalibrasi sensor");
    expect(t).toContain("0,6×");
    expect(t).toContain("0%");
  });
  it("does not raise an alarm when nothing moves much", () => {
    expect(robustVerdict("x", "X", 2, 97.5, 95)).toContain("Tidak ada satu tebakan");
  });
});
