// Where each surface region sits in world space, and helpers that resolve
// world positions back to region labels. Pure functions of the AREAS registry.

import { AREAS, waypointPos, type AreaId } from "./areas";
import type { Vec } from "./map";

/** Registry insertion order — the one iteration order for generation and rendering. */
export const AREA_ORDER = Object.keys(AREAS) as AreaId[];

/** Half-open cell rectangle, world coordinates. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SurfaceLayout {
  offsets: Record<AreaId, Vec>;
  width: number;
  height: number;
}

export function inRect(r: Rect, pos: Vec): boolean {
  return pos.x >= r.x0 && pos.x < r.x1 && pos.y >= r.y0 && pos.y < r.y1;
}

let cachedLayout: SurfaceLayout | null = null;

/**
 * Region offsets derived from the exit graph: each neighbor sits edge-to-edge
 * with the reciprocal exits' rows (E/W) or columns (N/S) aligned, then the
 * whole arrangement is shifted so the bounding box starts at (0,0).
 */
export function surfaceLayout(): SurfaceLayout {
  if (cachedLayout) return cachedLayout;
  const raw: Partial<Record<AreaId, Vec>> = { [AREA_ORDER[0]!]: { x: 0, y: 0 } };
  const queue: AreaId[] = [AREA_ORDER[0]!];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const def = AREAS[id];
    const at = raw[id]!;
    for (const e of def.exits) {
      if (raw[e.to]) continue;
      const nDef = AREAS[e.to];
      const back = nDef.exits.find((x) => x.to === id);
      if (!back) throw new Error(`no reciprocal exit: ${id} -> ${e.to}`);
      raw[e.to] =
        e.edge === "E"
          ? { x: at.x + def.width, y: at.y + e.at - back.at }
          : e.edge === "W"
            ? { x: at.x - nDef.width, y: at.y + e.at - back.at }
            : e.edge === "S"
              ? { x: at.x + e.at - back.at, y: at.y + def.height }
              : { x: at.x + e.at - back.at, y: at.y - nDef.height };
      queue.push(e.to);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of AREA_ORDER) {
    const o = raw[id];
    if (!o) throw new Error(`area unreachable from ${AREA_ORDER[0]}: ${id}`);
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + AREAS[id].width);
    maxY = Math.max(maxY, o.y + AREAS[id].height);
  }
  const offsets = {} as Record<AreaId, Vec>;
  for (const id of AREA_ORDER) {
    offsets[id] = { x: raw[id]!.x - minX, y: raw[id]!.y - minY };
  }
  cachedLayout = { offsets, width: maxX - minX, height: maxY - minY };
  return cachedLayout;
}

/** A region's bounds in world coordinates. */
export function areaRect(id: AreaId): Rect {
  const o = surfaceLayout().offsets[id];
  const def = AREAS[id];
  return { x0: o.x, y0: o.y, x1: o.x + def.width, y1: o.y + def.height };
}

/** Which region a world position belongs to: containing rect, else nearest. */
export function areaAt(pos: Vec): AreaId {
  let best: AreaId = AREA_ORDER[0]!;
  let bestDist = Infinity;
  for (const id of AREA_ORDER) {
    const r = areaRect(id);
    if (inRect(r, pos)) return id;
    const dx = Math.max(r.x0 - pos.x, 0, pos.x - r.x1);
    const dy = Math.max(r.y0 - pos.y, 0, pos.y - r.y1);
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** The W pad of an area, in world coordinates — where travel and restores land. */
export function worldWaypointPos(id: AreaId): Vec {
  const o = surfaceLayout().offsets[id];
  const w = waypointPos(id);
  return { x: w.x + o.x, y: w.y + o.y };
}

/** An area's safe-ground rect in world coordinates. */
export function worldCampRect(id: AreaId): Rect {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].safe;
  return { x0: s.x0 + o.x, y0: s.y0 + o.y, x1: s.x1 + o.x, y1: s.y1 + o.y };
}

/** An area's arrival spawn in world coordinates. */
export function worldAreaSpawn(id: AreaId): Vec {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].spawn;
  return { x: s.x + o.x, y: s.y + o.y };
}
