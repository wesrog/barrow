// Zone generation and lifecycle, factored out of tick.ts so the save layer can
// materialize the world without importing the tick loop (which imports the save
// layer right back).

import { AREAS } from "./areas";
import { spawnBreakables } from "./breakables";
import type { ZoneMap } from "./map";
import { spawnMonster } from "./monsters";
import { floorZone, type GameState, type ZoneId, type ZoneState } from "./state";
import { AREA_ORDER, areaRect, stitchSurface, worldAreaSpawn } from "./surface";
import { cryptZone, MARKER_TYPES } from "./zone";

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

/** Get-or-generate the whole stitched surface deterministically from the world rng. */
export function ensureSurface(state: GameState): ZoneState {
  const existing = state.zones.get("surface");
  if (existing) return existing;
  const { map, monsters } = stitchSurface(state.rng);
  const zone = makeZone(state, "surface", map);
  for (const s of monsters) spawnMonster(state, zone, s.typeId, s.pos, s.level);
  for (const id of AREA_ORDER) {
    spawnBreakables(state, zone, AREAS[id].areaLevel, {
      bounds: areaRect(id),
      avoid: worldAreaSpawn(id),
    });
  }
  return zone;
}
