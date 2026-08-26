import { createRng } from "./rng";
import type { ZoneMap } from "./map";
import type { GameState, PlayerInput } from "./state";
import { applyMoveInput, movementSystem } from "./systems/movement";
import {
  applyAttackInput,
  deathSystem,
  monsterAiSystem,
  playerCombatSystem,
} from "./systems/combat";

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
      life: 60,
      maxLife: 60,
      dead: false,
      dmgMin: 4,
      dmgMax: 9,
      attackRating: 120,
      defense: 40,
      range: 1.2,
      swingEvery: 12,
      swingCooldown: 0,
      attackTarget: null,
    },
    monsters: new Map(),
    corpses: [],
    groundItems: new Map(),
    events: [],
    nextId: 1,
  };
}

/** Advance the simulation one tick. Systems run in fixed order. */
export function step(state: GameState, input: PlayerInput): void {
  state.events = [];
  if (!state.player.dead) {
    applyMoveInput(state, input);
    applyAttackInput(state, input);
    playerCombatSystem(state);
    movementSystem(state);
  }
  monsterAiSystem(state);
  deathSystem(state);
  state.tick++;
}
