// Zone generation and lifecycle, factored out of tick.ts so the save layer can
// materialize a checkpoint's region without importing the tick loop (which
// imports the save layer right back).

import { AREAS, type AreaId } from "./areas";
import { spawnBreakables } from "./breakables";
import type { ZoneMap } from "./map";
import { spawnMonster } from "./monsters";
import { floorZone, type GameState, type ZoneId, type ZoneState } from "./state";
import { areaZone, cryptZone, MARKER_TYPES } from "./zone";

export function makeZone(state: GameState, id: ZoneId, map: ZoneMap): ZoneState {
  const zone: ZoneState = {
    id,
    map,
    monsters: new Map(),
    groundItems: new Map(),
    goldPiles: new Map(),
    breakables: new Map(),
    corpses: [],
    portals: new Map(),
    playerCorpses: new Map(),
  };
  state.zones.set(id, zone);
  return zone;
}

/** Get-or-generate floor N deterministically from the world rng. */
export function ensureFloor(state: GameState, n: number): ZoneState {
  const id = floorZone(n);
  const existing = state.zones.get(id);
  if (existing) return existing;
  const zone = makeZone(state, id, cryptZone());
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, n);
  }
  spawnBreakables(state, zone, n);
  return zone;
}

/** Get-or-generate a surface region deterministically from the world rng. */
export function ensureArea(state: GameState, id: AreaId): ZoneState {
  const existing = state.zones.get(id);
  if (existing) return existing;
  const def = AREAS[id];
  const zone = makeZone(state, id, areaZone(state.rng, def));
  const spawn = zone.map.spawn;
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (!typeId) continue;
    // Packs grow tougher the farther from the safe ground they prowl.
    const dist = Math.hypot(marker.x - spawn.x, marker.y - spawn.y);
    const level = def.areaLevel + Math.min(def.bandCap, Math.floor(dist / 28));
    spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, level);
  }
  spawnBreakables(state, zone, def.areaLevel);
  return zone;
}

/** Get-or-generate the moors above the barrow deterministically from the world rng. */
export const ensureOverworld = (state: GameState): ZoneState => ensureArea(state, "overworld");
