import { describe, expect, it } from "vitest";
import { tankWater } from "./SystemScene";

const pts = (d: string) => [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);

describe("tankWater", () => {
  it("stays inside the measured glass at every fill level", () => {
    for (const level of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      for (const [x, y] of pts(tankWater(level).body)) {
        expect(x).toBeGreaterThanOrEqual(530); expect(x).toBeLessThanOrEqual(1135);   // glass side walls
        expect(y).toBeGreaterThanOrEqual(575); expect(y).toBeLessThanOrEqual(852);    // below the glass rim, above its floor
      }
    }
  });
  it("rises with the fill level and keeps a flat floor", () => {
    const y = (l: number) => Math.min(...pts(tankWater(l).surface).map((p) => p[1]));
    expect(y(1)).toBeLessThan(y(0.5)); expect(y(0.5)).toBeLessThan(y(0.1));
    expect(pts(tankWater(1).body).at(-1)).toEqual(pts(tankWater(0.2).body).at(-1));
  });
});
