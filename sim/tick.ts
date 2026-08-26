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
import {
  applyEquipInput,
  applyPickupInput,
  pickupSystem,
} from "./systems/inventory";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

export function createGame(seed: number, map: ZoneMap): GameState {
  const equipment = createEquipment();
  // Every wanderer starts with a blade — bare fists are for corpses.
  equipment.weapon = {
    baseId: "rusted_blade",
    rarity: "normal",
    name: "Rusted Blade",
    affixIds: [],
    mods: [],
    ilvl: 1,
  };
  const stats = computeStats(equipment);
  return {
    tick: 0,
    rng: createRng(seed),
    map,
    player: {
      pos: { ...map.spawn },
      speed: PLAYER_SPEED,
      path: [],
      life: stats.maxLife,
      maxLife: stats.maxLife,
      dead: false,
      dmgMin: stats.dmgMin,
      dmgMax: stats.dmgMax,
      attackRating: stats.attackRating,
      defense: stats.defense,
      range: 1.2,
      swingEvery: BASE_STATS.swingEvery,
      swingCooldown: 0,
      attackTarget: null,
      pickupTarget: null,
      level: 1,
      inventory: createInventory(),
      equipment,
      magicFind: 0,
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
    applyPickupInput(state, input);
    applyEquipInput(state, input);
    playerCombatSystem(state);
    pickupSystem(state);
    movementSystem(state);
  }
  monsterAiSystem(state);
  deathSystem(state);
  state.tick++;
}
