import { describe, expect, it } from "vitest";
import { dur, flagText, num, rp, signed, STATUS_TONE } from "./format";

describe("format (id-ID)", () => {
  it("uses comma decimals and dot thousands", () => {
    expect(num(1234.5, 1)).toBe("1.234,5");
    expect(rp(7282)).toBe("Rp7.282");
  });
  it("prints a dash for missing, a real zero for zero", () => {
    expect(num(null)).toBe("–");
    expect(num(0)).toBe("0");
    expect(signed(0)).toBe("0");
    expect(signed(-3)).toBe("−3");
    expect(signed(4)).toBe("+4");
  });
  it("durations", () => {
    expect(dur(45)).toBe("45 d");
    expect(dur(600)).toBe("10 m");
    expect(dur(3900)).toBe("1 j 05 m");
    expect(dur(null)).toBe("–");
  });
  it("labels and tones", () => {
    expect(STATUS_TONE("LOLOS")).toBe("ok");
    expect(STATUS_TONE("GAGAL_SENSOR")).toBe("bad");
    expect(STATUS_TONE("SELESAI_TANPA_VERIFIKASI")).toBe("neutral");
    expect(flagText("PLN_DIPAKAI")).toContain("PLN");
    expect(flagText("TIDAK_DIKENAL")).toBe("tidak dikenal");
  });
});
