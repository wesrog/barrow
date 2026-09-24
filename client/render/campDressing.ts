import type * as THREE from "three";
import type { MapMarker } from "../../sim/map";
import { kitNode, type KitName, type Kits } from "./models";

/**
 * Viking Realm props laid around the camp's fixed markers. Decoration only:
 * nothing here collides, and the offsets keep the lanes between the spawn,
 * the fire, the trader, the healer and the waypoint clear. Rows, not code:
 * a new prop is a new row.
 */

export interface DressingRow {
  /** Marker character the prop attaches to (V trader, H healer, F fire, S stash, W waypoint). */
  marker: string;
  kit: KitName;
  node: string;
  /** Offset from the marker, in cells. */
  dx: number;
  dz: number;
  /** Yaw in radians. The camera looks in from +x +z, so "behind" a marker is -x -z. */
  ry: number;
  scale: number;
}

const PROPS: KitName = "viking_props";
const Q = Math.PI / 4;

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
];

/** Where a placed prop goes: world x/z, yaw, uniform scale. */
export type PlaceProp = (node: THREE.Object3D, x: number, z: number, ry: number, scale: number) => void;

/**
 * Place every row whose kit loaded around every matching marker. Returns the
 * marker characters that got dressed, so the scene keeps its primitive
 * stand-ins (stone ring, dungeon crates) only where the kit is missing.
 */
export function dressCamp(kits: Kits, markers: readonly MapMarker[], place: PlaceProp): Set<string> {
  const dressed = new Set<string>();
  for (const marker of markers) {
    for (const row of CAMP_DRESSING) {
      if (row.marker !== marker.ch) continue;
      const node = kitNode(kits, row.kit, row.node);
      if (!node) continue;
      place(node, marker.x + row.dx, marker.y + row.dz, row.ry, row.scale);
      dressed.add(marker.ch);
    }
  }
  return dressed;
}
