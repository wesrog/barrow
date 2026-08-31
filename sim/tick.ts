import { createRng } from "./rng";
import { inCamp, isWalkable, type Vec } from "./map";
import {
  allPlayers,
  floorZone,
  getZone,
  playerIds,
  zoneDepth,
  type Frame,
  type GameState,
  type Player,
  type PlayerCorpse,
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
import { applyCastInput, applySpendSkillInput, leapSystem, manaRegenSystem } from "./systems/skills";
import { collisionSystem } from "./systems/collision";
import { xpSystem } from "./systems/xp";
import { AREAS, isAreaId, waypointPos, type AreaId } from "./areas";
import { ensureArea, ensureFloor, ensureOverworld } from "./world";
import { exitMouth } from "./zone";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";
import { rollDurability } from "./items/generate";
import { durabilitySystem } from "./systems/inventory";
import {
  applyCastPortalInput,
  applyShopInput,
  applyTalkHealerInput,
  applyTalkVendorInput,
  applyUsePortalInput,
  healerSystem,
  portalSystem,
  removePortalsOwnedBy,
  restock,
  vendorSystem,
} from "./systems/town";
import { applySmashInput, breakSystem } from "./breakables";
import { applyCharacter } from "./save";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

export { ensureArea, ensureFloor, ensureOverworld } from "./world";

/** Move a player to a zone's spawn; clears path/targets/pendingStrike. */
export function travel(state: GameState, p: Player, to: ZoneId): void {
  if (isAreaId(to)) ensureArea(state, to);
  else ensureFloor(state, zoneDepth(to));
  p.zoneId = to;
  p.wasInCamp = false; // arrival triggers (restock) re-fire on camp ground
  p.pos = { ...getZone(state, to).map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.vendorTarget = false;
  p.healerTarget = false;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.pendingStrike = null;
  p.leap = null;
  state.events.push({ type: "traveled", playerId: p.id, to });
}

/** A player standing on a '>' marker heads one floor deeper. Runs after movement. */
export function stairsSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.dead || p.zoneId !== zone.id) continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== ">") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
        // A barrow mouth on the surface is the way in; below it, stairs descend.
        travel(state, p, isAreaId(p.zoneId) ? floorZone(1) : floorZone(zoneDepth(p.zoneId) + 1));
        break;
      }
    }
  }
}

/** Where a player arriving from `from` lands in area `to`: its reciprocal exit mouth. */
function exitEntryPos(to: AreaId, from: ZoneId): Vec {
  const def = AREAS[to];
  const back = def.exits.find((e) => e.to === from);
  if (!back) return { ...def.spawn };
  const m = exitMouth(def, back);
  return { x: m.x + 0.5, y: m.y + 0.5 };
}

/** A player standing in a rim opening crosses into the neighboring region. */
export function edgeExitSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (!isAreaId(zone.id)) return;
  const def = AREAS[zone.id];
  for (const p of players) {
    if (p.dead || p.zoneId !== zone.id) continue;
    const cx = Math.floor(p.pos.x);
    const cy = Math.floor(p.pos.y);
    for (const e of def.exits) {
      const inMouth =
        e.edge === "N"
          ? cy <= 1 && Math.abs(cx - e.at) <= 1
          : e.edge === "S"
            ? cy >= def.height - 2 && Math.abs(cx - e.at) <= 1
            : e.edge === "W"
              ? cx <= 1 && Math.abs(cy - e.at) <= 1
              : cx >= def.width - 2 && Math.abs(cy - e.at) <= 1;
      if (!inMouth) continue;
      const from = zone.id;
      travel(state, p, e.to);
      p.pos = exitEntryPos(e.to, from);
      break;
    }
  }
}

/** A player standing on the camp's 'P' pad descends to floor 1. */
export function travelPadSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "overworld") return;
  for (const p of players) {
    if (p.dead || p.zoneId !== "overworld") continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== "P") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) <= 0.5) {
        travel(state, p, floorZone(1));
        break;
      }
    }
  }
}

/**
 * Crossing onto any region's safe ground counts as arriving in town: the
 * checkpoint stamps there, and in the moors camp — the only stall — a lone
 * arrival refills Maren's stock (an occupied camp keeps what it has).
 */
export function safeGroundArrivalSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (!isAreaId(zone.id)) return;
  for (const p of players) {
    const inside = inCamp(zone.map, p.pos);
    if (inside && !p.wasInCamp) {
      p.checkpoint = zone.id;
      if (zone.id === "overworld") {
        const occupied = allPlayers(state).some(
          (o) => o !== p && o.zoneId === "overworld" && o.wasInCamp,
        );
        if (!occupied) restock(state, p);
      }
    }
    p.wasInCamp = inside;
  }
}

/** Touching a region's W pad discovers it for good and stamps the checkpoint. */
export function waypointSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (!isAreaId(zone.id)) return;
  const area = zone.id;
  const w = zone.map.markers.find((m) => m.ch === "W");
  if (!w) return;
  for (const p of players) {
    if (p.dead || p.zoneId !== area) continue;
    if (Math.hypot(p.pos.x - w.x, p.pos.y - w.y) > 1.2) continue;
    p.checkpoint = area;
    if (!p.waypoints.includes(area)) {
      p.waypoints = [...p.waypoints, area].sort();
      state.events.push({ type: "waypoint_found", playerId: p.id, area });
    }
  }
}

/** Standing at a waypoint, jump to any other discovered area's waypoint. */
export function applyWaypointInput(state: GameState, p: Player, input: PlayerInput): void {
  const dest = input.waypointTo;
  if (!dest || !isAreaId(dest) || dest === p.zoneId) return;
  if (!p.waypoints.includes(dest)) return;
  const w = getZone(state, p.zoneId).map.markers.find((m) => m.ch === "W");
  if (!w || Math.hypot(p.pos.x - w.x, p.pos.y - w.y) > 1.6) return;
  travel(state, p, dest);
  p.pos = waypointPos(dest);
}

/**
 * A free walkable camp-ground cell for a relocated corpse: rings outward from
 * the spawn, west-to-east then north-to-south within each ring, skipping cells
 * already claimed. Pure scan of the map — no rng, so every client picks the same
 * cells in the same order.
 */
function campCorpseSpot(overworld: ZoneState, claimed: Set<string>): { x: number; y: number } {
  const map = overworld.map;
  const cx = Math.floor(map.spawn.x);
  const cy = Math.floor(map.spawn.y);
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring edge only
        const x = cx + dx;
        const y = cy + dy;
        const key = `${x},${y}`;
        if (claimed.has(key) || !isWalkable(map, x, y)) continue;
        if (!inCamp(map, { x: x + 0.5, y: y + 0.5 })) continue;
        claimed.add(key);
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return { x: cx + 0.5, y: cy + 0.5 }; // shouldn't happen on real maps
}

/** Fresh run: regenerate the world, revive everyone, back to camp ground. */
export function resetRun(state: GameState): void {
  // Gear is never destroyed. Corpses standing in zones about to be forgotten
  // carry their loot back to camp, where their owner can still reclaim it.
  const strays: PlayerCorpse[] = [];
  for (const zone of state.zones.values()) {
    strays.push(...zone.playerCorpses.values());
  }
  state.zones.clear();
  const overworld = ensureOverworld(state);
  ensureFloor(state, 1);
  const claimed = new Set<string>();
  for (const corpse of strays) {
    corpse.pos = campCorpseSpot(overworld, claimed);
    overworld.playerCorpses.set(corpse.id, corpse);
  }
  for (const p of allPlayers(state)) {
    p.dead = false;
    p.life = p.maxLife;
    p.mana = p.maxMana;
    p.buffUntil = 0;
    // A fresh world starts from camp, but the waypoints you've earned are yours.
    p.checkpoint = "overworld";
    travel(state, p, "overworld");
  }
}

/** A world with no players in it yet — callers join through `joinPlayer` or a frame. */
export function createGame(seed: number): GameState {
  const state: GameState = {
    tick: 0,
    seed,
    rng: createRng(seed),
    zones: new Map(),
    players: new Map(),
    shop: [],
    events: [],
    nextId: 1,
  };
  ensureOverworld(state);
  ensureFloor(state, 1);
  return state;
}

/** Add a player: fresh wanderer on camp ground, or the saved character they bring. */
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
  const overworld = getZone(state, "overworld");
  const p: Player = {
    id: join.id,
    name: "Wanderer",
    klass: "warrior",
    zoneId: "overworld",
    wasInCamp: false,
    waypoints: ["overworld"],
    checkpoint: "overworld",
    pos: { ...overworld.map.spawn },
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
    leap: null,
    pickupTarget: null,
    smashTarget: null,
    vendorTarget: false,
    healerTarget: false,
    portalTarget: null,
    reclaimTarget: null,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: {
      cleave: 0,
      crush: 0,
      warcry: 0,
      leap: 0,
      firebolt: 0,
      frostnova: 0,
      focus: 0,
      blink: 0,
    },
    mana: stats.maxMana,
    maxMana: stats.maxMana,
    buffUntil: 0,
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
    applyTalkHealerInput(state, p, input);
    applyShopInput(state, p, input);
    applyCastInput(state, p, input);
    applyCastPortalInput(state, p, input);
    applyUsePortalInput(state, p, input);
    applyWaypointInput(state, p, input);
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
    healerSystem(state, zone, acting());
    portalSystem(state, zone, acting(), travel);
    breakSystem(state, zone, acting());
    leapSystem(state, zone, here());
    // Airborne players neither walk nor trip floor triggers until they land.
    const grounded = () => acting().filter((p) => !p.leap);
    movementSystem(grounded());
    travelPadSystem(state, zone, grounded());
    safeGroundArrivalSystem(state, zone, grounded());
    waypointSystem(state, zone, grounded());
    stairsSystem(state, zone, grounded());
    edgeExitSystem(state, zone, grounded());
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
