import { createRng } from "./rng";
import type { ZoneMap } from "./map";
import {
  floorZone,
  getZone,
  zoneDepth,
  zoneOf,
  type GameState,
  type PlayerInput,
  type ZoneId,
  type ZoneState,
} from "./state";
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
import { collisionSystem } from "./systems/collision";
import { xpSystem } from "./systems/xp";
import { spawnMonster } from "./monsters";
import { cryptZone, MARKER_TYPES, townZone } from "./zone";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";
import { rollDurability } from "./items/generate";
import { durabilitySystem } from "./systems/inventory";
import { applyShopInput, applyTalkVendorInput, restock, vendorSystem } from "./systems/town";
import { applySmashInput, breakSystem, spawnBreakables } from "./breakables";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

function makeZone(state: GameState, id: ZoneId, map: ZoneMap): ZoneState {
  const zone: ZoneState = {
    id,
    map,
    monsters: new Map(),
    groundItems: new Map(),
    goldPiles: new Map(),
    breakables: new Map(),
    corpses: [],
  };
  state.zones.set(id, zone);
  return zone;
}

/** Get-or-generate floor N deterministically from the world rng. */
export function ensureFloor(state: GameState, n: number): ZoneState {
  const id = floorZone(n);
  const existing = state.zones.get(id);
  if (existing) return existing;
  const zone = makeZone(state, id, cryptZone());
  for (const marker of zone.map.markers) {
    const typeId = MARKER_TYPES[marker.ch];
    if (typeId) spawnMonster(state, zone, typeId, { x: marker.x, y: marker.y }, n);
  }
  spawnBreakables(state, zone, n);
  return zone;
}

/** Move the player to a zone's spawn; clears path/targets/pendingStrike. */
export function travel(state: GameState, to: ZoneId): void {
  if (to !== "camp") ensureFloor(state, zoneDepth(to));
  const p = state.player;
  const wasCampEmpty = to === "camp"; // A3 refines: no *other* player already in camp
  p.zoneId = to;
  p.pos = { ...getZone(state, to).map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.vendorTarget = false;
  p.pendingStrike = null;
  if (to === "camp" && wasCampEmpty) restock(state);
  state.events.push({ type: "traveled", to });
}

/** Player standing on a '>' marker heads one floor deeper. Runs after movement. */
export function stairsSystem(state: GameState): void {
  const p = state.player;
  if (p.dead) return;
  for (const marker of zoneOf(state, p).map.markers) {
    if (marker.ch !== ">") continue;
    if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
      travel(state, floorZone(zoneDepth(p.zoneId) + 1));
      return;
    }
  }
}

/** Player standing on the camp's 'P' pad descends to floor 1. */
export function travelPadSystem(state: GameState): void {
  const p = state.player;
  if (p.dead || p.zoneId !== "camp") return;
  for (const marker of zoneOf(state, p).map.markers) {
    if (marker.ch !== "P") continue;
    if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
      travel(state, floorZone(1));
      return;
    }
  }
}

/** Fresh run: forget every floor, regenerate floor 1, revive, back to camp. */
export function resetRun(state: GameState): void {
  const p = state.player;
  for (const id of [...state.zones.keys()]) {
    if (id !== "camp") state.zones.delete(id);
  }
  ensureFloor(state, 1);
  p.dead = false;
  p.life = p.maxLife;
  p.mana = p.maxMana;
  p.warcryUntil = 0;
  travel(state, "camp");
}

export function createGame(seed: number): GameState {
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
  const camp = townZone();
  const state: GameState = {
    tick: 0,
    rng: createRng(seed),
    zones: new Map(),
    player: {
      zoneId: "camp",
      pos: { ...camp.spawn },
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
      smashTarget: null,
      vendorTarget: false,
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
    shop: [],
    events: [],
    nextId: 1,
  };
  makeZone(state, "camp", camp);
  ensureFloor(state, 1);
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
    applySmashInput(state, input);
    applyEquipInput(state, input);
    applyDropItemInput(state, input);
    applyDrinkInput(state, input);
    applySpendSkillInput(state, input);
    applyTalkVendorInput(state, input);
    applyShopInput(state, input);
    manaRegenSystem(state);
    applyCastInput(state, input);
    playerCombatSystem(state);
    pickupSystem(state);
    vendorSystem(state);
    breakSystem(state);
    movementSystem(state);
    travelPadSystem(state);
    stairsSystem(state);
  }
  monsterAiSystem(state);
  collisionSystem(state);
  deathSystem(state);
  xpSystem(state);
  durabilitySystem(state);
  state.tick++;
}
