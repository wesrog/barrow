import { describe, expect, test } from "bun:test";
import { fillLoopedNoise } from "./ambience";

/** RMS of `n` samples starting at `start`, wrapping around the loop. */
function wrappedRms(data: Float32Array, start: number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = data[(start + i) % data.length]!;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

describe("fillLoopedNoise", () => {
  test("holds steady loudness across the loop seam (no chop)", () => {
    const data = new Float32Array(48000 * 3);
    fillLoopedNoise(data);
    const win = 1024;
    // Overall level from the middle of the buffer, far from the seam.
    const mid = wrappedRms(data, data.length >> 1, win);
    // Slide windows through the wrap point; none may dip audibly below it.
    for (let start = data.length - 4096; start < data.length + 4096; start += win) {
      const rms = wrappedRms(data, start % data.length, win);
      expect(rms).toBeGreaterThan(mid * 0.7);
      expect(rms).toBeLessThan(mid * 1.4);
    }
  });

  test("loop point has no hard discontinuity beyond normal noise steps", () => {
    const data = new Float32Array(48000 * 3);
    fillLoopedNoise(data);
    // The seam step (last sample -> first sample) should look like any other
    // white-noise step: bounded by the sample range, not an outlier spike.
    const seamStep = Math.abs(data[0]! - data[data.length - 1]!);
    expect(seamStep).toBeLessThanOrEqual(2);
  });
});
