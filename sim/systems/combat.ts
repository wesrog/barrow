import type { Rng } from "../rng";
import { hasLineOfSight, inCamp, isWalkable, nearestWalkable, type Vec, type ZoneMap } from "../map";
import { findPath, smoothPath } from "../path";
import {
  zoneOf,
  type GameState,
  type Player,
  type PlayerInput,
  type PlayerCorpse,
  type ZoneId,
  type ZoneState,
} from "../state";
import type { Monster } from "../monsters";
import { rollDrop } from "../items/treasure";
import { damageMultiplier } from "../skills";
import { moveAlongPath } from "./movement";
import { createEquipment, type EquipSlot } from "../character";
import { recomputePlayerStats } from "./inventory";
import { worldWaypointPos } from "../surface";

/**
 * Scatter a drop around `origin`, clamped to walkable ground so loot never
 * lands inside a tree or wall where it can't be reached (or even clicked).
 */
export function dropSpot(rng: Rng, map: ZoneMap, origin: Vec, spread = 1.4): Vec {
  const pos = {
    x: origin.x + (rng.next() - 0.5) * spread,
    y: origin.y + (rng.next() - 0.5) * spread,
  };
  if (isWalkable(map, Math.floor(pos.x), Math.floor(pos.y))) return pos;
  const cell = nearestWalkable(map, pos);
  return cell ? { x: cell.x + 0.5, y: cell.y + 0.5 } : { ...origin };
}

export function computeHitChance(attackRating: number, defense: number): number {
  const raw = attackRating / (attackRating + defense);
  return Math.min(0.95, Math.max(0.05, raw));
}

/** Ticks between the swing starting (animation cue) and the blade connecting. */
export const PLAYER_STRIKE_TICKS = 5;
export const MONSTER_STRIKE_TICKS = 4;

/** Resolve the player's in-flight swing at its contact frame. */
function resolvePlayerStrike(state: GameState, zone: ZoneState, p: Player): void {
  if (!p.pendingStrike || state.tick < p.pendingStrike.at) return;
  const strike = p.pendingStrike;
  p.pendingStrike = null;
  if (p.dead) return;
  let target: Monster | null = null;
  if (strike.target !== null) {
    const m = zone.monsters.get(strike.target);
    if (m && dist(p.pos, m.pos) <= p.range * 1.35) target = m;
  } else {
    // Swing-in-place: whatever is nearest within reach when the blade lands.
    let bestD = Infinity;
    for (const m of zone.monsters.values()) {
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
      Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * damageMultiplier(state, p)),
    );
    target.life -= amount;
    target.lastHitBy = p.id;
    state.events.push({
      type: "monster_hit",
      id: target.id,
      amount,
      pos: { ...target.pos },
      zone: zone.id,
    });
  }
}

export function rollDamage(rng: Rng, min: number, max: number): number {
  return rng.int(min, max);
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function pathToward(map: ZoneMap, from: Vec, to: Vec): Vec[] {
  const cells = findPath(
    map,
    { x: Math.floor(from.x), y: Math.floor(from.y) },
    { x: Math.floor(to.x), y: Math.floor(to.y) },
  );
  if (cells === null) return [];
  const waypoints = smoothPath(map, from, cells);
  // Walk to the target's actual position, not just its cell center.
  waypoints.push({ ...to });
  return waypoints;
}

export function applyAttackInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.attack === undefined) return;
  if (zoneOf(state, p).monsters.has(input.attack)) {
    p.attackTarget = input.attack;
    p.pickupTarget = null;
    p.smashTarget = null;
    p.portalTarget = null;
    p.reclaimTarget = null;
    p.path = [];
  }
}

/** Shift-click: stand your ground and swing toward a point. */
export function applySwingInPlaceInput(state: GameState, p: Player, input: PlayerInput): void {
  if (!input.swingAt) return;
  p.path = [];
  p.attackTarget = null;
  p.pickupTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  if (p.swingCooldown > 0) return;
  p.swingCooldown = p.swingEvery;
  state.events.push({
    type: "player_swing",
    playerId: p.id,
    to: { ...input.swingAt },
    zone: p.zoneId,
  });
  p.pendingStrike = { at: state.tick + PLAYER_STRIKE_TICKS, target: null };
}

export function playerCombatSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    if (p.swingCooldown > 0) p.swingCooldown--;
    resolvePlayerStrike(state, zone, p);
    if (p.dead || p.attackTarget === null) continue;
    const target = zone.monsters.get(p.attackTarget);
    if (!target) {
      p.attackTarget = null;
      continue;
    }
    if (dist(p.pos, target.pos) <= p.range) {
      p.path = [];
      if (p.swingCooldown === 0) {
        p.swingCooldown = p.swingEvery;
        state.events.push({
          type: "player_swing",
          playerId: p.id,
          to: { ...target.pos },
          zone: zone.id,
        });
        p.pendingStrike = { at: state.tick + PLAYER_STRIKE_TICKS, target: target.id };
        // One input buys one swing. Holding the button re-sends the attack
        // every tick, which re-arms the target before the next cooldown ends —
        // that's what makes click-and-hold auto-attack while a single click
        // stays a single swing (and leaves skills free to fire between them).
        p.attackTarget = null;
      }
    } else {
      p.path = pathToward(zone.map, p.pos, target.pos);
    }
  }
}

/** Idle strolls stay within this many cells of the spawn anchor. */
const WANDER_RADIUS = 1.5;
const WANDER_SPEED_SCALE = 0.35;

/** An idle monster ambles to a random spot near home, then loiters a while. */
function idleWander(state: GameState, zone: ZoneState, m: Monster): void {
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
  if (!isWalkable(zone.map, Math.floor(to.x), Math.floor(to.y))) return;
  if (!hasLineOfSight(zone.map, m.pos, to)) return;
  m.path = [to];
}

/** Nearest living player to a point; ties go to the lower id. */
function nearestPlayer(living: Player[], to: Vec): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const q of living) {
    const d = dist(q.pos, to);
    if (d < bestD) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

export function monsterAiSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  // Camp ground is sanctuary: monsters neither see nor follow anyone on it.
  const living = players.filter((q) => !q.dead && !inCamp(zone.map, q.pos));
  for (const m of zone.monsters.values()) {
    if (m.swingCooldown > 0) m.swingCooldown--;
    if (m.stunnedUntil > state.tick) {
      m.windingUntil = null; // a stun breaks the windup
      m.strikeAt = null;
      continue;
    }
    // Nobody left standing here: monsters drop aggro but keep ambling.
    const p = nearestPlayer(living, m.pos);
    if (!p) {
      if (m.ai !== "idle") {
        m.ai = "idle";
        m.path = [];
      }
      m.windingUntil = null;
      m.strikeAt = null;
      idleWander(state, zone, m);
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
      // Diving through the palisade gap mid-swing still leaves the blow short.
      if (inCamp(zone.map, p.pos)) continue;
      if (connects && state.rng.next() < computeHitChance(m.attackRating, p.defense)) {
        const amount = rollDamage(state.rng, m.dmgMin, m.dmgMax);
        p.life -= amount;
        state.events.push({ type: "player_hit", playerId: p.id, amount });
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
          zone: zone.id,
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
        idleWander(state, zone, m);
        continue;
      }
    }
    const inReach =
      m.ranged !== undefined
        ? d <= m.ranged && hasLineOfSight(zone.map, m.pos, p.pos)
        : d <= m.range;
    if (inReach) {
      // Keep the path — clearing it caused stop/start jitter at the reach
      // boundary; being in reach simply pauses movement.
      if (m.swingCooldown === 0) {
        m.swingCooldown = m.swingEvery;
        if (m.windup !== undefined && !m.ranged) {
          // Telegraph: announce the strike, land it windup ticks later.
          m.windingUntil = state.tick + m.windup;
          state.events.push({
            type: "monster_windup",
            id: m.id,
            ticks: m.windup,
            pos: { ...m.pos },
            zone: zone.id,
          });
          continue;
        }
        state.events.push({
          type: "monster_swing",
          id: m.id,
          from: { ...m.pos },
          to: { ...p.pos },
          ranged: m.ranged !== undefined,
          zone: zone.id,
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
        m.path = pathToward(zone.map, m.pos, p.pos);
        m.repathIn = 10;
      }
      moveAlongPath(m.pos, m.path, m.speed);
    }
  }
}

export function deathSystem(
  state: GameState,
  zone: ZoneState,
  players: Player[],
  travel: (state: GameState, p: Player, to: ZoneId) => void,
): void {
  // Queue-process deaths so explosions can chain into more deaths.
  const dead: Monster[] = [];
  const collectDead = () => {
    for (const m of zone.monsters.values()) {
      if (m.life <= 0 && !dead.includes(m)) dead.push(m);
    }
  };
  collectDead();
  for (let i = 0; i < dead.length; i++) {
    const m = dead[i]!;
    zone.monsters.delete(m.id);
    if (m.explode) {
      const { radius, dmgMin, dmgMax } = m.explode;
      state.events.push({ type: "exploded", pos: { ...m.pos }, radius, zone: zone.id });
      for (const p of players) {
        if (p.dead || inCamp(zone.map, p.pos)) continue;
        if (Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y) > radius) continue;
        const amount = rollDamage(state.rng, dmgMin, dmgMax);
        p.life -= amount;
        state.events.push({ type: "player_hit", playerId: p.id, amount });
      }
      for (const other of zone.monsters.values()) {
        if (Math.hypot(other.pos.x - m.pos.x, other.pos.y - m.pos.y) <= radius) {
          const amount = rollDamage(state.rng, dmgMin, dmgMax);
          other.life -= amount;
          state.events.push({
            type: "monster_hit",
            id: other.id,
            amount,
            pos: { ...other.pos },
            zone: zone.id,
          });
        }
      }
      collectDead();
    }
    zone.corpses.push({ typeId: m.typeId, pos: { ...m.pos }, diedAt: state.tick });
    state.events.push({
      type: "monster_died",
      id: m.id,
      typeId: m.typeId,
      pos: { ...m.pos },
      xp: m.xp,
      mlvl: m.mlvl,
      zone: zone.id,
      killer: m.lastHitBy,
    });
    const item = rollDrop(
      state.rng,
      m.tc,
      m.mlvl,
      m.guaranteedDrop ? { guaranteed: true, minRarity: "magic" } : {},
    );
    if (item) {
      const pos = dropSpot(state.rng, zone.map, m.pos);
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
    // Gold: a separate 35% roll, scaling with the monster's level
    if (state.rng.next() < 0.35) {
      const amount = state.rng.int(2, 5) + Math.floor(m.mlvl * state.rng.next() * 2);
      const pos = dropSpot(state.rng, zone.map, m.pos);
      const id = state.nextId++;
      zone.goldPiles.set(id, { id, amount, pos });
      state.events.push({ type: "gold_dropped", id, amount, pos, zone: zone.id });
    }
  }
  // After explosions have resolved: who fell?
  for (const p of players) {
    if (p.dead || p.life > 0) continue;
    p.life = 0;
    p.dead = true;
    p.path = [];
    p.attackTarget = null;
    p.pickupTarget = null;
    p.smashTarget = null;
    p.vendorTarget = false;
    p.healerTarget = false;
    p.portalTarget = null;
    p.reclaimTarget = null;

    // Strip gear onto a corpse here, merging in any corpse this player already
    // left behind elsewhere (a corpse run that ends in another death).
    const equipment = { ...p.equipment };
    let priorZone: ZoneState | undefined;
    let prior: PlayerCorpse | undefined;
    for (const z of state.zones.values()) {
      for (const c of z.playerCorpses.values()) {
        if (c.playerId === p.id) {
          priorZone = z;
          prior = c;
          break;
        }
      }
      if (prior) break;
    }
    if (prior) {
      for (const slot of Object.keys(equipment) as EquipSlot[]) {
        if (equipment[slot] === null && prior.equipment[slot] !== null) {
          equipment[slot] = prior.equipment[slot];
        }
      }
      priorZone!.playerCorpses.delete(prior.id);
    }
    const hasGear = Object.values(equipment).some((it) => it !== null);
    if (hasGear) {
      const corpse: PlayerCorpse = {
        id: state.nextId++,
        playerId: p.id,
        pos: { ...p.pos },
        equipment,
      };
      zone.playerCorpses.set(corpse.id, corpse);
    }
    p.equipment = createEquipment();
    recomputePlayerStats(state, p);

    state.events.push({ type: "player_died", playerId: p.id, zone: zone.id, pos: { ...p.pos } });

    // Immediate respawn at the checkpoint's pad — there is no persistent "you are dead" state.
    travel(state, p, "surface");
    p.pos = { ...worldWaypointPos(p.checkpoint) };
    p.dead = false;
    p.life = p.maxLife;
    p.mana = p.maxMana;
  }
}
