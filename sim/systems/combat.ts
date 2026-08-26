import type { Rng } from "../rng";
import type { Vec } from "../map";
import { findPath } from "../path";
import type { GameState, PlayerInput } from "../state";
import type { Monster } from "../monsters";
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
    state.player.path = [];
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
      if (state.rng.next() < computeHitChance(p.attackRating, target.defense)) {
        const amount = rollDamage(state.rng, p.dmgMin, p.dmgMax);
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
    if (p.dead) {
      m.ai = "idle";
      m.path = [];
      continue;
    }
    const d = dist(m.pos, p.pos);
    if (m.ai === "idle") {
      if (d <= m.aggro) m.ai = "chasing";
      else continue;
    }
    if (d <= m.range) {
      m.path = [];
      if (m.swingCooldown === 0) {
        m.swingCooldown = m.swingEvery;
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
  if (!p.dead && p.life <= 0) {
    p.life = 0;
    p.dead = true;
    p.path = [];
    p.attackTarget = null;
  }
  const dead: Monster[] = [];
  for (const m of state.monsters.values()) {
    if (m.life <= 0) dead.push(m);
  }
  for (const m of dead) {
    state.monsters.delete(m.id);
    state.corpses.push({ typeId: m.typeId, pos: { ...m.pos }, diedAt: state.tick });
    state.events.push({ type: "monster_died", id: m.id, typeId: m.typeId, pos: { ...m.pos } });
  }
}
