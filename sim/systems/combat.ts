import type { Rng } from "../rng";
import { hasLineOfSight, type Vec } from "../map";
import { findPath } from "../path";
import type { GameState, PlayerInput } from "../state";
import type { Monster } from "../monsters";
import { rollDrop } from "../items/treasure";
import { damageMultiplier } from "../skills";
import { moveAlongPath } from "./movement";

export function computeHitChance(attackRating: number, defense: number): number {
  const raw = attackRating / (attackRating + defense);
  return Math.min(0.95, Math.max(0.05, raw));
}

export function rollDamage(rng: Rng, min: number, max: number): number {
  return rng.int(min, max);
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function pathToward(state: GameState, from: Vec, to: Vec): Vec[] {
  const cells = findPath(
    state.map,
    { x: Math.floor(from.x), y: Math.floor(from.y) },
    { x: Math.floor(to.x), y: Math.floor(to.y) },
  );
  if (cells === null) return [];
  const waypoints = cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  // Walk to the target's actual position, not just its cell center.
  waypoints.push({ ...to });
  return waypoints;
}

export function applyAttackInput(state: GameState, input: PlayerInput): void {
  if (input.attack === undefined) return;
  if (state.monsters.has(input.attack)) {
    state.player.attackTarget = input.attack;
    state.player.pickupTarget = null;
    state.player.path = [];
  }
}

/** Shift-click: stand your ground and swing toward a point. */
export function applySwingInPlaceInput(state: GameState, input: PlayerInput): void {
  if (!input.swingAt) return;
  const p = state.player;
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  if (p.swingCooldown > 0) return;
  p.swingCooldown = p.swingEvery;
  state.events.push({ type: "player_swing", to: { ...input.swingAt } });
  // Hit the nearest monster within melee reach, if any.
  let best: Monster | null = null;
  let bestD = Infinity;
  for (const m of state.monsters.values()) {
    const d = dist(m.pos, p.pos);
    if (d <= p.range && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  if (best && state.rng.next() < computeHitChance(p.attackRating, best.defense)) {
    const amount = rollDamage(state.rng, p.dmgMin, p.dmgMax);
    best.life -= amount;
    state.events.push({ type: "monster_hit", id: best.id, amount, pos: { ...best.pos } });
  }
}

export function playerCombatSystem(state: GameState): void {
  const p = state.player;
  if (p.swingCooldown > 0) p.swingCooldown--;
  if (p.dead || p.attackTarget === null) return;
  const target = state.monsters.get(p.attackTarget);
  if (!target) {
    p.attackTarget = null;
    return;
  }
  if (dist(p.pos, target.pos) <= p.range) {
    p.path = [];
    if (p.swingCooldown === 0) {
      p.swingCooldown = p.swingEvery;
      state.events.push({ type: "player_swing", to: { ...target.pos } });
      if (state.rng.next() < computeHitChance(p.attackRating, target.defense)) {
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * damageMultiplier(state)),
        );
        target.life -= amount;
        state.events.push({ type: "monster_hit", id: target.id, amount, pos: { ...target.pos } });
      }
    }
  } else {
    p.path = pathToward(state, p.pos, target.pos);
  }
}

export function monsterAiSystem(state: GameState): void {
  const p = state.player;
  for (const m of state.monsters.values()) {
    if (m.swingCooldown > 0) m.swingCooldown--;
    if (m.stunnedUntil > state.tick) {
      m.windingUntil = null; // a stun breaks the windup
      continue;
    }
    if (p.dead) {
      m.ai = "idle";
      m.path = [];
      m.windingUntil = null;
      continue;
    }
    // A telegraphed strike in progress: hold position until it lands.
    if (m.windingUntil !== null) {
      if (state.tick < m.windingUntil) continue;
      m.windingUntil = null;
      const reach = dist(m.pos, p.pos);
      if (reach <= m.range * 1.4) {
        state.events.push({
          type: "monster_swing",
          id: m.id,
          from: { ...m.pos },
          to: { ...p.pos },
          ranged: false,
        });
        if (state.rng.next() < computeHitChance(m.attackRating, p.defense)) {
          const amount = rollDamage(state.rng, m.dmgMin, m.dmgMax);
          p.life -= amount;
          state.events.push({ type: "player_hit", amount });
        }
      }
      continue;
    }
    const d = dist(m.pos, p.pos);
    if (m.ai === "idle") {
      if (d <= m.aggro) m.ai = "chasing";
      else continue;
    }
    const inReach =
      m.ranged !== undefined
        ? d <= m.ranged && hasLineOfSight(state.map, m.pos, p.pos)
        : d <= m.range;
    if (inReach) {
      m.path = [];
      if (m.swingCooldown === 0) {
        m.swingCooldown = m.swingEvery;
        if (m.windup !== undefined && !m.ranged) {
          // Telegraph: announce the strike, land it windup ticks later.
          m.windingUntil = state.tick + m.windup;
          state.events.push({ type: "monster_windup", id: m.id, ticks: m.windup, pos: { ...m.pos } });
          continue;
        }
        state.events.push({
          type: "monster_swing",
          id: m.id,
          from: { ...m.pos },
          to: { ...p.pos },
          ranged: m.ranged !== undefined,
        });
        if (state.rng.next() < computeHitChance(m.attackRating, p.defense)) {
          const amount = rollDamage(state.rng, m.dmgMin, m.dmgMax);
          p.life -= amount;
          state.events.push({ type: "player_hit", amount });
        }
      }
    } else {
      if (m.repathIn <= 0 || m.path.length === 0) {
        m.path = pathToward(state, m.pos, p.pos);
        m.repathIn = 6;
      }
      m.repathIn--;
      moveAlongPath(m.pos, m.path, m.speed);
    }
  }
}

export function deathSystem(state: GameState): void {
  const p = state.player;
  // Queue-process deaths so explosions can chain into more deaths.
  const dead: Monster[] = [];
  const collectDead = () => {
    for (const m of state.monsters.values()) {
      if (m.life <= 0 && !dead.includes(m)) dead.push(m);
    }
  };
  collectDead();
  for (let i = 0; i < dead.length; i++) {
    const m = dead[i]!;
    state.monsters.delete(m.id);
    if (m.explode) {
      const { radius, dmgMin, dmgMax } = m.explode;
      state.events.push({ type: "exploded", pos: { ...m.pos }, radius });
      if (!p.dead && Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y) <= radius) {
        const amount = rollDamage(state.rng, dmgMin, dmgMax);
        p.life -= amount;
        state.events.push({ type: "player_hit", amount });
      }
      for (const other of state.monsters.values()) {
        if (Math.hypot(other.pos.x - m.pos.x, other.pos.y - m.pos.y) <= radius) {
          const amount = rollDamage(state.rng, dmgMin, dmgMax);
          other.life -= amount;
          state.events.push({ type: "monster_hit", id: other.id, amount, pos: { ...other.pos } });
        }
      }
      collectDead();
    }
    state.corpses.push({ typeId: m.typeId, pos: { ...m.pos }, diedAt: state.tick });
    state.events.push({ type: "monster_died", id: m.id, typeId: m.typeId, pos: { ...m.pos }, xp: m.xp });
    const item = rollDrop(
      state.rng,
      m.tc,
      m.mlvl,
      m.guaranteedDrop ? { guaranteed: true, minRarity: "magic" } : {},
    );
    if (item) {
      const pos = {
        x: m.pos.x + (state.rng.next() - 0.5) * 1.4,
        y: m.pos.y + (state.rng.next() - 0.5) * 1.4,
      };
      const id = state.nextId++;
      state.groundItems.set(id, { id, item, pos });
      state.events.push({ type: "item_dropped", id, name: item.name, rarity: item.rarity, pos });
    }
  }
  // After explosions have resolved: did the player fall?
  if (!p.dead && p.life <= 0) {
    p.life = 0;
    p.dead = true;
    p.path = [];
    p.attackTarget = null;
    p.pickupTarget = null;
  }
}
