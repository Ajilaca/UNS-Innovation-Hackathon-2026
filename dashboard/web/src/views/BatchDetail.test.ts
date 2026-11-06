import { describe, expect, it } from "vitest";
import { flatSteps } from "./BatchDetail";

describe("flatSteps", () => {
  it("draws noise and the reversal sawtooth as one flat line", () => {
    const pts: [number, number | null][] = [[0, null], [1, 9.55], [2, 9.9], [3, 10.17], [4, 9.06], [5, 9.4], [6, 8.85]];
    const out = flatSteps(pts);
    const ys = new Set(out.slice(1).map((p) => p[1]));
    expect(out[0][1]).toBeNull();
    expect(ys.size).toBe(1);
  });
  it("still moves when the voltage really changes", () => {
    const out = flatSteps([[0, 9], [1, 9.1], [2, 9], [3, 14], [4, 14.1], [5, 14]]);
    expect(out[5][1]).toBeGreaterThan(13);
  });
  it("keeps gaps where the current was off", () => {
    const out = flatSteps([[0, 9], [1, null], [2, 9.2]]);
    expect(out[1][1]).toBeNull();
  });
});
