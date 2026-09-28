import type { KitName } from "./models";

/**
 * How the crypt dresses itself from the Dungeon Pack: a palette of loose
 * props scattered along the walls by the cell hash (weighted per crypt style
 * in biomes.ts), and set pieces laid around the generator's room markers
 * (throne room, gaol, library, ritual circle, the halls' rune floors, the
 * stairs, the boss vault). Rows, not code: a new prop is a new row.
 */

export type DressingFamily =
  | "coffins"
  | "bones"
  | "columns"
  | "vases"
  | "rubble"
  | "remains"
  | "candles"
  | "chains"
  | "banners"
  | "cages"
  | "furniture"
  | "mushrooms"
  | "lanterns";

/** A loose prop. `wall` pieces stand against the nearest wall face (`flat`
 * ones hang on it); `y` lifts a piece (hanging cages); `center` puts a
 * corner-pivoted tile's footprint on the point. */
export interface DressPiece {
  kit: KitName;
  node: string;
  scale: number;
  y?: number;
  wall?: boolean;
  flat?: boolean;
  center?: boolean;
  /** An emissive flame above the piece, in this colour, at this height. */
  flame?: { color: number; height: number; size?: number };
}

const D: KitName = "dungeon";
const P: KitName = "dungeon_props";

export const DUNGEON_DRESSING: Record<DressingFamily, DressPiece[]> = {
  coffins: [
    { kit: P, node: "Prop_Coffin_01", scale: 0.36 },
  ],
  bones: [
    { kit: D, node: "Env_BonePile_Small_01", scale: 0.4 },
    { kit: D, node: "Env_BonePile_Small_02", scale: 0.4 },
    { kit: D, node: "Env_BonePile_01", scale: 0.28 },
  ],
  columns: [
    { kit: D, node: "Env_Pillar_Square_01", scale: 0.34 },
    { kit: D, node: "Env_Pillar_Round_03", scale: 0.28 },
    { kit: D, node: "Env_Pillar_Broken_02", scale: 0.34 },
    { kit: D, node: "Env_Rune_Pillar_01", scale: 0.34, flame: { color: 0x7fd0ff, height: 0.86, size: 0.05 } },
  ],
  vases: [
    { kit: P, node: "Prop_Vase_Group_01", scale: 0.42 },
    { kit: P, node: "Prop_Vase_01", scale: 0.5 },
    { kit: P, node: "Prop_Vase_06", scale: 0.5 },
    { kit: P, node: "Prop_Vase_Broken_02", scale: 0.5 },
  ],
  rubble: [
    { kit: D, node: "Env_Rubble_Pebbles_02", scale: 0.4 },
    { kit: D, node: "Env_Rubble_Plank_02", scale: 0.4 },
    { kit: P, node: "Prop_Bricks_04", scale: 0.4 },
  ],
  remains: [
    { kit: P, node: "Prop_Skeleton_01", scale: 0.4 },
    { kit: P, node: "Prop_Skeleton_Slave_Lying_01", scale: 0.38 },
    { kit: P, node: "Prop_Skeleton_Slave_Wall_Sitting_01", scale: 0.4, wall: true },
  ],
  candles: [
    { kit: P, node: "Prop_Candles_01", scale: 0.6, flame: { color: 0xffb35c, height: 0.24, size: 0.035 } },
    { kit: P, node: "Prop_Candles_04", scale: 0.6, flame: { color: 0xffb35c, height: 0.22, size: 0.035 } },
    { kit: P, node: "Prop_Candle_Stand_01", scale: 0.4, flame: { color: 0xffb35c, height: 0.72, size: 0.04 } },
  ],
  chains: [
    { kit: P, node: "Prop_Chain_04", scale: 0.4, wall: true, flat: true, y: 0.9 },
    { kit: P, node: "Prop_Chain_08", scale: 0.4, wall: true, flat: true, y: 0.8 },
    { kit: P, node: "Prop_Skeleton_Slave_Shackles_01", scale: 0.4, wall: true, flat: true },
  ],
  banners: [
    { kit: P, node: "Prop_Wall_Banner_01", scale: 0.32, wall: true, flat: true, y: 0.1 },
    { kit: P, node: "Prop_Wall_Banner_02", scale: 0.32, wall: true, flat: true, y: 0.1 },
    { kit: P, node: "Prop_Wall_Banner_03", scale: 0.4, wall: true, flat: true, y: 0.55 },
  ],
  cages: [
    { kit: P, node: "Prop_Skeleton_Cage_01", scale: 0.4, y: 0.75 },
    { kit: P, node: "Prop_Toture_Cage_01", scale: 0.38, y: 0.7 },
  ],
  furniture: [
    { kit: P, node: "Prop_StoneChair_01", scale: 0.4 },
    { kit: P, node: "Prop_Stool_01", scale: 0.4 },
    { kit: P, node: "Prop_Table_Round_02", scale: 0.4 },
    { kit: P, node: "Prop_WeaponRack_01", scale: 0.4, wall: true },
    { kit: P, node: "Prop_Bookcase_01", scale: 0.4, wall: true },
  ],
  mushrooms: [
    { kit: D, node: "Env_Mushroom_Giant_01", scale: 0.2 },
    { kit: D, node: "Env_Mushroom_Giant_03", scale: 0.16 },
    { kit: D, node: "Env_Mushroom_Small_01", scale: 0.4 },
    { kit: D, node: "Env_Mushroom_Small_03", scale: 0.4 },
    { kit: D, node: "Env_Mushroom_Wall_01", scale: 0.35, wall: true, flat: true, y: 0.5 },
  ],
  lanterns: [
    { kit: P, node: "Prop_Lantern_01", scale: 0.4, wall: true, flat: true, y: 0.95, flame: { color: 0xffc46a, height: 1.08, size: 0.035 } },
    { kit: P, node: "Prop_Lantern_02", scale: 0.4, wall: true, flat: true, y: 0.95, flame: { color: 0xffc46a, height: 1.08, size: 0.035 } },
  ],
};

/** One prop of a set piece: offsets in cells from the marker, or against the
 * nearest wall (`flat` ones on it) `along` cells off the marker's projection.
 * The same row shape the camp dressing uses. */
export interface SetPieceRow {
  marker: string;
  kit: KitName;
  node: string;
  dx: number;
  dz: number;
  ry: number;
  scale: number;
  y?: number;
  wall?: boolean;
  flat?: boolean;
  along?: number;
  inset?: number;
  center?: boolean;
  flame?: { color: number; height: number; size?: number };
  /** A real point light, for the few pieces that carry the room. */
  light?: { color: number; intensity: number; height: number };
}

const EMBER = { color: 0xff9a45, intensity: 2.2, height: 0.9 };
const CANDLE = { color: 0xffb35c, height: 0.24, size: 0.035 };
const BRAZIER = { color: 0xff9030, height: 0.42, size: 0.09 };

export const CRYPT_SET_PIECES: readonly SetPieceRow[] = [
  // R: the open halls. A rune floor under the crowd, braziers at its corners.
  { marker: "R", kit: D, node: "Env_Tiles_Rune_01", dx: 0, dz: 0, ry: 0, scale: 0.6, y: 0.03, center: true },
  { marker: "R", kit: P, node: "Prop_Brazier_01", dx: -1.8, dz: -1.8, ry: 0, scale: 0.4, flame: BRAZIER, light: EMBER },
  { marker: "R", kit: P, node: "Prop_Brazier_01", dx: 1.8, dz: 1.8, ry: 0, scale: 0.4, flame: BRAZIER },
  { marker: "R", kit: D, node: "Env_Pillar_Round_01", dx: -1.8, dz: 1.8, ry: 0, scale: 0.3 },
  { marker: "R", kit: D, node: "Env_Pillar_Round_01", dx: 1.8, dz: -1.8, ry: 0, scale: 0.3 },
  // K: the throne room. A knight still on his throne against the far wall, a
  // rug before him, candle stands and banners either side.
  { marker: "K", kit: P, node: "Prop_Skeleton_Knight_Throne_01", dx: 0, dz: 0, ry: 0, scale: 0.46, wall: true },
  { marker: "K", kit: P, node: "Prop_Rug_02", dx: 0, dz: 0, ry: 0, scale: 0.34, y: 0.02, wall: true, inset: 1.4 },
  { marker: "K", kit: P, node: "Prop_Candle_Stand_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: -1.1, flame: { color: 0xffb35c, height: 0.72, size: 0.04 }, light: { color: 0xffb35c, intensity: 1.6, height: 0.9 } },
  { marker: "K", kit: P, node: "Prop_Candle_Stand_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: 1.1, flame: { color: 0xffb35c, height: 0.72, size: 0.04 } },
  { marker: "K", kit: P, node: "Prop_Wall_Banner_04", dx: 0, dz: 0, ry: 0, flat: true, scale: 0.3, wall: true, along: -2.1, y: 0.1 },
  { marker: "K", kit: P, node: "Prop_Wall_Banner_04", dx: 0, dz: 0, ry: 0, flat: true, scale: 0.3, wall: true, along: 2.1, y: 0.1 },
  // G: the gaol. Cages hung from the dark, stocks, an iron maiden and
  // shackles on the wall.
  { marker: "G", kit: P, node: "Prop_Toture_Stocks_01", dx: 0.2, dz: 0.4, ry: 0.6, scale: 0.4 },
  { marker: "G", kit: P, node: "Prop_Skeleton_Cage_01", dx: -1.4, dz: -0.6, ry: 0.3, scale: 0.4, y: 0.75 },
  { marker: "G", kit: P, node: "Prop_Toture_Cage_01", dx: 1.5, dz: -0.9, ry: 0, scale: 0.38, y: 0.7 },
  { marker: "G", kit: P, node: "Prop_Toture_IronMaiden_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: -1.2 },
  { marker: "G", kit: P, node: "Prop_Skeleton_Slave_Shackles_01", dx: 0, dz: 0, ry: 0, flat: true, scale: 0.4, wall: true, along: 1.2 },
  { marker: "G", kit: P, node: "Prop_Chain_06", dx: 0, dz: 0, ry: 0, flat: true, scale: 0.4, wall: true, along: 2.2, y: 0.8 },
  { marker: "G", kit: P, node: "Prop_Brazier_01", dx: -1.6, dz: 1.2, ry: 0, scale: 0.36, flame: BRAZIER, light: EMBER },
  { marker: "G", kit: P, node: "Prop_Toture_StretchTable_01", dx: 1.4, dz: 1.3, ry: -0.4, scale: 0.4 },
  // L: the library. Bookcases on the wall, a reading table with its last
  // reader still at it, candles.
  { marker: "L", kit: P, node: "Prop_Bookcase_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: -1.0 },
  { marker: "L", kit: P, node: "Prop_Bookcase_02", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: 0.1 },
  { marker: "L", kit: P, node: "Prop_Bookcase_03", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: 1.3 },
  { marker: "L", kit: P, node: "Prop_Skeleton_Table_01", dx: 0.3, dz: 0.6, ry: -0.5, scale: 0.4 },
  { marker: "L", kit: P, node: "Prop_StoneChair_01", dx: -1.1, dz: 0.9, ry: 1.1, scale: 0.4 },
  { marker: "L", kit: P, node: "Prop_Candle_Stand_01", dx: 1.4, dz: 0.2, ry: 0, scale: 0.4, flame: { color: 0xffb35c, height: 0.72, size: 0.04 }, light: { color: 0xffb35c, intensity: 1.6, height: 0.9 } },
  { kit: P, marker: "L", node: "Item_BookPile_01", dx: -0.6, dz: -0.4, ry: 0.4, scale: 0.6 },
  // P: the ritual circle. A pentagram floor, candles at its points, an orb
  // glowing over the middle, braziers behind.
  { marker: "P", kit: D, node: "Env_Tiles_Pentagram_01", dx: 0, dz: 0, ry: 0, scale: 0.42, y: 0.03, center: true },
  { marker: "P", kit: D, node: "Env_GlowingOrb_04", dx: 0, dz: 0, ry: 0, scale: 0.5, light: { color: 0x8a5ae8, intensity: 2.6, height: 0.7 } },
  { marker: "P", kit: P, node: "Prop_Candles_02", dx: 1.2, dz: 0, ry: 0, scale: 0.6, flame: CANDLE },
  { marker: "P", kit: P, node: "Prop_Candles_03", dx: -1.2, dz: 0, ry: 0, scale: 0.6, flame: CANDLE },
  { marker: "P", kit: P, node: "Prop_Candles_01", dx: 0, dz: 1.2, ry: 0, scale: 0.6, flame: CANDLE },
  { marker: "P", kit: P, node: "Prop_Candles_04", dx: 0, dz: -1.2, ry: 0, scale: 0.6, flame: CANDLE },
  { marker: "P", kit: P, node: "Prop_Brazier_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: -1.4, flame: BRAZIER },
  { marker: "P", kit: P, node: "Prop_Brazier_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, along: 1.4, flame: BRAZIER },
  { marker: "P", kit: P, node: "Prop_Cauldron_01", dx: 0, dz: 0, ry: 0, scale: 0.4, wall: true, flame: { color: 0x7fe08a, height: 0.5, size: 0.06 } },
  // !: the boss vault. An ornate floor, rune pillars, a banner over the throne wall.
  { marker: "!", kit: D, node: "Env_Tiles_Ornate_01", dx: 0, dz: 0, ry: 0, scale: 0.6, y: 0.03, center: true },
  { marker: "!", kit: D, node: "Env_Rune_Pillar_02", dx: -1.6, dz: -1.6, ry: 0, scale: 0.36, flame: { color: 0xc45a30, height: 0.86, size: 0.05 } },
  { marker: "!", kit: D, node: "Env_Rune_Pillar_02", dx: 1.6, dz: -1.6, ry: 0, scale: 0.36, flame: { color: 0xc45a30, height: 0.86, size: 0.05 } },
  { marker: "!", kit: P, node: "Prop_Wall_Banner_05", dx: 0, dz: 0, ry: 0, flat: true, scale: 0.28, wall: true, y: 0.1 },
  // <: the way up. Two braziers to mark it.
  { marker: "<", kit: P, node: "Prop_Brazier_01", dx: -1.1, dz: 1.1, ry: 0, scale: 0.36, flame: BRAZIER },
  { marker: "<", kit: P, node: "Prop_Brazier_01", dx: 1.1, dz: 1.1, ry: 0, scale: 0.36, flame: BRAZIER },
];
