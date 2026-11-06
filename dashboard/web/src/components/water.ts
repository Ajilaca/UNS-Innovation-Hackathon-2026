/** Water colour from what the optical sensor actually reads.
 *  Beer-Lambert: transmitted light per channel = 10^(-A). Only for display; the sensor reading itself is unchanged. */
const ch = (a: number) => Math.round(255 * Math.min(1, Math.max(0.02, 10 ** -Math.max(a, 0))));

export function waterFromAbs(r?: number | null, g?: number | null, b?: number | null, dilution = 1): string {
  if (r == null || g == null || b == null) return "rgb(226 232 236)";
  return `rgb(${ch(r * dilution)} ${ch(g * dilution)} ${ch(b * dilution)})`;
}

/** Illustration for batch summaries, which store Pt-Co only: the yellow-brown of the Pt-Co scale itself. */
export function waterFromPtco(c?: number | null): string {
  if (c == null) return "transparent";
  const a = c * 3e-4;
  return `rgb(${ch(a * 0.5)} ${ch(a * 0.8)} ${ch(a * 1.2)})`;
}

/** Share of the way from the starting colour to the target on a log axis (kinetics are exponential). */
export function logProgress(c0: number | null | undefined, c: number | null | undefined, target: number): number | null {
  if (!c0 || !c || c0 <= target) return c != null && c <= target ? 1 : null;
  return Math.min(1, Math.max(0, Math.log(c0 / Math.max(c, 1)) / Math.log(c0 / target)));
}
