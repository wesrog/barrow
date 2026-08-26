import type { Rng } from "../rng";
import { hasLineOfSight, isWalkable, type Vec } from "../map";
import { findPath, smoothPath } from "../path";
import type { GameState, PlayerInput } from "../state";
import type { Monster } from "../monsters";
import { rollDrop } from "../items/treasure";
import { damageMultiplier } from "../skills";
import { moveAlongPath } from "./movement";

export function computeHitChance(attackRating: number, defense: number): number {
  const raw = attackRating / (attackRating + defense);
  return Math.min(0.95, Math.max(0.05, raw));
}

/** Ticks between the swing starting (animation cue) and the blade connecting. */
export const PLAYER_STRIKE_TICKS = 5;
export const MONSTER_STRIKE_TICKS = 4;

/** Resolve the player's in-flight swing at its contact frame. */
function resolvePlayerStrike(state: GameState): void {
  const p = state.player;
  if (!p.pendingStrike || state.tick < p.pendingStrike.at) return;
  const strike = p.pendingStrike;
  p.pendingStrike = null;
  if (p.dead) return;
  let target: Monster | null = null;
  if (strike.target !== null) {
    const m = state.monsters.get(strike.target);
    if (m && dist(p.pos, m.pos) <= p.range * 1.35) target = m;
  } else {
    // Swing-in-place: whatever is nearest within reach when the blade lands.
    let bestD = Infinity;
    for (const m of state.monsters.values()) {
      const d = dist(m.pos, p.pos);
      if (d <= p.range && d < bestD) {
        target = m;
        bestD = d;
      }
    }
  }
  if (!target) return;
  if (state.rng.next() < computeHitChance(p.attackRating, target.defense)) {
    const amount = Math.max(
      1,
      Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * damageMultiplier(state)),
    );
    target.life -= amount;
    state.events.push({ type: "monster_hit", id: target.id, amount, pos: { ...target.pos } });
  }
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
  const waypoints = smoothPath(state.map, from, cells);
  // Walk to the target's actual position, not just its cell center.
  waypoints.push({ ...to });
  return waypoints;
}

export function applyAttackInput(state: GameState, input: PlayerInput): void {
  if (input.attack === undefined) return;
  if (state.monsters.has(input.attack)) {
    state.player.attackTarget = input.attack;
    state.player.pickupTarget = null;
    state.player.smashTarget = null;
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
  p.pendingStrike = { at: state.tick + PLAYER_STRIKE_TICKS, target: null };
}

export function playerCombatSystem(state: GameState): void {
  const p = state.player;
  if (p.swingCooldown > 0) p.swingCooldown--;
  resolvePlayerStrike(state);
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
      p.pendingStrike = { at: state.tick + PLAYER_STRIKE_TICKS, target: target.id };
    }
  } else {
    p.path = pathToward(state, p.pos, target.pos);
  }
}

/** Idle strolls stay within this many cells of the spawn anchor. */
const WANDER_RADIUS = 1.5;
const WANDER_SPEED_SCALE = 0.35;

/** An idle monster ambles to a random spot near home, then loiters a while. */
function idleWander(state: GameState, m: Monster): void {
  if (m.path.length > 0) {
    moveAlongPath(m.pos, m.path, m.speed * WANDER_SPEED_SCALE);
    return;
  }
  if (m.wanderIn > 0) {
    m.wanderIn--;
    return;
  }
  m.wanderIn = state.rng.int(50, 150);
  const ang = state.rng.next() * Math.PI * 2;
  const r = 0.4 + state.rng.next() * (WANDER_RADIUS - 0.4);
  const to = { x: m.home.x + Math.cos(ang) * r, y: m.home.y + Math.sin(ang) * r };
  if (!isWalkable(state.map, Math.floor(to.x), Math.floor(to.y))) return;
  if (!hasLineOfSight(state.map, m.pos, to)) return;
  m.path = [to];
}

export function monsterAiSystem(state: GameState): void {
  const p = state.player;
  for (const m of state.monsters.values()) {
    if (m.swingCooldown > 0) m.swingCooldown--;
    if (m.stunnedUntil > state.tick) {
      m.windingUntil = null; // a stun breaks the windup
      m.strikeAt = null;
      continue;
    }
    if (p.dead) {
      m.ai = "idle";
      m.path = [];
      m.windingUntil = null;
      m.strikeAt = null;
      continue;
    }
    // A swing in flight: damage lands at the contact frame.
    if (m.strikeAt !== null) {
      if (state.tick < m.strikeAt) continue;
      m.strikeAt = null;
      const connects = m.strikeTo
        ? dist(p.pos, m.strikeTo) <= 1.2 // ranged shot: dodge the impact point
        : dist(m.pos, p.pos) <= m.range * 1.4;
      m.strikeTo = null;
      if (connects && state.rng.next() < computeHitChance(m.attackRating, p.defense)) {
        const amount = rollDamage(state.rng, m.dmgMin, m.dmgMax);
        p.life -= amount;
        state.events.push({ type: "player_hit", amount });
      }
      continue;
    }
    // A telegraphed strike in progress: hold position until the swing begins.
    if (m.windingUntil !== null) {
      if (state.tick < m.windingUntil) continue;
      m.windingUntil = null;
      if (dist(m.pos, p.pos) <= m.range * 1.4) {
        state.events.push({
          type: "monster_swing",
          id: m.id,
          from: { ...m.pos },
          to: { ...p.pos },
          ranged: false,
        });
        m.strikeAt = state.tick + MONSTER_STRIKE_TICKS;
      }
      continue;
    }
    const d = dist(m.pos, p.pos);
    if (m.ai === "idle") {
      if (d <= m.aggro) {
        m.ai = "chasing";
        m.path = [];
      } else {
        idleWander(state, m);
        continue;
      }
    }
    const inReach =
      m.ranged !== undefined
        ? d <= m.ranged && hasLineOfSight(state.map, m.pos, p.pos)
        : d <= m.range;
    if (inReach) {
      // Keep the path — clearing it caused stop/start jitter at the reach
      // boundary; being in reach simply pauses movement.
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
        m.strikeAt = state.tick + MONSTER_STRIKE_TICKS;
        if (m.ranged !== undefined) m.strikeTo = { ...p.pos };
      }
    } else {
      // Repath only when the current route has gone stale — constant
      // re-planning around corners makes chasers jitter between routes.
      m.repathIn--;
      const goal = m.path[m.path.length - 1];
      const stale = !goal || dist(goal, p.pos) > 1.2;
      if (m.path.length === 0 || (m.repathIn <= 0 && stale)) {
        m.path = pathToward(state, m.pos, p.pos);
        m.repathIn = 10;
      }
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
    // Gold: a separate 35% roll, scaling with the monster's level
    if (state.rng.next() < 0.35) {
      const amount = state.rng.int(2, 5) + Math.floor(m.mlvl * state.rng.next() * 2);
      const pos = {
        x: m.pos.x + (state.rng.next() - 0.5) * 1.4,
        y: m.pos.y + (state.rng.next() - 0.5) * 1.4,
      };
      const id = state.nextId++;
      state.goldPiles.set(id, { id, amount, pos });
      state.events.push({ type: "gold_dropped", id, amount, pos });
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
