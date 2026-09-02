// Zone generation and lifecycle, factored out of tick.ts so the save layer can
// materialize the world without importing the tick loop (which imports the save
// layer right back).

import { AREAS } from "./areas";
import { spawnBreakables } from "./breakables";
import { CHAMPION_IDS, promoteToChampion, rollChampion } from "./champions";
import type { Monster } from "./monsters";
import { createRng, type Rng } from "./rng";
import type { ZoneMap } from "./map";
import { nearestWalkable } from "./map";
import { spawnMonster } from "./monsters";
import { floorZone, type GameState, type ZoneId, type ZoneState } from "./state";
import { AREA_ORDER, areaAt, areaRect, stitchSurface, worldAreaSpawn } from "./surface";
import { surfaceLayout } from "./surface";
import { NPCS, NPC_IDS } from "./npcs";
import { cryptFloor } from "./crypt";
import { MARKER_TYPES } from "./zone";

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
    npcs: new Map(),
  };
  state.zones.set(id, zone);
  return zone;
}

/** Wild spawns have a small shot at greatness; scripted bosses stand alone. */
function maybePromote(rng: Rng, m: Monster): void {
  if (m.typeId === "barrow_lord") return;
  const id = rollChampion(rng);
  if (id) promoteToChampion(m, id);
}

/**
 * Get-or-generate floor N. Each floor draws from its own rng derived from the
 * world seed and depth, so floor N is the same floor whenever (and in whatever
 * order) parties reach it — lazy generation can't drift the world rng.
 */
export function ensureFloor(state: GameState, n: number): ZoneState {
  const id = floorZone(n);
  const existing = state.zones.get(id);
  if (existing) return existing;
  const rng = createRng((state.seed ^ Math.imul(n, 0x9e3779b9)) >>> 0);
  const zone = makeZone(state, id, cryptFloor(rng, n));
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) {
      const m = spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, n);
      maybePromote(rng, m);
    }
  }
  spawnBreakables(state, zone, n, { rng });
  return zone;
}

/** Get-or-generate the whole stitched surface deterministically from the world rng. */
export function ensureSurface(state: GameState): ZoneState {
  const existing = state.zones.get("surface");
  if (existing) return existing;
  const { map, monsters } = stitchSurface(state.rng);
  const zone = makeZone(state, "surface", map);
  for (const s of monsters) maybePromote(state.rng, spawnMonster(state, zone, s.typeId, s.pos, s.level));
  for (const id of AREA_ORDER) {
    spawnBreakables(state, zone, AREAS[id].areaLevel, {
      bounds: areaRect(id),
      avoid: worldAreaSpawn(id),
    });
  }
  // Landmark furnishings: '$' markers become treasure chests, 'X' markers a
  // champion guard drawn from the local region's own table.
  for (const m of zone.map.markers) {
    if (m.ch === "$") {
      const id = state.nextId++;
      zone.breakables.set(id, { id, kind: "chest", pos: { x: m.x, y: m.y } });
    } else if (m.ch === "X") {
      const area = AREAS[areaAt({ x: m.x, y: m.y })];
      const table = area.spawnTable;
      const typeId = MARKER_TYPES[table[state.rng.int(0, table.length - 1)]!]!;
      const guard = spawnMonster(state, zone, typeId, { x: m.x, y: m.y }, area.areaLevel);
      promoteToChampion(guard, CHAMPION_IDS[state.rng.int(0, CHAMPION_IDS.length - 1)]!);
    }
  }
  // NPCs: fixed spots from the registry, nudged onto this seed's walkable ground.
  const offsets = surfaceLayout().offsets;
  for (const npcId of NPC_IDS) {
    const def = NPCS[npcId];
    const o = offsets[def.area];
    const want = { x: def.pos.x + o.x, y: def.pos.y + o.y };
    // The def's cell is carved walkable at generation; the nudge is belt-and-braces.
    const cell = nearestWalkable(zone.map, want);
    const spot = cell ? { x: cell.x + 0.5, y: cell.y + 0.5 } : want;
    const id = state.nextId++;
    // Staggered first strolls so the camp doesn't move in lockstep.
    zone.npcs.set(id, {
      id, npcId, pos: spot, home: { ...spot },
      wanderTarget: null, waitTicks: state.rng.int(0, 100),
    });
  }
  return zone;
}
