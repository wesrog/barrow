import type { GameState, Player, PlayerId } from "../sim/state";

/** This browser drives player 0; the rest of the roster arrives with networking. */
export const LOCAL: PlayerId = 0;

/** The player this client is looking through. */
export function localPlayer(game: GameState): Player {
  return game.players.get(LOCAL)!;
}
