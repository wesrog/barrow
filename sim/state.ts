import type { Rng } from "./rng";
import type { Vec, ZoneMap } from "./map";

export interface Player {
  pos: Vec;
  /** Cells per tick. */
  speed: number;
  /** Remaining waypoints (cell centers) toward the current destination. */
  path: Vec[];
}

export interface GameState {
  tick: number;
  rng: Rng;
  map: ZoneMap;
  player: Player;
}

export interface PlayerInput {
  /** World position the player clicked to walk to. */
  moveTo?: Vec;
}
