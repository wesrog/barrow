import type { DressingRow } from "./campDressing";
import type { KitName } from "./models";

/**
 * How the wilds dress their landmarks (sim/landmarks.ts): a row table per
 * marker character, offsets in cells from the marker, the same shape the
 * camp uses. The sim owns each landmark's footprint (the cells it walls);
 * these rows put the matching kit pieces on and around those cells, so a
 * tent stands where the map says nobody can walk. Rows, not code.
 */

const VP: KitName = "viking_props";
const VN: KitName = "viking_nature";
const D: KitName = "dungeon";
const DP: KitName = "dungeon_props";
const Q = Math.PI / 4;

const CANDLE = { color: 0xffb35c, height: 0.2, size: 0.03 };
const WITCHLIGHT = { color: 0x7fd0ff, height: 0.24, size: 0.03 };

/** The engraved standing stone, turned to face the ring's centre from a cell offset. */
const stone = (dx: number, dz: number): DressingRow => ({
  marker: "O",
  kit: VN,
  node: "Env_Stone_Engraved_03",
  dx,
  dz,
  ry: Math.atan2(-dx, -dz),
  scale: 0.75,
});

/** A ruined wall segment centred on a cell; the kit's walls carry an end pivot, so `center` seats them. */
const ruinWall = (node: string, dx: number, dz: number, ry: number): DressingRow => ({
  marker: "U",
  kit: D,
  node,
  dx,
  dz,
  ry,
  scale: 0.2,
  center: true,
});

export const WILD_SET_PIECES: readonly DressingRow[] = [
  // O: the stone circle. Six engraved stones on the ring, a rune floor and
  // cold candles in the middle where the circle's keepers wait.
  stone(2, 0),
  stone(1, 2),
  stone(-1, 2),
  stone(-2, 0),
  stone(-1, -2),
  stone(1, -2),
  { marker: "O", kit: D, node: "Env_Tiles_Rune_02", dx: 0, dz: 0, ry: 0, scale: 0.5, y: 0.02, center: true },
  { marker: "O", kit: VP, node: "Prop_Candle_02", dx: 0.9, dz: 0.5, ry: 0, scale: 0.6, flame: WITCHLIGHT },
  { marker: "O", kit: VP, node: "Prop_Candle_02", dx: -0.9, dz: 0.5, ry: 1, scale: 0.6, flame: WITCHLIGHT },
  { marker: "O", kit: VP, node: "Prop_Candle_02", dx: 0.2, dz: -1.0, ry: 2, scale: 0.6, flame: WITCHLIGHT, light: { color: 0x7fd0ff, intensity: 1.8, height: 0.9 } },
  // U: the ruin. Two walls of a lost hall, its floor, a fallen pillar, and
  // the last of whoever held it.
  ruinWall("Env_Wall_Half_01", -2, -2, 0),
  ruinWall("Env_Wall_04", -1, -2, 0),
  ruinWall("Env_Wall_04", 0, -2, 0),
  ruinWall("Env_Wall_Broken_Edge_02", 1, -2, 0),
  ruinWall("Env_Wall_04", -2, -1, Math.PI / 2),
  ruinWall("Env_Wall_04", -2, 0, Math.PI / 2),
  ruinWall("Env_Wall_Broken_Edge_01", -2, 1, Math.PI / 2),
  { marker: "U", kit: D, node: "Env_Tiles_Ornate_01", dx: -0.5, dz: -0.5, ry: 0, scale: 0.4, y: 0.01, center: true },
  { marker: "U", kit: D, node: "Env_Pillar_Broken_01", dx: 2, dz: 1, ry: 0.3, scale: 0.5 },
  { marker: "U", kit: D, node: "Env_Pillar_Broken_Pile_01", dx: 1.4, dz: 0.4, ry: 0.8, scale: 0.45 },
  { marker: "U", kit: D, node: "Env_Rubble_01", dx: -1.1, dz: -1.1, ry: 0.5, scale: 0.15 },
  { marker: "U", kit: DP, node: "Prop_Skeleton_01", dx: 0.3, dz: 0.4, ry: 0.7, scale: 0.55 },
  { marker: "U", kit: DP, node: "Prop_Vase_Broken_01", dx: -1.4, dz: 0.7, ry: 0, scale: 0.5 },
  { marker: "U", kit: DP, node: "Prop_Vase_01", dx: 0.8, dz: -1.5, ry: 0.4, scale: 0.5 },
  { marker: "U", kit: D, node: "Env_Mushroom_Small_02", dx: 1.4, dz: -1.5, ry: 0, scale: 0.4 },
  // C: the raider camp. Two tents and a watchtower around a cook fire, a
  // spike wall on the open side, the plunder between the tents.
  { marker: "C", kit: DP, node: "Prop_Goblin_Tent_01", dx: -2.5, dz: -1.5, ry: 0.4, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Tent_02", dx: 1.5, dz: -1.5, ry: -0.5, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Tower_01", dx: -2.5, dz: 1.5, ry: Q, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Spikes_01", dx: 3, dz: 0.5, ry: Math.PI / 2, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Fence_01", dx: 0, dz: 2.9, ry: 0.1, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Fence_01", dx: 1.1, dz: 3.0, ry: -0.2, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Bonfire_01", dx: 0, dz: 0.2, ry: 0, scale: 0.5, flame: { color: 0xff8c28, height: 0.55, size: 0.12 }, light: { color: 0xff9a45, intensity: 3.2, height: 1.0 } },
  { marker: "C", kit: DP, node: "Prop_Goblin_Rotisserie_Meat_01", dx: 0, dz: 0.2, ry: 0, scale: 0.45 },
  { marker: "C", kit: DP, node: "Prop_Goblin_Drum_01", dx: 1.4, dz: 1.3, ry: 0.3, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Skeleton_Cage_01", dx: -1.5, dz: 1.7, ry: 0.6, scale: 0.45, y: 0.7 },
  { marker: "C", kit: DP, node: "Prop_Log_Spike_01", dx: 2.6, dz: -0.6, ry: 0, scale: 0.4, y: 0.55 },
  { marker: "C", kit: DP, node: "Prop_Log_Spike_01", dx: -1.0, dz: 2.7, ry: 0.5, scale: 0.4, y: 0.55 },
  { marker: "C", kit: DP, node: "Prop_Crate_Wood_02", dx: 0.8, dz: -2.6, ry: 0.3, scale: 0.5 },
  { marker: "C", kit: DP, node: "Prop_Barrel_02", dx: -0.5, dz: -2.7, ry: 0, scale: 0.5 },
  // N: the cold camp. A dead fire, a log, the traveller's pack, and the traveller.
  { marker: "N", kit: VP, node: "Prop_Fire_Pit_02", dx: 0, dz: 0, ry: 0, scale: 0.6 },
  { marker: "N", kit: VP, node: "Prop_Fire_Pit_02_Insert_01", dx: 0, dz: 0, ry: 0, scale: 0.6 },
  { marker: "N", kit: VP, node: "Prop_Log_02", dx: -1.1, dz: 0.5, ry: 0.3, scale: 0.55 },
  { marker: "N", kit: VP, node: "Prop_Sack_02", dx: 0.9, dz: -0.9, ry: 0, scale: 0.6 },
  { marker: "N", kit: VP, node: "Prop_Basket_01", dx: 1.4, dz: -0.4, ry: 0.5, scale: 0.6 },
  { marker: "N", kit: VP, node: "Prop_Pelt_01", dx: -0.5, dz: 1.4, ry: 1.0, scale: 0.35 },
  { marker: "N", kit: VP, node: "Prop_Fish_Rack_01", dx: -1.6, dz: -1.3, ry: 0.6, scale: 0.5 },
  { marker: "N", kit: DP, node: "Prop_Skeleton_01", dx: 0.7, dz: 1.9, ry: -0.4, scale: 0.55 },
  { marker: "N", kit: VP, node: "Prop_Canteen_01", dx: 0.4, dz: 0.9, ry: 0.2, scale: 0.6 },
  // X: the old shrine. A weathered idol over a rune floor, candles still lit,
  // offerings in a bowl, engraved stones sunk in the turf.
  { marker: "X", kit: VP, node: "Prop_Statue_02", dx: 0, dz: -2, ry: 0, scale: 0.22 },
  { marker: "X", kit: D, node: "Env_Tiles_Rune_02", dx: 0, dz: -0.5, ry: 0, scale: 0.4, y: 0.02, center: true },
  { marker: "X", kit: VP, node: "Prop_Candle_02", dx: -0.6, dz: -1.1, ry: 0.4, scale: 0.6, flame: CANDLE },
  { marker: "X", kit: VP, node: "Prop_Candle_02", dx: 0.6, dz: -1.1, ry: -0.4, scale: 0.6, flame: CANDLE },
  { marker: "X", kit: VP, node: "Prop_Candle_02", dx: 0, dz: -0.6, ry: 0, scale: 0.6, flame: CANDLE, light: { color: 0xffb35c, intensity: 1.8, height: 0.9 } },
  { marker: "X", kit: VP, node: "Prop_Bowl_01", dx: -0.2, dz: -1.3, ry: 0, scale: 0.6 },
  { marker: "X", kit: VP, node: "Prop_Cairn_01", dx: 1.4, dz: -1.6, ry: 0.3, scale: 0.6 },
  { marker: "X", kit: VN, node: "Env_Stone_Engraved_01", dx: -1.5, dz: -1.4, ry: 0.8, scale: 0.8 },
  { marker: "X", kit: VN, node: "Env_Stone_Engraved_02", dx: 1.6, dz: -0.5, ry: 2.2, scale: 0.8 },
];
