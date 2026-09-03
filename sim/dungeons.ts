import type { AreaId } from "./areas";
import type { Vec } from "./map";
import type { ChampionModifier } from "./monsters";

/** Every crypt in the world. Finite: each has a bottom floor with a boss vault. */
export type DungeonId =
  | "barrow" | "fen_hollow" | "gallow_vault"
  | "cragmaw_delve" | "cinder_catacomb" | "crown_undercroft";

export type DungeonStyleId =
  | "barrow_halls" | "root_warren" | "gallow_ossuary"
  | "cragmaw_gouge" | "ember_catacomb" | "violet_undercroft";

/**
 * One dungeon as data: content growth is new rows here, not new code.
 * `entrance` is in the host area's local cell coordinates (cell centers, .5).
 */
export interface DungeonDef {
  id: DungeonId;
  name: string;
  area: AreaId;
  entrance: Vec;
  floors: number;
  /** Monster level on floor 1; +1 per floor below. */
  levelBase: number;
  style: DungeonStyleId;
  /** Weighted marker chars packs are drawn from (MARKER_TYPES keys). */
  spawnTable: string[];
  /** Bottom-floor vault keeper. No modifier = spawned as-is (the Barrow Lord). */
  boss: { typeId: string; modifier?: ChampionModifier };
}

/** Architectural character: same style ⇒ same generator parameters. */
export interface DungeonStyle {
  width: number;
  height: number;
  rooms: { count: number; wMin: number; wMax: number; hMin: number; hMax: number };
  /** Corridor width in cells (1 or 2). */
  corridor: number;
  /** Probability a wall cell with 3+ floor neighbors erodes to floor, per pass cell. */
  erode: number;
  /** Monster pack budget per floor. */
  packs: number;
}

export const DUNGEON_STYLES: Record<DungeonStyleId, DungeonStyle> = {
  // Clean rectangular halls under the barrow.
  barrow_halls: { width: 44, height: 36, rooms: { count: 9, wMin: 5, wMax: 9, hMin: 4, hMax: 7 }, corridor: 2, erode: 0, packs: 14 },
  // Rooty, eroded warrens under the fen.
  root_warren: { width: 40, height: 34, rooms: { count: 8, wMin: 4, wMax: 7, hMin: 4, hMax: 6 }, corridor: 1, erode: 0.45, packs: 12 },
  // Long narrow ossuary galleries.
  gallow_ossuary: { width: 48, height: 30, rooms: { count: 10, wMin: 6, wMax: 11, hMin: 3, hMax: 5 }, corridor: 1, erode: 0.1, packs: 14 },
  // Jagged gouges through the mountain.
  cragmaw_gouge: { width: 40, height: 40, rooms: { count: 8, wMin: 4, wMax: 6, hMin: 4, hMax: 6 }, corridor: 1, erode: 0.55, packs: 12 },
  // Broad scorched vaults.
  ember_catacomb: { width: 46, height: 38, rooms: { count: 9, wMin: 5, wMax: 10, hMin: 4, hMax: 8 }, corridor: 2, erode: 0.15, packs: 15 },
  // Tall cold halls under the crown.
  violet_undercroft: { width: 44, height: 40, rooms: { count: 9, wMin: 5, wMax: 8, hMin: 5, hMax: 8 }, corridor: 2, erode: 0.05, packs: 15 },
};

export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  barrow: {
    id: "barrow", name: "The Barrow Crypt", area: "overworld",
    entrance: { x: 58.5, y: 56.5 }, floors: 5, levelBase: 1, style: "barrow_halls",
    spawnTable: ["z", "z", "s", "s", "r", "e"],
    boss: { typeId: "barrow_lord" },
  },
  fen_hollow: {
    id: "fen_hollow", name: "Fen Hollow", area: "redfen",
    entrance: { x: 62.5, y: 14.5 }, floors: 2, levelBase: 4, style: "root_warren",
    spawnTable: ["h", "s", "m", "r", "z"],
    boss: { typeId: "bog_maw", modifier: "brutal" },
  },
  gallow_vault: {
    id: "gallow_vault", name: "The Gallow Vault", area: "gallowmire",
    entrance: { x: 42.5, y: 70.5 }, floors: 3, levelBase: 6, style: "gallow_ossuary",
    spawnTable: ["w", "m", "h", "r", "e"],
    boss: { typeId: "cairn_wight", modifier: "stoneskin" },
  },
  cragmaw_delve: {
    id: "cragmaw_delve", name: "Cragmaw Delve", area: "cragmaw",
    entrance: { x: 54.5, y: 16.5 }, floors: 2, levelBase: 8, style: "cragmaw_gouge",
    spawnTable: ["w", "w", "h", "m", "r"],
    boss: { typeId: "cairn_wight", modifier: "swift" },
  },
  cinder_catacomb: {
    id: "cinder_catacomb", name: "The Cinder Catacomb", area: "ashfell",
    entrance: { x: 60.5, y: 48.5 }, floors: 3, levelBase: 10, style: "ember_catacomb",
    spawnTable: ["c", "c", "a", "k", "w"],
    boss: { typeId: "ember_hulk", modifier: "volatile" },
  },
  crown_undercroft: {
    id: "crown_undercroft", name: "The Crown Undercroft", area: "hollowcrown",
    entrance: { x: 52.5, y: 46.5 }, floors: 3, levelBase: 12, style: "violet_undercroft",
    spawnTable: ["v", "n", "a", "c", "k"],
    boss: { typeId: "crown_sentinel", modifier: "brutal" },
  },
};

/** Registry insertion order — the one iteration order for generation. */
export const DUNGEON_ORDER = Object.keys(DUNGEONS) as DungeonId[];

export function isDungeonId(id: string): id is DungeonId {
  return id in DUNGEONS;
}
