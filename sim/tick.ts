import { createRng } from "./rng";
import type { ZoneMap } from "./map";
import type { GameState, PlayerInput } from "./state";
import { applyMoveInput, movementSystem } from "./systems/movement";
import {
  applyAttackInput,
  applySwingInPlaceInput,
  deathSystem,
  monsterAiSystem,
  playerCombatSystem,
} from "./systems/combat";
import {
  applyDrinkInput,
  applyDropItemInput,
  applyEquipInput,
  applyPickupInput,
  pickupSystem,
} from "./systems/inventory";
import { applyCastInput, applySpendSkillInput, manaRegenSystem } from "./systems/skills";
import { xpSystem } from "./systems/xp";
import { spawnMonster } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";
import { rollDurability } from "./items/generate";
import { durabilitySystem } from "./systems/inventory";
import { applyShopInput, applyTownPortalInput, townPadSystem } from "./systems/town";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

function spawnFromMarkers(state: GameState): void {
  for (const marker of state.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, typeId, { x: marker.x, y: marker.y }, state.depth);
  }
}

/** Take the stairs: next floor down, same bones, meaner tenants. */
export function descend(state: GameState): void {
  state.depth++;
  state.monsters.clear();
  state.groundItems.clear();
  state.goldPiles.clear();
  state.corpses.length = 0;
  const p = state.player;
  p.pos = { ...state.map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  spawnFromMarkers(state);
  state.events.push({ type: "descended", depth: state.depth });
}

/** Player standing on a '>' marker heads downstairs. Runs after movement. */
export function stairsSystem(state: GameState): void {
  const p = state.player;
  if (p.dead) return;
  for (const marker of state.map.markers) {
    if (marker.ch !== ">") continue;
    if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
      descend(state);
      return;
    }
  }
}

/** Fresh run on the same map: revive, repopulate, keep the character. */
export function resetRun(state: GameState): void {
  const p = state.player;
  if (state.town !== null) {
    // Coming home from camp: the reset happens down in the crypt.
    state.map = state.town.saved.map;
    state.town = null;
  }
  state.depth = 1;
  state.monsters.clear();
  state.groundItems.clear();
  state.goldPiles.clear();
  state.corpses.length = 0;
  p.dead = false;
  p.life = p.maxLife;
  p.mana = p.maxMana;
  p.pos = { ...state.map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.warcryUntil = 0;
  spawnFromMarkers(state);
}

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
    durability: rollDurability("rusted_blade"),
  };
  const stats = computeStats(equipment);
  const state: GameState = {
    tick: 0,
    rng: createRng(seed),
    map,
    depth: 1,
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
      pendingStrike: null,
      pickupTarget: null,
      level: 1,
      xp: 0,
      skillPoints: 0,
      skills: { cleave: 0, crush: 0, warcry: 0, leap: 0 },
      mana: stats.maxMana,
      maxMana: stats.maxMana,
      warcryUntil: 0,
      belt: 0,
      gold: 0,
      inventory: createInventory(),
      equipment,
      magicFind: 0,
    },
    town: null,
    shop: [],
    monsters: new Map(),
    corpses: [],
    groundItems: new Map(),
    goldPiles: new Map(),
    events: [],
    nextId: 1,
  };
  spawnFromMarkers(state);
  return state;
}

/** Advance the simulation one tick. Systems run in fixed order. */
export function step(state: GameState, input: PlayerInput): void {
  state.events = [];
  if (input.newGame) {
    resetRun(state);
    state.tick++;
    return;
  }
  if (!state.player.dead) {
    applyMoveInput(state, input);
    applyAttackInput(state, input);
    applySwingInPlaceInput(state, input);
    applyPickupInput(state, input);
    applyEquipInput(state, input);
    applyDropItemInput(state, input);
    applyDrinkInput(state, input);
    applySpendSkillInput(state, input);
    applyTownPortalInput(state, input);
    applyShopInput(state, input);
    manaRegenSystem(state);
    applyCastInput(state, input);
    playerCombatSystem(state);
    pickupSystem(state);
    movementSystem(state);
    townPadSystem(state);
    stairsSystem(state);
  }
  monsterAiSystem(state);
  deathSystem(state);
  xpSystem(state);
  durabilitySystem(state);
  state.tick++;
}
