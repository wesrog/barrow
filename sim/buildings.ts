import type { Vec } from "./map";

/**
 * Buildings on safe ground: a rectangle of wall cells with one door cell
 * open and floor inside, like a hut dweller's ring but any size and with no
 * dweller. The zone carver stamps them, the renderer raises log walls on
 * the same cells (client/render/campDressing.ts) and dresses the inside by
 * the marker character the carver leaves at the centre. Rows, not code.
 */
export interface BuildingDef {
  /** The marker character left at the centre for the renderer's interior rows. */
  ch: string;
  /** The wall ring's bounds, inclusive, in area-local cells. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The one ring cell left open. */
  door: readonly [number, number];
}

/** The ring's cells, row by row. */
export function buildingRing(b: BuildingDef): Vec[] {
  const cells: Vec[] = [];
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1) cells.push({ x, y });
    }
  }
  return cells;
}

/** The cells inside the ring. */
export function buildingInterior(b: BuildingDef): Vec[] {
  const cells: Vec[] = [];
  for (let y = b.y0 + 1; y < b.y1; y++) {
    for (let x = b.x0 + 1; x < b.x1; x++) cells.push({ x, y });
  }
  return cells;
}

/** Where the interior marker sits: the middle of the inside, at a cell centre. */
export function buildingCentre(b: BuildingDef): Vec {
  return { x: Math.floor((b.x0 + b.x1) / 2) + 0.5, y: Math.floor((b.y0 + b.y1) / 2) + 0.5 };
}

export function isBuildingCorner(b: BuildingDef, x: number, y: number): boolean {
  return (x === b.x0 || x === b.x1) && (y === b.y0 || y === b.y1);
}
