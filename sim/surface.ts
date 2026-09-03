// Where each surface region sits in world space, and helpers that resolve
// world positions back to region labels. Pure functions of the AREAS registry.

import { AREAS, type AreaId } from "./areas";
import { DUNGEONS, DUNGEON_ORDER, type DungeonId } from "./dungeons";
import { inCamp, isWalkable, type MapMarker, type Vec, type ZoneMap } from "./map";
import type { Rng } from "./rng";
import { zoneDepth, type ZoneId } from "./state";
import { areaZone, MARKER_TYPES, zoneName } from "./zone";

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

/**
 * The W pad of an area, in world coordinates — where travel and restores land.
 * Wild regions hide theirs at a seed-random spot, so the answer lives in the
 * generated surface map, not the registry.
 */
export function worldWaypointPos(map: ZoneMap, id: AreaId): Vec {
  for (const m of map.markers) {
    if (m.ch === "W" && areaAt({ x: m.x, y: m.y }) === id) return { x: m.x, y: m.y };
  }
  return worldAreaSpawn(id); // no pad rolled — shouldn't happen on real maps
}

/**
 * A free walkable camp-ground cell for a relocated corpse: rings outward from
 * the spawn, west-to-east then north-to-south within each ring, skipping cells
 * already claimed. Pure scan of the map — no rng, so every client picks the same
 * cells in the same order.
 */
export function campCorpseSpot(map: ZoneMap, claimed: Set<string>): Vec {
  const cx = Math.floor(map.spawn.x);
  const cy = Math.floor(map.spawn.y);
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring edge only
        const x = cx + dx;
        const y = cy + dy;
        const key = `${x},${y}`;
        if (claimed.has(key) || !isWalkable(map, x, y)) continue;
        if (!inCamp(map, { x: x + 0.5, y: y + 0.5 })) continue;
        claimed.add(key);
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return { x: cx + 0.5, y: cy + 0.5 }; // shouldn't happen on real maps
}

/** An area's safe-ground rect in world coordinates; only the town has one. */
export function worldCampRect(id: AreaId): Rect {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].safe;
  if (!s) throw new Error(`no safe ground in ${id}`);
  return { x0: s.x0 + o.x, y0: s.y0 + o.y, x1: s.x1 + o.x, y1: s.y1 + o.y };
}

/** A dungeon's mouth in world coordinates. */
export function worldDungeonEntrance(id: DungeonId): Vec {
  const d = DUNGEONS[id];
  const o = surfaceLayout().offsets[d.area];
  return { x: d.entrance.x + o.x, y: d.entrance.y + o.y };
}

/** Which dungeon's mouth sits at this world position, if any. */
export function dungeonAtEntrance(pos: Vec): DungeonId | null {
  for (const id of DUNGEON_ORDER) {
    const at = worldDungeonEntrance(id);
    if (Math.hypot(pos.x - at.x, pos.y - at.y) < 1) return id;
  }
  return null;
}

/** An area's arrival spawn in world coordinates. */
export function worldAreaSpawn(id: AreaId): Vec {
  const o = surfaceLayout().offsets[id];
  const s = AREAS[id].spawn;
  return { x: s.x + o.x, y: s.y + o.y };
}

/** THE difficulty lookup: region level at a surface position, floor number below. */
export function areaLevelAt(zoneId: ZoneId, pos: Vec): number {
  return zoneId === "surface" ? AREAS[areaAt(pos)].areaLevel : zoneDepth(zoneId);
}

/** Display name for a location: the region under `pos` on the surface, depth names below. */
export function locationTitle(id: ZoneId, pos: Vec): string {
  if (id === "surface") return AREAS[areaAt(pos)].title;
  return zoneName(zoneDepth(id));
}

/** Display name for a region label. */
export const regionTitle = (area: AreaId): string => AREAS[area].title;

export interface SurfaceMonsterSpawn {
  typeId: string;
  pos: Vec;
  level: number;
}

/**
 * The whole surface as one map: each region generated by its unchanged
 * per-region generator (drawing from `rng` in AREA_ORDER — the determinism
 * contract), blitted at its layout offset. Monster markers come back as
 * spawn specs with their region-banded levels; feature markers stay on the map.
 */
export function stitchSurface(rng: Rng): { map: ZoneMap; monsters: SurfaceMonsterSpawn[] } {
  const layout = surfaceLayout();
  const cells = new Uint8Array(layout.width * layout.height); // wall until a region lands
  const markers: MapMarker[] = [];
  const camps: Rect[] = [];
  const monsters: SurfaceMonsterSpawn[] = [];
  for (const id of AREA_ORDER) {
    const def = AREAS[id];
    const off = layout.offsets[id];
    // Crypt mouths from the dungeon registry: carved and trailed like any
    // fixed marker, so the wilds never strand an entrance unreachable.
    const mouths: MapMarker[] = DUNGEON_ORDER.filter((d) => DUNGEONS[d].area === id).map((d) => ({
      ch: ">",
      x: DUNGEONS[d].entrance.x,
      y: DUNGEONS[d].entrance.y,
    }));
    const region = areaZone(rng, def, mouths);
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        cells[(y + off.y) * layout.width + (x + off.x)] = region.cells[y * def.width + x]!;
      }
    }
    for (const m of region.markers) {
      const typeId = MARKER_TYPES[m.ch];
      if (typeId) {
        // Packs grow tougher the farther from the safe ground they prowl.
        const dist = Math.hypot(m.x - def.spawn.x, m.y - def.spawn.y);
        const level = def.areaLevel + Math.min(def.bandCap, Math.floor(dist / 28));
        monsters.push({ typeId, pos: { x: m.x + off.x, y: m.y + off.y }, level });
      } else {
        markers.push({ ch: m.ch, x: m.x + off.x, y: m.y + off.y });
      }
    }
    for (const c of region.camps) {
      camps.push({ x0: c.x0 + off.x, y0: c.y0 + off.y, x1: c.x1 + off.x, y1: c.y1 + off.y });
    }
  }
  const o = layout.offsets[AREA_ORDER[0]!];
  const s = AREAS[AREA_ORDER[0]!].spawn;
  return {
    map: {
      width: layout.width,
      height: layout.height,
      cells,
      spawn: { x: s.x + o.x, y: s.y + o.y },
      markers,
      camps,
    },
    monsters,
  };
}
