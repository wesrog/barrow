import type { Vec, ZoneMap } from "./map";
import { getZone, zoneOf, type GameState, type ZoneState } from "./state";
import { createGame, travel } from "./tick";
import { spawnMonster, type Monster } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { spawnBreakables } from "./breakables";

/** Test-only: the zone the (single) player is standing in. */
export function playerZone(state: GameState): ZoneState {
  return zoneOf(state, state.player);
}

/** Test-only: spawn a monster into the player's current zone. */
export function spawnAt(state: GameState, typeId: string, pos: Vec, depth = 1): Monster {
  return spawnMonster(state, playerZone(state), typeId, pos, depth);
}

/**
 * Test-only: a game whose floor:1 uses the given map, freshly populated from
 * its markers, with the player standing on it. Keeps sim tests on small,
 * purpose-built arenas now that createGame always generates the real crypt.
 */
export function createGameOn(seed: number, map: ZoneMap): GameState {
  const state = createGame(seed);
  const zone = getZone(state, "floor:1");
  zone.map = map;
  zone.monsters.clear();
  zone.groundItems.clear();
  zone.goldPiles.clear();
  zone.breakables.clear();
  zone.corpses.length = 0;
  for (const marker of map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, 1);
  }
  spawnBreakables(state, zone, 1);
  travel(state, "floor:1");
  return state;
}
