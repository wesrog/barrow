import { isWalkable, type Vec, type ZoneMap } from "./map";
import { DUNGEONS } from "./dungeons";
import { areaLevelAt, type Rect } from "./surface";
import { findPath, smoothPath } from "./path";
import { rollDrop } from "./items/treasure";
import { dropSpot } from "./systems/combat";
import {
  zoneDungeon,
  zoneFloor,
  zoneOf,
  type GameState,
  type Player,
  type PlayerInput,
  type ZoneId,
  type ZoneState,
} from "./state";

export type BreakableKind = "barrel" | "crate" | "chest";

export interface Breakable {
  id: number;
  kind: BreakableKind;
  pos: Vec;
}

/** One swing pops a prop; slightly beyond melee so the hero doesn't shuffle. */
const SMASH_RANGE = 1.3;
const MIN_SPAWN_DIST = 4;

/**
 * Scatter smashable clutter across the floor: barrels and crates rolling the
 * trash class, plus exactly one treasure chest with a guaranteed drop. `opts`
 * confines a batch to one region of a larger map — the stitched surface seeds
 * each region separately, so every outpost gets its own clutter.
 */
export function spawnBreakables(
  state: GameState,
  zone: ZoneState,
  depth: number,
  opts?: { bounds: Rect; avoid: Vec },
): void {
  void depth; // clutter counts don't scale (yet); loot scaling happens on smash
  const { map } = zone;
  const rng = state.rng;
  const taken = new Set<number>();
  const cell = (x: number, y: number) => y * map.width + x;
  const b = opts?.bounds ?? { x0: 0, y0: 0, x1: map.width, y1: map.height };
  const avoid = opts?.avoid ?? map.spawn;
  taken.add(cell(Math.floor(map.spawn.x), Math.floor(map.spawn.y)));
  for (const m of map.markers) taken.add(cell(Math.floor(m.x), Math.floor(m.y)));

  const place = (kind: BreakableKind): void => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rng.int(b.x0 + 1, b.x1 - 2);
      const y = rng.int(b.y0 + 1, b.y1 - 2);
      if (!isWalkable(map, x, y) || taken.has(cell(x, y))) continue;
      if (Math.hypot(x + 0.5 - avoid.x, y + 0.5 - avoid.y) < MIN_SPAWN_DIST) continue;
      taken.add(cell(x, y));
      const id = state.nextId++;
      zone.breakables.set(id, { id, kind, pos: { x: x + 0.5, y: y + 0.5 } });
      return;
    }
  };

  const clutter = rng.int(8, 12);
  for (let i = 0; i < clutter; i++) place(rng.next() < 0.55 ? "barrel" : "crate");
  place("chest");
}

export function applySmashInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.smash === undefined) return;
  if (!zoneOf(state, p).breakables.has(input.smash)) return;
  p.smashTarget = input.smash;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.castTarget = null;
  p.path = [];
}

/** Walk to the targeted prop and smash it: one swing, loot spills out. */
export function breakSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.smashTarget === null) continue;
    const target = zone.breakables.get(p.smashTarget);
    if (!target) {
      p.smashTarget = null;
      continue;
    }
    const d = Math.hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
    if (d <= SMASH_RANGE) {
      p.smashTarget = null;
      p.path = [];
      smash(state, zone, p, target);
    } else if (p.path.length === 0) {
      const cells = findPath(
        zone.map,
        { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
        { x: Math.floor(target.pos.x), y: Math.floor(target.pos.y) },
      );
      if (cells === null) {
        p.smashTarget = null;
        continue;
      }
      p.path = smoothPath(zone.map, p.pos, cells);
      p.path.push({ ...target.pos });
    }
  }
}

function smash(state: GameState, zone: ZoneState, p: Player, target: Breakable): void {
  state.events.push({
    type: "player_swing",
    playerId: p.id,
    to: { ...target.pos },
    zone: zone.id,
  });
  breakProp(state, zone, target);
}

/** Pop a prop and spill its loot — shared by the melee smash and ranged casts. */
/** Bottom-floor vault chests roll two levels hot; everything else rolls flat. */
export function chestLevelBonus(zoneId: ZoneId, pos: Vec, map: ZoneMap): number {
  const d = zoneDungeon(zoneId);
  if (d === null || zoneFloor(zoneId) !== DUNGEONS[d].floors) return 0;
  const vault = map.markers.find((m) => m.ch === "$");
  return vault && Math.hypot(pos.x - vault.x, pos.y - vault.y) < 0.5 ? 2 : 0;
}

export function breakProp(state: GameState, zone: ZoneState, target: Breakable): void {
  zone.breakables.delete(target.id);
  state.events.push({
    type: "breakable_broken",
    id: target.id,
    kind: target.kind,
    pos: { ...target.pos },
    zone: zone.id,
  });

  // Tracks the region's monster mlvl band (typeMlvl + areaLevel - 1): chests
  // roll just under the local elites, barrels well under.
  const depthBonus =
    areaLevelAt(zone.id, target.pos) - 1 +
    (target.kind === "chest" ? chestLevelBonus(zone.id, target.pos, zone.map) : 0);
  const item =
    target.kind === "chest"
      ? rollDrop(state.rng, "standard", 7 + depthBonus, { guaranteed: true, minRarity: "magic" })
      : rollDrop(state.rng, "trash", 2 + depthBonus);
  if (item) {
    const pos = dropSpot(state.rng, zone.map, target.pos, 1.2);
    const id = state.nextId++;
    zone.groundItems.set(id, { id, item, pos });
    state.events.push({
      type: "item_dropped",
      id,
      name: item.name,
      rarity: item.rarity,
      pos,
      zone: zone.id,
    });
  }
  // Chests always cough up coin; barrels and crates sometimes do.
  if (target.kind === "chest" || state.rng.next() < 0.3) {
    const amount = state.rng.int(3, 8) + Math.floor(depthBonus * state.rng.next() * 2);
    const pos = dropSpot(state.rng, zone.map, target.pos, 1.2);
    const id = state.nextId++;
    zone.goldPiles.set(id, { id, amount, pos });
    state.events.push({ type: "gold_dropped", id, amount, pos, zone: zone.id });
  }
}
