import { createRng } from "./rng";
import type { ZoneMap } from "./map";
import type { GameState, PlayerInput } from "./state";
import { applyMoveInput, movementSystem } from "./systems/movement";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

export function createGame(seed: number, map: ZoneMap): GameState {
  return {
    tick: 0,
    rng: createRng(seed),
    map,
    player: {
      pos: { ...map.spawn },
      speed: PLAYER_SPEED,
      path: [],
    },
  };
}

/** Advance the simulation one tick. Systems run in fixed order. */
export function step(state: GameState, input: PlayerInput): void {
  applyMoveInput(state, input);
  movementSystem(state);
  state.tick++;
}
