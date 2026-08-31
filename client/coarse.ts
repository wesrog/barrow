/** True on touch-first devices (phones, tablets): fingers need bigger targets
 * and there is no hover, so the HUD trades tooltips for tap-to-inspect flows.
 * Guarded so headless test runs without a DOM don't crash on import. */
export const coarsePointer: boolean =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
