import { isWalkable, type Vec } from "./map";
import { findPath, smoothPath } from "./path";
import { rollDrop } from "./items/treasure";
import type { GameState, PlayerInput } from "./state";

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
 * trash class, plus exactly one treasure chest with a guaranteed drop.
 */
export function spawnBreakables(state: GameState): void {
  const { map, rng } = state;
  const taken = new Set<number>();
  const cell = (x: number, y: number) => y * map.width + x;
  taken.add(cell(Math.floor(map.spawn.x), Math.floor(map.spawn.y)));
  for (const m of map.markers) taken.add(cell(Math.floor(m.x), Math.floor(m.y)));

  const place = (kind: BreakableKind): void => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rng.int(1, map.width - 2);
      const y = rng.int(1, map.height - 2);
      if (!isWalkable(map, x, y) || taken.has(cell(x, y))) continue;
      if (Math.hypot(x + 0.5 - map.spawn.x, y + 0.5 - map.spawn.y) < MIN_SPAWN_DIST) continue;
      taken.add(cell(x, y));
      const id = state.nextId++;
      state.breakables.set(id, { id, kind, pos: { x: x + 0.5, y: y + 0.5 } });
      return;
    }
  };

  const clutter = rng.int(8, 12);
  for (let i = 0; i < clutter; i++) place(rng.next() < 0.55 ? "barrel" : "crate");
  place("chest");
}

export function applySmashInput(state: GameState, input: PlayerInput): void {
  if (input.smash === undefined) return;
  if (!state.breakables.has(input.smash)) return;
  const p = state.player;
  p.smashTarget = input.smash;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.path = [];
}

/** Walk to the targeted prop and smash it: one swing, loot spills out. */
export function breakSystem(state: GameState): void {
  const p = state.player;
  if (p.smashTarget === null) return;
  const target = state.breakables.get(p.smashTarget);
  if (!target) {
    p.smashTarget = null;
    return;
  }
  const d = Math.hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
  if (d <= SMASH_RANGE) {
    p.smashTarget = null;
    p.path = [];
    smash(state, target);
  } else if (p.path.length === 0) {
    const cells = findPath(
      state.map,
      { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
      { x: Math.floor(target.pos.x), y: Math.floor(target.pos.y) },
    );
    if (cells === null) {
      p.smashTarget = null;
      return;
    }
    p.path = smoothPath(state.map, p.pos, cells);
    p.path.push({ ...target.pos });
  }
}

function smash(state: GameState, target: Breakable): void {
  state.breakables.delete(target.id);
  state.events.push({ type: "player_swing", to: { ...target.pos } });
  state.events.push({ type: "breakable_broken", id: target.id, kind: target.kind, pos: { ...target.pos } });

  const depthBonus = (state.depth - 1) * 3;
  const item =
    target.kind === "chest"
      ? rollDrop(state.rng, "standard", 5 + depthBonus, { guaranteed: true, minRarity: "magic" })
      : rollDrop(state.rng, "trash", 2 + depthBonus);
  if (item) {
    const pos = {
      x: target.pos.x + (state.rng.next() - 0.5) * 1.2,
      y: target.pos.y + (state.rng.next() - 0.5) * 1.2,
    };
    const id = state.nextId++;
    state.groundItems.set(id, { id, item, pos });
    state.events.push({ type: "item_dropped", id, name: item.name, rarity: item.rarity, pos });
  }
  // Chests always cough up coin; barrels and crates sometimes do.
  if (target.kind === "chest" || state.rng.next() < 0.3) {
    const amount = state.rng.int(3, 8) + Math.floor(depthBonus * state.rng.next() * 2);
    const pos = {
      x: target.pos.x + (state.rng.next() - 0.5) * 1.2,
      y: target.pos.y + (state.rng.next() - 0.5) * 1.2,
    };
    const id = state.nextId++;
    state.goldPiles.set(id, { id, amount, pos });
    state.events.push({ type: "gold_dropped", id, amount, pos });
  }
}
