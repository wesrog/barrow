import type * as THREE from "three";
import type { MapMarker, Vec } from "../../sim/map";
import { HUT_RADIUS, hutRing } from "../../sim/npcs";
import { kitNode, type KitName, type Kits } from "./models";

/**
 * Viking Realm props laid around the camp's fixed markers. Decoration only:
 * nothing here collides, and the offsets keep the lanes between the spawn,
 * the fire, the trader, the healer and the waypoint clear. Rows, not code:
 * a new prop is a new row.
 */

export interface DressingRow {
  /** Marker character the prop attaches to (V trader, H healer, F fire, S stash, W waypoint, hut, or a crypt set piece). */
  marker: string;
  kit: KitName;
  node: string;
  /** Offset from the marker, in cells. */
  dx: number;
  dz: number;
  /** Yaw in radians. The camera looks in from +x +z, so "behind" a marker is -x -z. */
  ry: number;
  scale: number;
  /** Height above the floor, in world units (hanging cages, floor overlays). */
  y?: number;
  /** Stand against the nearest wall to the marker instead (`flat`: hang on its face), turned into the room, `along` cells off the marker's projection. `inset` sets the distance from the face outright (a rug before a throne). */
  wall?: boolean;
  flat?: boolean;
  along?: number;
  inset?: number;
  /** Centre a corner-pivoted piece's footprint on the point (the kit's floor tiles). */
  center?: boolean;
  /** An emissive flame above the piece. */
  flame?: { color: number; height: number; size?: number };
  /** A real point light over the piece. */
  light?: { color: number; intensity: number; height: number };
}

export interface PlaceOpts {
  /** Shift of the piece inside its wrapper, in the piece's own units (end-pivoted walls). */
  offset?: readonly [number, number, number];
  center?: boolean;
  y?: number;
  flame?: { color: number; height: number; size?: number };
  light?: { color: number; intensity: number; height: number };
}

/** The nearest wall from a cell whose face the camera can see: its direction,
 * how many cells away it stands (1 = adjacent), and a sideways step in cells
 * when the straight ray would have run out through a doorway. */
export interface WallHit {
  dx: number;
  dy: number;
  dist: number;
  along?: number;
}
export type WallToward = (x: number, y: number) => WallHit | null;

/**
 * Where a piece goes to sit against a wall: just inside the face, `along`
 * cells sideways from the cell centre `(cx, cz)`, turned so its front (+z)
 * looks into the room. Flat pieces (banners, chains) hang on the face
 * itself; the rest keep their own depth off it unless `inset` says how far.
 */
export function againstWall(
  wall: WallHit,
  cx: number,
  cz: number,
  along = 0,
  flat = false,
  inset?: number,
): { x: number; z: number; ry: number } {
  const back = wall.dist - 0.5 - (inset ?? (flat ? 0.04 : 0.22));
  const side = along + (wall.along ?? 0);
  return {
    x: cx + wall.dx * back - wall.dy * side,
    z: cz + wall.dy * back + wall.dx * side,
    ry: Math.atan2(-wall.dx, -wall.dy),
  };
}

const PROPS: KitName = "viking_props";
const Q = Math.PI / 4;
/** Marker character the scene synthesizes at each hut home. */
export const HUT_MARKER = "hut";

export const CAMP_DRESSING: readonly DressingRow[] = [
  // The fire: a ringed stone pit with logs laid in it, seats on two sides.
  { marker: "F", kit: PROPS, node: "Prop_Fire_Pit_02", dx: 0, dz: 0, ry: 0, scale: 0.6 },
  { marker: "F", kit: PROPS, node: "Prop_Fire_Pit_02_Insert_01", dx: 0, dz: 0, ry: 0, scale: 0.6 },
  { marker: "F", kit: PROPS, node: "Prop_Log_01", dx: -1.25, dz: 0.15, ry: 2 * Q + 0.2, scale: 0.55 },
  { marker: "F", kit: PROPS, node: "Prop_Log_01", dx: 0.2, dz: 1.25, ry: 0.15, scale: 0.55 },
  // The trader: an awning behind the stall (corner pivot, 1.4 cells square at
  // this scale) with wares set out in front of it.
  { marker: "V", kit: PROPS, node: "Prop_Awning_01", dx: -1.55, dz: -1.55, ry: 0, scale: 0.55 },
  { marker: "V", kit: PROPS, node: "Prop_Barrel_01", dx: 0.95, dz: 0.3, ry: 0.4, scale: 0.55 },
  { marker: "V", kit: PROPS, node: "Prop_Chest_01", dx: 0.15, dz: 1.0, ry: 4 * Q, scale: 0.55 },
  { marker: "V", kit: PROPS, node: "Prop_Sack_Pile_01", dx: -0.95, dz: 0.55, ry: 0.6, scale: 0.5 },
  // The healer: a sickbed behind her, candles and a simmering cauldron beside.
  { marker: "H", kit: PROPS, node: "Prop_Bed_02", dx: -1.05, dz: -0.85, ry: 0, scale: 0.4 },
  { marker: "H", kit: PROPS, node: "Prop_Bed_02_Insert_01", dx: -1.05, dz: -0.85, ry: 0, scale: 0.4 },
  { marker: "H", kit: PROPS, node: "Prop_Candle_01", dx: 0.85, dz: -0.65, ry: 0, scale: 0.4 },
  { marker: "H", kit: PROPS, node: "Prop_Candle_01", dx: -0.55, dz: 0.95, ry: 0, scale: 0.35 },
  { marker: "H", kit: PROPS, node: "Prop_Fire_Pit_05", dx: 0.95, dz: 0.65, ry: 0, scale: 0.6 },
  { marker: "H", kit: PROPS, node: "Prop_Fire_Pit_05_Insert_01", dx: 0.95, dz: 0.65, ry: 0, scale: 0.6 },
  { marker: "H", kit: PROPS, node: "Prop_Cauldron_03", dx: 0.95, dz: 0.65, ry: 0, scale: 0.55 },
  // The stash: a banner over it, angled to face the camera.
  { marker: "S", kit: PROPS, node: "Prop_Flag_01", dx: 1.1, dz: -1.0, ry: Q, scale: 0.5 },
  // Waypoints: a rune stone turned toward the pad, a cairn opposite.
  { marker: "W", kit: PROPS, node: "Prop_RuneStone_01", dx: -1.0, dz: -1.0, ry: -Q, scale: 0.45 },
  { marker: "W", kit: PROPS, node: "Prop_Cairn_02", dx: 1.1, dz: -0.9, ry: 0, scale: 0.4 },
  // Hut interiors (the scene passes each hut home as a "hut" marker): a cot and
  // a cooking fire along the back row, a pelt where the dweller stands.
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Bed_02", dx: -1.0, dz: -1.0, ry: 0, scale: 0.4 },
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Bed_02_Insert_01", dx: -1.0, dz: -1.0, ry: 0, scale: 0.4 },
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Fire_Pit_05", dx: 1.0, dz: -1.0, ry: 0, scale: 0.6 },
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Fire_Pit_05_Insert_01", dx: 1.0, dz: -1.0, ry: 0, scale: 0.6 },
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Cauldron_03", dx: 1.0, dz: -1.0, ry: 0, scale: 0.55 },
  { marker: HUT_MARKER, kit: PROPS, node: "Prop_Pelt_04", dx: 0.2, dz: 0.3, ry: 0.4, scale: 0.6 },
];

/**
 * A hut's wall ring in Viking log walls: one wall per edge cell, a post per
 * corner, nothing on the doorway. At 0.4 the 2.5-unit wall spans one cell and
 * its log ends overlap the neighbours; its end pivot sits 1.25 units from the
 * wall's centre, hence the inner offset.
 */
export const HUT_WALLS = {
  kit: "viking_structures" as KitName,
  wall: "Bld_Wall_Logs_01",
  post: "Bld_Pillar_01",
  scale: 0.4,
  wallOffset: [-1.25, 0, 0] as const,
};

/** Where a placed prop goes: world x/z, yaw, uniform scale, and what rides with it. */
export type PlaceProp = (node: THREE.Object3D, x: number, z: number, ry: number, scale: number, opts?: PlaceOpts) => void;

/**
 * Place every row of a table whose kit loaded around every matching marker.
 * Wall rows need `wallToward`; without it, or with no wall in reach, they are
 * skipped. Returns the marker characters that got dressed, so a scene keeps
 * primitive stand-ins only where a kit is missing.
 */
export function dressMarkers(
  kits: Kits,
  markers: readonly MapMarker[],
  rows: readonly DressingRow[],
  place: PlaceProp,
  wallToward?: WallToward,
): Set<string> {
  const dressed = new Set<string>();
  for (const marker of markers) {
    for (const row of rows) {
      if (row.marker !== marker.ch) continue;
      const node = kitNode(kits, row.kit, row.node);
      if (!node) continue;
      const opts: PlaceOpts = { y: row.y, center: row.center, flame: row.flame, light: row.light };
      if (row.wall) {
        const wall = wallToward?.(Math.floor(marker.x), Math.floor(marker.y));
        if (!wall) continue;
        const at = againstWall(wall, Math.floor(marker.x) + 0.5, Math.floor(marker.y) + 0.5, row.along, row.flat, row.inset);
        place(node, at.x, at.z, at.ry + row.ry, row.scale, opts);
      } else {
        place(node, marker.x + row.dx, marker.y + row.dz, row.ry, row.scale, opts);
      }
      dressed.add(marker.ch);
    }
  }
  return dressed;
}

/** The camp's rows, on the town's markers and the hut homes. */
export function dressCamp(kits: Kits, markers: readonly MapMarker[], place: PlaceProp): Set<string> {
  return dressMarkers(kits, markers, CAMP_DRESSING, place);
}

/**
 * Raise log walls on every hut ring cell the map keeps solid (the doorway is
 * open and gets none). Returns the cells given a wall, so the scene leaves
 * its ridge and scatter off them; empty when the structures kit is absent.
 */
export function dressHuts(
  kits: Kits,
  homes: readonly Vec[],
  isWalkable: (x: number, y: number) => boolean,
  place: PlaceProp,
): Set<string> {
  const walled = new Set<string>();
  const wall = kitNode(kits, HUT_WALLS.kit, HUT_WALLS.wall);
  const post = kitNode(kits, HUT_WALLS.kit, HUT_WALLS.post);
  if (!wall || !post) return walled;
  for (const home of homes) {
    const hx = Math.floor(home.x);
    const hy = Math.floor(home.y);
    for (const { x, y } of hutRing(home)) {
      if (isWalkable(x, y)) continue;
      const corner = Math.abs(x - hx) === HUT_RADIUS && Math.abs(y - hy) === HUT_RADIUS;
      if (corner) {
        place(post, x + 0.5, y + 0.5, 0, HUT_WALLS.scale);
      } else {
        // Walls on the north and south rows run along x; the flanks along z.
        const ry = Math.abs(y - hy) === HUT_RADIUS ? 0 : Math.PI / 2;
        place(wall, x + 0.5, y + 0.5, ry, HUT_WALLS.scale, { offset: HUT_WALLS.wallOffset });
      }
      walled.add(`${x},${y}`);
    }
  }
  return walled;
}
