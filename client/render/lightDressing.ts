import type { KitName } from "./models";

/**
 * Scattered light: standing torches, braziers and small campfires spread over
 * open ground, and braziers, candle stands and torch sticks through the crypt
 * rooms, so the dark between set pieces has something burning in it. The
 * scene divides the map into blocks of `block` cells and gives each block at
 * most one light, with `chance` of it lighting at all, so they read as
 * interspersed and never as a grid. Every piece's glow goes through the lamp
 * pool, so their number costs nothing per frame. Rows, not code.
 */

export interface LightPiece {
  /** Relative weight among the pieces of its setting. */
  weight: number;
  parts: { kit: KitName; node: string; dx?: number; dz?: number; ry?: number }[];
  scale: number;
  flame: { color: number; height: number; size: number };
  light: { color: number; intensity: number; height: number };
}

export interface LightScatter {
  /** Cells on a side per block; one light at most per block. */
  block: number;
  /** Chance a block lights at all. */
  chance: number;
  /** Chebyshev radius of floor that must surround the spot. */
  clear: number;
  pieces: LightPiece[];
}

const VP: KitName = "viking_props";
const DP: KitName = "dungeon_props";
const TORCH = { color: 0xff9030, height: 0.82, size: 0.06 };
const TORCH_LIGHT = { color: 0xff9a45, intensity: 2.2, height: 1.0 };

export const OUTDOOR_LIGHTS: LightScatter = {
  block: 11,
  chance: 0.55,
  clear: 1,
  pieces: [
    // a standing torch someone drove into the turf
    { weight: 5, parts: [{ kit: DP, node: "Prop_TorchStick_01" }], scale: 0.62, flame: TORCH, light: TORCH_LIGHT },
    // an iron brazier with its coals
    {
      weight: 3,
      parts: [{ kit: VP, node: "Prop_Brazier_01" }, { kit: VP, node: "Prop_Brazier_01_Insert_01" }],
      scale: 0.6,
      flame: { color: 0xff8c28, height: 0.5, size: 0.08 },
      light: { color: 0xff9a45, intensity: 2.8, height: 0.9 },
    },
    // a small campfire with a log beside it
    {
      weight: 2,
      parts: [
        { kit: VP, node: "Prop_Fire_Pit_01" },
        { kit: VP, node: "Prop_Fire_Pit_01_Insert_01" },
        { kit: VP, node: "Prop_Log_02", dx: 1.25, dz: 0.4, ry: 0.5 },
      ],
      scale: 0.55,
      flame: { color: 0xff8c28, height: 0.5, size: 0.12 },
      light: { color: 0xff9a45, intensity: 4, height: 1.1 },
    },
  ],
};

export const CRYPT_LIGHTS: LightScatter = {
  block: 9,
  chance: 0.5,
  clear: 1,
  pieces: [
    {
      weight: 3,
      parts: [{ kit: DP, node: "Prop_Brazier_01" }],
      scale: 0.4,
      flame: { color: 0xff8c28, height: 0.42, size: 0.08 },
      light: { color: 0xff9a45, intensity: 2.6, height: 0.9 },
    },
    {
      weight: 2,
      parts: [{ kit: DP, node: "Prop_Candle_Stand_01" }],
      scale: 0.4,
      flame: { color: 0xffb35c, height: 0.72, size: 0.04 },
      light: { color: 0xffb35c, intensity: 1.8, height: 0.9 },
    },
    { weight: 2, parts: [{ kit: DP, node: "Prop_TorchStick_01" }], scale: 0.62, flame: TORCH, light: TORCH_LIGHT },
  ],
};
