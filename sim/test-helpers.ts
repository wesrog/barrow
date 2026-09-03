import type { Vec, ZoneMap } from "./map";
import { dungeonZoneId, zoneOf, type GameState, type Player, type ZoneState } from "./state";
import { createGame, ensureDungeonFloor, joinPlayer, travel } from "./tick";
import { spawnMonster, type Monster } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { spawnBreakables } from "./breakables";

/** Test-only: a game with a single player (id 0) standing in the camp. */
export function soloGame(seed: number): GameState {
  const state = createGame(seed);
  joinPlayer(state, { id: 0 });
  return state;
}

/** Test-only: the solo player (id 0). */
export function player(state: GameState): Player {
  return state.players.get(0)!;
}

/** Test-only: the zone the solo player is standing in. */
export function playerZone(state: GameState): ZoneState {
  return zoneOf(state, player(state));
}

/** Test-only: spawn a monster into the player's current zone. */
export function spawnAt(state: GameState, typeId: string, pos: Vec, depth = 1): Monster {
  return spawnMonster(state, playerZone(state), typeId, pos, depth);
}

/**
 * Test-only: a game whose barrow floor 1 uses the given map, freshly populated
 * from its markers, with a single player standing on it. Keeps sim tests on
 * small, purpose-built arenas instead of the generated crypt.
 */
export function createGameOn(seed: number, map: ZoneMap): GameState {
  const state = soloGame(seed);
  const zone = ensureDungeonFloor(state, "barrow", 1);
  zone.map = map;
  zone.monsters.clear();
  zone.groundItems.clear();
  zone.goldPiles.clear();
  zone.breakables.clear();
  zone.corpses.length = 0;
  zone.portals.clear();
  zone.playerCorpses.clear();
  for (const marker of map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, 1);
  }
  spawnBreakables(state, zone, 1);
  travel(state, player(state), dungeonZoneId("barrow", 1));
  return state;
}
