import { createRng } from "./rng";
import { inCamp, isWalkable, type Vec, type ZoneMap } from "./map";
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
import { isAreaId } from "./areas";
import { ensureFloor, ensureSurface } from "./world";
import { areaAt, worldWaypointPos } from "./surface";
import { BASE_STATS, computeStats, createEquipment, createInventory } from "./character";
import { SKILL_IDS, type SkillId } from "./skills";
import { rollDurability } from "./items/generate";
import { durabilitySystem } from "./systems/inventory";
import {
  applyBuyPotionInput,
  applyCastPortalInput,
  applyShopInput,
  applyUsePortalInput,
  portalSystem,
  removePortalsOwnedBy,
  restock,
} from "./systems/town";
import {
  applyTalkNpcInput, applyAcceptQuestInput, applyTurnInQuestInput, npcSystem, questProgressSystem,
} from "./systems/quests";
import { npcWanderSystem } from "./systems/npcs";
import { applySmashInput, breakSystem } from "./breakables";
import { applyCharacter } from "./save";

export const TICK_RATE = 25;

const PLAYER_SPEED = 4.5 / TICK_RATE; // cells per tick

export { ensureFloor, ensureSurface } from "./world";

/** Move a player to a zone's spawn; clears path/targets/pendingStrike. */
export function travel(state: GameState, p: Player, to: ZoneId): void {
  if (to === "surface") ensureSurface(state);
  else ensureFloor(state, zoneDepth(to));
  p.zoneId = to;
  p.wasInCamp = false; // arrival triggers (restock) re-fire on camp ground
  p.pos = { ...getZone(state, to).map.spawn };
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.npcTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.pendingStrike = null;
  p.leap = null;
  state.events.push({ type: "traveled", playerId: p.id, to });
}

/** A walkable cell center adjacent to a marker — where climbers land so they
 * stand beside the stairs (or the barrow mouth) without re-triggering them. */
function besideMarker(map: ZoneMap, ch: string): Vec | null {
  const marker = map.markers.find((m) => m.ch === ch);
  if (!marker) return null;
  const cx = Math.floor(marker.x);
  const cy = Math.floor(marker.y);
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    if (isWalkable(map, cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
  }
  return null;
}

/** A player standing on a '>' marker heads one floor deeper; on '<', one floor
 * back up — surfacing beside the barrow mouth from floor 1. Runs after movement. */
export function stairsSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.dead || p.zoneId !== zone.id) continue;
    for (const marker of zone.map.markers) {
      if (marker.ch !== ">" && marker.ch !== "<") continue;
      if (Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y) > 0.5) continue;
      if (marker.ch === ">") {
        // A barrow mouth on the surface is the way in; below it, stairs descend.
        travel(state, p, p.zoneId === "surface" ? floorZone(1) : floorZone(zoneDepth(p.zoneId) + 1));
      } else {
        if (p.zoneId === "surface") continue; // no climbing out of the open sky
        const depth = zoneDepth(p.zoneId);
        const dest: ZoneId = depth <= 1 ? "surface" : floorZone(depth - 1);
        travel(state, p, dest);
        // Come out beside the stairs you once went down, not on top of them.
        const spot = besideMarker(getZone(state, dest).map, ">");
        if (spot) p.pos = spot;
      }
      break;
    }
  }
}

/** Track which region each surface player stands in; announce crossings. */
export function regionSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "surface") return;
  for (const p of players) {
    const r = areaAt(p.pos);
    if (r !== p.region) {
      p.region = r;
      state.events.push({ type: "region_entered", playerId: p.id, area: r });
    }
  }
}

/**
 * Crossing onto any region's safe ground counts as arriving in town: the
 * checkpoint stamps there, and in the moors camp — the only stall — a lone
 * arrival refills Maren's stock (an occupied camp keeps what it has).
 */
export function safeGroundArrivalSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "surface") return;
  for (const p of players) {
    const inside = inCamp(zone.map, p.pos);
    if (inside && !p.wasInCamp) {
      p.checkpoint = areaAt(p.pos);
      if (p.checkpoint === "overworld") {
        const occupied = allPlayers(state).some(
          (o) => o !== p && o.zoneId === "surface" && o.wasInCamp && areaAt(o.pos) === "overworld",
        );
        if (!occupied) restock(state, p);
      }
    }
    p.wasInCamp = inside;
  }
}

/** Touching a region's W pad discovers it for good and stamps the checkpoint. */
export function waypointSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  if (zone.id !== "surface") return;
  for (const w of zone.map.markers) {
    if (w.ch !== "W") continue;
    const area = areaAt({ x: w.x, y: w.y });
    for (const p of players) {
      if (p.dead || Math.hypot(p.pos.x - w.x, p.pos.y - w.y) > 1.2) continue;
      p.checkpoint = area;
      if (!p.waypoints.includes(area)) {
        p.waypoints = [...p.waypoints, area].sort();
        state.events.push({ type: "waypoint_found", playerId: p.id, area });
      }
    }
  }
}

/** Standing at a waypoint, jump to any other discovered region's waypoint. */
export function applyWaypointInput(state: GameState, p: Player, input: PlayerInput): void {
  const dest = input.waypointTo;
  if (!dest || !isAreaId(dest) || dest === areaAt(p.pos)) return;
  if (!p.waypoints.includes(dest)) return;
  const near = getZone(state, p.zoneId).map.markers.some(
    (m) => m.ch === "W" && Math.hypot(p.pos.x - m.x, p.pos.y - m.y) <= 1.6,
  );
  if (!near) return;
  travel(state, p, "surface");
  p.pos = { ...worldWaypointPos(getZone(state, "surface").map, dest) };
}

/**
 * A free walkable camp-ground cell for a relocated corpse: rings outward from
 * the spawn, west-to-east then north-to-south within each ring, skipping cells
 * already claimed. Pure scan of the map — no rng, so every client picks the same
 * cells in the same order.
 */
function campCorpseSpot(surface: ZoneState, claimed: Set<string>): { x: number; y: number } {
  const map = surface.map;
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
  const surface = ensureSurface(state);
  ensureFloor(state, 1);
  const claimed = new Set<string>();
  for (const corpse of strays) {
    corpse.pos = campCorpseSpot(surface, claimed);
    surface.playerCorpses.set(corpse.id, corpse);
  }
  for (const p of allPlayers(state)) {
    p.dead = false;
    p.life = p.maxLife;
    p.mana = p.maxMana;
    p.buffUntil = 0;
    // A fresh world starts from camp, but the waypoints you've earned are yours.
    p.checkpoint = "overworld";
    travel(state, p, "surface");
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
  ensureSurface(state);
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
  const surface = getZone(state, "surface");
  const p: Player = {
    id: join.id,
    name: "Wanderer",
    klass: "warrior",
    zoneId: "surface",
    wasInCamp: false,
    waypoints: ["overworld"],
    checkpoint: "overworld",
    region: "overworld",
    pos: { ...surface.map.spawn },
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
    npcTarget: null,
    portalTarget: null,
    reclaimTarget: null,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>,
    mana: stats.maxMana,
    maxMana: stats.maxMana,
    buffUntil: 0,
    belt: 0,
    manaBelt: 0,
    gold: 0,
    inventory: createInventory(),
    equipment,
    magicFind: 0,
    quests: {},
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
    applyTalkNpcInput(state, p, input);
    applyAcceptQuestInput(state, p, input);
    applyTurnInQuestInput(state, p, input);
    applyShopInput(state, p, input);
    applyBuyPotionInput(state, p, input);
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
    npcSystem(state, zone, acting());
    npcWanderSystem(state, zone, here());
    portalSystem(state, zone, acting(), travel);
    breakSystem(state, zone, acting());
    leapSystem(state, zone, here());
    // Airborne players neither walk nor trip floor triggers until they land.
    const grounded = () => acting().filter((p) => !p.leap);
    movementSystem(grounded());
    regionSystem(state, zone, grounded());
    safeGroundArrivalSystem(state, zone, grounded());
    waypointSystem(state, zone, grounded());
    stairsSystem(state, zone, grounded());
    monsterAiSystem(state, zone, here());
    collisionSystem(state, zone, here());
    deathSystem(state, zone, here(), travel);
  }
  questProgressSystem(state);
  xpSystem(state);
  durabilitySystem(state);
  state.tick++;
}

/** Test/solo convenience: step with one player's input as frame {inputs:{0: input}}. */
export const stepSolo = (state: GameState, input: PlayerInput): void =>
  step(state, { tick: state.tick, inputs: { 0: input } });
