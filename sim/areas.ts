import type { BuildingDef } from "./buildings";
import type { MapMarker, Vec } from "./map";

/** Named surface regions of the open world. Floors keep their own `floor:N` ids. */
export type AreaId =
  | "overworld"
  | "redfen"
  | "gallowmire"
  | "cragmaw"
  | "ashfell"
  | "hollowcrown";

export type BiomeId = "moor" | "fen" | "mire" | "crag" | "ash" | "hollow";

/** A 3-wide opening in the rim, centered `at` cells along the given edge. */
export interface AreaExit {
  edge: "N" | "S" | "E" | "W";
  at: number;
  to: AreaId;
}

/**
 * One surface region as data: content growth is new rows here, not new code.
 * The safe rect, spawn, fixed markers, and exit openings are seed-independent.
 * Wild regions carry no safe rect and no fixed W marker — their waypoint hides
 * at a seed-random spot, resolved against the generated map when needed.
 */
export interface AreaDef {
  id: AreaId;
  title: string;
  /** Difficulty: monster/loot scaling for this region, as old `depth` was. */
  areaLevel: number;
  width: number;
  height: number;
  biome: BiomeId;
  gen: {
    /** Initial floor probability for the landmass seeding pass. */
    density: number;
    /** Cellular-automata smoothing iterations shaping the blob. */
    smooth: number;
    /** Interior crag/copse random-walk texture passes. */
    blobs: number;
    lenMin: number;
    lenMax: number;
    /** Monster pack markers to scatter over the open ground. */
    packs: number;
  };
  /** Weighted marker chars packs are drawn from. */
  spawnTable: string[];
  /**
   * Safe ground rect (half-open, in cells); becomes the map's `camp`.
   * Only the town has one — the wild regions are hostile end to end.
   */
  safe?: { x0: number; y0: number; x1: number; y1: number };
  /** Player arrival point, on safe ground. */
  spawn: Vec;
  /** Fixed feature markers (vendor, healer, pads, stairs, camp furniture). */
  markers: MapMarker[];
  exits: AreaExit[];
  /** Cap on the distance-band difficulty bonus within the region. */
  bandCap: number;
  /** Landmarks to raise in the wilds, one character each (sim/landmarks.ts). */
  landmarks?: string;
  /** Walled buildings on safe ground (sim/buildings.ts). */
  buildings?: BuildingDef[];
}

export const AREAS: Record<AreaId, AreaDef> = {
  overworld: {
    id: "overworld",
    title: "The Wither Moors",
    areaLevel: 1,
    width: 64,
    height: 64,
    biome: "moor",
    gen: { density: 0.66, smooth: 4, blobs: 60, lenMin: 3, lenMax: 10, packs: 30 },
    spawnTable: ["z", "z", "z", "s", "s", "r"],
    safe: { x0: 2, y0: 24, x1: 20, y1: 40 },
    spawn: { x: 7.5, y: 32.5 },
    markers: [
      { ch: "V", x: 4.5, y: 29.5 },
      { ch: "H", x: 4.5, y: 35.5 },
      { ch: "F", x: 7.5, y: 30.5 },
      { ch: "S", x: 10.5, y: 30.5 },
      { ch: "W", x: 10.5, y: 35.5 },
      // Camp furniture, dressed by the renderer: the smith's corner, the mead
      // table, the training yard, the town shrine.
      { ch: "A", x: 10.5, y: 25.5 },
      { ch: "M", x: 6.5, y: 25.5 },
      { ch: "T", x: 7.5, y: 37.5 },
      { ch: "Y", x: 12.5, y: 34.5 },
    ],
    // The jarl's hall north of the gate road, the storehouse south of it.
    buildings: [
      { ch: "J", x0: 13, y0: 25, x1: 19, y1: 29, door: [16, 29] },
      { ch: "D", x0: 14, y0: 34, x1: 18, y1: 38, door: [14, 36] },
    ],
    exits: [{ edge: "E", at: 32, to: "redfen" }],
    bandCap: 2,
    landmarks: "OUCNX",
  },
  redfen: {
    id: "redfen",
    title: "The Redfen",
    areaLevel: 4,
    width: 80,
    height: 56,
    biome: "fen",
    gen: { density: 0.64, smooth: 4, blobs: 90, lenMin: 2, lenMax: 7, packs: 34 },
    spawnTable: ["h", "h", "s", "m", "r", "z"],
    spawn: { x: 6.5, y: 29.5 },
    markers: [],
    exits: [
      { edge: "W", at: 29, to: "overworld" },
      { edge: "E", at: 29, to: "gallowmire" },
    ],
    bandCap: 2,
    landmarks: "UUCNX",
  },
  gallowmire: {
    id: "gallowmire",
    title: "The Gallowmire",
    areaLevel: 6,
    width: 56,
    height: 88,
    biome: "mire",
    gen: { density: 0.62, smooth: 4, blobs: 70, lenMin: 2, lenMax: 8, packs: 34 },
    spawnTable: ["h", "m", "m", "w", "r"],
    spawn: { x: 6.5, y: 45.5 },
    markers: [],
    exits: [
      { edge: "W", at: 45, to: "redfen" },
      { edge: "E", at: 45, to: "cragmaw" },
    ],
    bandCap: 2,
    landmarks: "OUCCX",
  },
  cragmaw: {
    id: "cragmaw",
    title: "The Cragmaw Steps",
    areaLevel: 8,
    width: 72,
    height: 64,
    biome: "crag",
    gen: { density: 0.67, smooth: 4, blobs: 120, lenMin: 4, lenMax: 12, packs: 34 },
    spawnTable: ["w", "w", "h", "m", "m", "r"],
    spawn: { x: 6.5, y: 33.5 },
    markers: [],
    exits: [
      { edge: "W", at: 33, to: "gallowmire" },
      { edge: "E", at: 33, to: "ashfell" },
    ],
    bandCap: 2,
    landmarks: "UUNX",
  },
  ashfell: {
    id: "ashfell",
    title: "The Ashfell",
    areaLevel: 10,
    width: 80,
    height: 64,
    biome: "ash",
    gen: { density: 0.65, smooth: 4, blobs: 100, lenMin: 3, lenMax: 10, packs: 34 },
    spawnTable: ["c", "c", "a", "k", "w", "r"],
    spawn: { x: 6.5, y: 33.5 },
    markers: [],
    exits: [
      { edge: "W", at: 33, to: "cragmaw" },
      { edge: "E", at: 33, to: "hollowcrown" },
    ],
    bandCap: 2,
    landmarks: "UCCNX",
  },
  hollowcrown: {
    id: "hollowcrown",
    title: "The Hollowcrown",
    areaLevel: 12,
    width: 72,
    height: 64,
    biome: "hollow",
    gen: { density: 0.66, smooth: 4, blobs: 110, lenMin: 3, lenMax: 11, packs: 34 },
    spawnTable: ["v", "n", "a", "c", "k", "m"],
    spawn: { x: 6.5, y: 33.5 },
    markers: [],
    exits: [{ edge: "W", at: 33, to: "ashfell" }],
    bandCap: 2,
    landmarks: "OUUX",
  },
};

export function isAreaId(id: string): id is AreaId {
  return id in AREAS;
}
