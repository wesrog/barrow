import { createRng } from "./rng";
import type { ZoneMap } from "./map";
import {
  allPlayers,
  floorZone,
  getZone,
  playerIds,
  zoneDepth,
  type Frame,
  type GameState,
  type Player,
  type PlayerInput,
  type PlayerJoin,
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
  applyReclaimInput,
  pickupSystem,
  reclaimSystem,
} from "./systems/inventory";
import { applyCastInput, applySpendSkillInput, manaRegenSystem } from "./systems/skills";
import { collisionSystem } from "./systems/collision";
import { xpSystem } from "./systems/xp";
import { spawnMonster } from "./monsters";
import { cryptZone, MARKER_TYPES, townZone } from "./zone";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";
import { rollDurability } from "./items/generate";
import { durabilitySystem } from "./systems/inventory";
import {
  applyCastPortalInput,
  applyShopInput,
  applyTalkVendorInput,
  applyUsePortalInput,
  portalSystem,
  removePortalsOwnedBy,
  restock,
  vendorSystem,
} from "./systems/town";
import { applySmashInput, breakSystem, spawnBreakables } from "./breakables";
import { applyCharacter } from "./save";

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
    portals: new Map(),
    playerCorpses: new Map(),
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

/** Move a player to a zone's spawn; clears path/targets/pendingStrike. */
export function travel(state: GameState, p: Player, to: ZoneId): void {
  if (to !== "camp") ensureFloor(state, zoneDepth(to));
  // Only a lone arrival refills the stall — a camp that's already occupied keeps its stock.
  const campWasEmpty =
    to === "camp" && !allPlayers(state).some((o) => o !== p && o.zoneId === "camp");
  p.zoneId = to;
  p.pos = { ...getZone(state, to).map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.vendorTarget = false;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.pendingStrike = null;
  if (to === "camp" && campWasEmpty) restock(state, p);
  state.events.push({ type: "traveled", playerId: p.id, to });
}

/** A player standing on a '>' marker heads one floor deeper. Runs after movement. */
export function stairsSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.dead || p.zoneId !== zone.id) continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== ">") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
        travel(state, p, floorZone(zoneDepth(p.zoneId) + 1));
        break;
      }
    }
  }
}

/** A player standing on the camp's 'P' pad descends to floor 1. */
export function travelPadSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "camp") return;
  for (const p of players) {
    if (p.dead || p.zoneId !== "camp") continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== "P") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
        travel(state, p, floorZone(1));
        break;
      }
    }
  }
}

/** Fresh run: forget every floor, regenerate floor 1, revive everyone, back to camp. */
export function resetRun(state: GameState): void {
  for (const id of [...state.zones.keys()]) {
    if (id !== "camp") state.zones.delete(id);
  }
  ensureFloor(state, 1);
  for (const p of allPlayers(state)) {
    p.dead = false;
    p.life = p.maxLife;
    p.mana = p.maxMana;
    p.warcryUntil = 0;
    travel(state, p, "camp");
  }
}

/** A world with no players in it yet — callers join through `joinPlayer` or a frame. */
export function createGame(seed: number): GameState {
  const state: GameState = {
    tick: 0,
    rng: createRng(seed),
    zones: new Map(),
    players: new Map(),
    shop: [],
    events: [],
    nextId: 1,
  };
  makeZone(state, "camp", townZone());
  ensureFloor(state, 1);
  return state;
}

/** Add a player: fresh wanderer in the camp, or the saved character they bring. */
export function joinPlayer(state: GameState, join: PlayerJoin): Player {
  const existing = state.players.get(join.id);
  if (existing) return existing;
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
  const camp = getZone(state, "camp");
  const p: Player = {
    id: join.id,
    zoneId: "camp",
    pos: { ...camp.map.spawn },
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
    portalTarget: null,
    reclaimTarget: null,
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
  };
  state.players.set(join.id, p);
  if (join.character) applyCharacter(state, join.id, join.character);
  state.events.push({ type: "player_joined", playerId: join.id });
  return p;
}

/** Every zone holding at least one player, in world (insertion) order. */
function occupiedZones(state: GameState): [ZoneState, Player[]][] {
  const rosters = new Map<ZoneId, Player[]>();
  for (const p of allPlayers(state)) {
    const roster = rosters.get(p.zoneId);
    if (roster) roster.push(p);
    else rosters.set(p.zoneId, [p]);
  }
  const out: [ZoneState, Player[]][] = [];
  for (const zone of state.zones.values()) {
    const roster = rosters.get(zone.id);
    if (roster) out.push([zone, roster]);
  }
  return out;
}

/** Advance the simulation one tick. Systems run in fixed order. */
export function step(state: GameState, frame: Frame): void {
  state.events = [];
  for (const j of frame.joins ?? []) joinPlayer(state, j);
  for (const id of frame.leaves ?? []) {
    if (state.players.delete(id)) {
      removePortalsOwnedBy(state, id);
      state.events.push({ type: "player_left", playerId: id });
    }
  }

  for (const id of playerIds(state)) {
    const input = frame.inputs[id];
    if (!input) continue;
    const p = state.players.get(id)!;
    if (input.newGame) {
      resetRun(state);
      break;
    }
    if (p.dead) continue;
    applyMoveInput(state, p, input);
    applyAttackInput(state, p, input);
    applySwingInPlaceInput(state, p, input);
    applyPickupInput(state, p, input);
    applyReclaimInput(state, p, input);
    applySmashInput(state, p, input);
    applyEquipInput(state, p, input);
    applyDropItemInput(state, p, input);
    applyDrinkInput(state, p, input);
    applySpendSkillInput(state, p, input);
    applyTalkVendorInput(state, p, input);
    applyShopInput(state, p, input);
    applyCastInput(state, p, input);
    applyCastPortalInput(state, p, input);
    applyUsePortalInput(state, p, input);
  }

  // Rosters are snapshotted up front: a player who travels mid-tick is not
  // processed twice, and zones nobody stands in stay frozen.
  for (const [zone, roster] of occupiedZones(state)) {
    // Traveling drops a player out of this zone's remaining systems.
    const here = () => roster.filter((p) => p.zoneId === zone.id);
    const acting = () => here().filter((p) => !p.dead);
    manaRegenSystem(acting());
    playerCombatSystem(state, zone, acting());
    pickupSystem(state, zone, acting());
    reclaimSystem(state, zone, acting());
    vendorSystem(state, zone, acting());
    portalSystem(state, zone, acting(), travel);
    breakSystem(state, zone, acting());
    movementSystem(acting());
    travelPadSystem(state, zone, acting());
    stairsSystem(state, zone, acting());
    monsterAiSystem(state, zone, here());
    collisionSystem(state, zone, here());
    deathSystem(state, zone, here(), travel);
  }
  xpSystem(state);
  durabilitySystem(state);
  state.tick++;
}

/** Test/solo convenience: step with one player's input as frame {inputs:{0: input}}. */
export const stepSolo = (state: GameState, input: PlayerInput): void =>
  step(state, { tick: state.tick, inputs: { 0: input } });
