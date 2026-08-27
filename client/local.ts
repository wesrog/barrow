import type { GameState, Player, PlayerId } from "../sim/state";

/** Which seat this browser drives. 0 when solo or hosting; whatever the host
 * handed us in the welcome when we joined someone else's game. Set once, at
 * startup, before the scene or HUD read any state. */
let current: PlayerId = 0;

export function setLocalId(id: PlayerId): void {
  current = id;
}

export function localId(): PlayerId {
  return current;
}

/** The player this client is looking through. */
export function localPlayer(game: GameState): Player {
  return game.players.get(current)!;
}
