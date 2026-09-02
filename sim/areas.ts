import type { MapMarker, Vec } from "./map";

/** Named surface regions of the open world. Floors keep their own `floor:N` ids. */
export type AreaId = "overworld" | "redfen" | "gallowmire" | "cragmaw";

export type BiomeId = "moor" | "fen" | "mire" | "crag";

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
  /** Fixed feature markers (vendor, healer, pads, stairs). */
  markers: MapMarker[];
  exits: AreaExit[];
  /** Cap on the distance-band difficulty bonus within the region. */
  bandCap: number;
}

export const AREAS: Record<AreaId, AreaDef> = {
  overworld: {
    id: "overworld",
    title: "The Wither Moors",
    areaLevel: 1,
    width: 64,
    height: 64,
    biome: "moor",
    gen: { density: 0.66, smooth: 4, blobs: 60, lenMin: 3, lenMax: 10, packs: 55 },
    spawnTable: ["z", "z", "z", "s", "s", "r", "e"],
    safe: { x0: 2, y0: 26, x1: 13, y1: 39 },
    spawn: { x: 7.5, y: 32.5 },
    markers: [
      { ch: "V", x: 4.5, y: 29.5 },
      { ch: "H", x: 4.5, y: 35.5 },
      { ch: "F", x: 7.5, y: 30.5 },
      { ch: "W", x: 10.5, y: 35.5 },
      { ch: ">", x: 58.5, y: 56.5 },
    ],
    exits: [{ edge: "E", at: 32, to: "redfen" }],
    bandCap: 2,
  },
  redfen: {
    id: "redfen",
    title: "The Redfen",
    areaLevel: 4,
    width: 80,
    height: 56,
    biome: "fen",
    gen: { density: 0.64, smooth: 4, blobs: 90, lenMin: 2, lenMax: 7, packs: 60 },
    spawnTable: ["h", "h", "s", "m", "r", "z", "e"],
    spawn: { x: 6.5, y: 29.5 },
    markers: [],
    exits: [
      { edge: "W", at: 29, to: "overworld" },
      { edge: "E", at: 29, to: "gallowmire" },
    ],
    bandCap: 2,
  },
  gallowmire: {
    id: "gallowmire",
    title: "The Gallowmire",
    areaLevel: 6,
    width: 56,
    height: 88,
    biome: "mire",
    gen: { density: 0.62, smooth: 4, blobs: 70, lenMin: 2, lenMax: 8, packs: 60 },
    spawnTable: ["h", "m", "m", "w", "r", "e"],
    spawn: { x: 6.5, y: 45.5 },
    markers: [],
    exits: [
      { edge: "W", at: 45, to: "redfen" },
      { edge: "E", at: 45, to: "cragmaw" },
    ],
    bandCap: 2,
  },
  cragmaw: {
    id: "cragmaw",
    title: "The Cragmaw Steps",
    areaLevel: 8,
    width: 72,
    height: 64,
    biome: "crag",
    gen: { density: 0.67, smooth: 4, blobs: 120, lenMin: 4, lenMax: 12, packs: 60 },
    spawnTable: ["w", "w", "h", "m", "m", "r"],
    spawn: { x: 6.5, y: 33.5 },
    markers: [],
    exits: [{ edge: "W", at: 33, to: "gallowmire" }],
    bandCap: 2,
  },
};

export function isAreaId(id: string): id is AreaId {
  return id in AREAS;
}
