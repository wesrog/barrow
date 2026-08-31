import { hasLineOfSight, isWalkable } from "../map";
import {
  BLINK_RANGE,
  CLEAVE_RADIUS,
  CRUSH_RANGE,
  FIREBOLT_RANGE,
  FROSTNOVA_RADIUS,
  LEAP_RANGE,
  LEAP_TICKS,
  LEAP_STUN_RADIUS,
  SKILLS,
  cleaveMultiplier,
  crushMultiplier,
  damageMultiplier,
  fireboltDamage,
  frostnovaChillTicks,
  frostnovaDamage,
  leapMultiplier,
  leapStunTicks,
  spellMultiplier,
  type SkillId,
} from "../skills";
import { zoneOf, type GameState, type Player, type PlayerInput, type ZoneState } from "../state";
import { computeHitChance, rollDamage } from "./combat";

export const MANA_REGEN_PER_TICK = 0.05; // 1.25/s at 25 Hz

export function applySpendSkillInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id) return;
  const def = SKILLS[id];
  if (!def || def.klass !== p.klass || p.skillPoints <= 0 || p.level < def.levelReq) return;
  p.skills[id]++;
  p.skillPoints--;
}

/** Rank, mana, and the shared action cooldown all gate a cast; success starts it. */
function spendMana(p: Player, id: SkillId): boolean {
  if (p.skills[id] <= 0) return false;
  if (p.swingCooldown > 0) return false;
  const cost = SKILLS[id].manaCost;
  if (p.mana < cost) return false;
  p.mana -= cost;
  p.swingCooldown = SKILLS[id].castTicks;
  return true;
}

function nearestTo<T extends { pos: { x: number; y: number } }>(
  from: { x: number; y: number },
  candidates: T[],
): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.pos.x - from.x, c.pos.y - from.y);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function rollSkillDamage(state: GameState, p: Player, multiplier: number): number {
  const total = multiplier * damageMultiplier(state, p);
  return Math.max(1, Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * total));
}

export function applyCastInput(state: GameState, p: Player, input: PlayerInput): void {
  const cast = input.cast;
  if (!cast) return;
  const zone = zoneOf(state, p);

  switch (cast.skill) {
    case "cleave": {
      const targets = [...zone.monsters.values()].filter(
        (m) => Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= CLEAVE_RADIUS,
      );
      if (targets.length === 0) return;
      if (!spendMana(p, "cleave")) return;
      const mult = cleaveMultiplier(p.skills.cleave, p.skills.warcry);
      for (const m of targets) {
        if (state.rng.next() < computeHitChance(p.attackRating, m.defense)) {
          const amount = rollSkillDamage(state, p, mult);
          m.life -= amount;
          m.lastHitBy = p.id;
          state.events.push({
            type: "monster_hit",
            id: m.id,
            amount,
            pos: { ...m.pos },
            zone: zone.id,
          });
        }
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "cleave",
        pos: { ...p.pos },
        at: { ...nearestTo(p.pos, targets)!.pos },
        zone: zone.id,
      });
      break;
    }
    case "crush": {
      // The cursor's pick is a hint, not a requirement: anything in reach
      // gets crushed, nearest first, so the key never silently whiffs.
      let m = cast.target !== undefined ? zone.monsters.get(cast.target) : undefined;
      if (!m || Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) > CRUSH_RANGE) {
        m = nearestTo(
          p.pos,
          [...zone.monsters.values()].filter(
            (c) => Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= CRUSH_RANGE,
          ),
        );
      }
      if (!m) return;
      if (!spendMana(p, "crush")) return;
      const amount = rollSkillDamage(state, p, crushMultiplier(p.skills.crush));
      m.life -= amount;
      m.lastHitBy = p.id;
      state.events.push({ type: "monster_hit", id: m.id, amount, pos: { ...m.pos }, zone: zone.id });
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "crush",
        pos: { ...m.pos },
        at: { ...m.pos },
        zone: zone.id,
      });
      break;
    }
    case "warcry": {
      if (!spendMana(p, "warcry")) return;
      p.buffUntil = state.tick + SKILLS.warcry.buffTicks;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "warcry",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
    case "leap": {
      if (!cast.at) return;
      const cell = { x: Math.floor(cast.at.x), y: Math.floor(cast.at.y) };
      if (!isWalkable(zone.map, cell.x, cell.y)) return;
      if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > LEAP_RANGE) return;
      if (!spendMana(p, "leap")) return;
      // Takeoff only — leapSystem carries the flight; the stun lands with the player.
      p.leap = {
        from: { ...p.pos },
        to: { x: cast.at.x, y: cast.at.y },
        startTick: state.tick,
        endTick: state.tick + LEAP_TICKS,
      };
      p.path = [];
      p.attackTarget = null;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "leap",
        pos: { ...p.pos },
        at: { x: cast.at.x, y: cast.at.y },
        zone: zone.id,
      });
      break;
    }
    case "firebolt": {
      // Spells never miss — range and line of sight are the whole gate.
      let m = cast.target !== undefined ? zone.monsters.get(cast.target) : undefined;
      const inRange = (c: { pos: { x: number; y: number } }) =>
        Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= FIREBOLT_RANGE &&
        hasLineOfSight(zone.map, p.pos, c.pos);
      if (!m || !inRange(m)) {
        m = nearestTo(p.pos, [...zone.monsters.values()].filter(inRange));
      }
      if (!m) return;
      if (!spendMana(p, "firebolt")) return;
      const { min, max } = fireboltDamage(p.skills.firebolt, p.skills.focus);
      const amount = Math.max(
        1,
        Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)),
      );
      m.life -= amount;
      m.lastHitBy = p.id;
      state.events.push({ type: "monster_hit", id: m.id, amount, pos: { ...m.pos }, zone: zone.id });
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "firebolt",
        pos: { ...p.pos },
        at: { ...m.pos },
        zone: zone.id,
      });
      break;
    }
    case "frostnova": {
      const targets = [...zone.monsters.values()].filter(
        (m) => Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= FROSTNOVA_RADIUS,
      );
      if (targets.length === 0) return;
      if (!spendMana(p, "frostnova")) return;
      const { min, max } = frostnovaDamage(p.skills.frostnova);
      const chill = frostnovaChillTicks(p.skills.frostnova);
      for (const m of targets) {
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)),
        );
        m.life -= amount;
        m.lastHitBy = p.id;
        m.stunnedUntil = Math.max(m.stunnedUntil, state.tick + chill);
        state.events.push({
          type: "monster_hit",
          id: m.id,
          amount,
          pos: { ...m.pos },
          zone: zone.id,
        });
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "frostnova",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
    case "focus": {
      if (!spendMana(p, "focus")) return;
      p.buffUntil = state.tick + SKILLS.focus.buffTicks;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "focus",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
    case "blink": {
      if (!cast.at) return;
      const cell = { x: Math.floor(cast.at.x), y: Math.floor(cast.at.y) };
      if (!isWalkable(zone.map, cell.x, cell.y)) return;
      if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > BLINK_RANGE) return;
      if (!spendMana(p, "blink")) return;
      p.pos = { x: cast.at.x, y: cast.at.y };
      p.path = [];
      p.attackTarget = null;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "blink",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
  }
}

/** Carry leaping players through the air; landing hits the aim point and stuns. */
export function leapSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    const leap = p.leap;
    if (!leap) continue;
    if (p.dead) {
      p.leap = null;
      continue;
    }
    if (state.tick >= leap.endTick - 1) {
      p.pos = { ...leap.to };
      p.leap = null;
      const stunFor = leapStunTicks(p.skills.leap);
      const mult = leapMultiplier(p.skills.leap);
      for (const m of zone.monsters.values()) {
        if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= LEAP_STUN_RADIUS) {
          m.stunnedUntil = state.tick + stunFor;
          const amount = rollSkillDamage(state, p, mult);
          m.life -= amount;
          m.lastHitBy = p.id;
          state.events.push({
            type: "monster_hit",
            id: m.id,
            amount,
            pos: { ...m.pos },
            zone: zone.id,
          });
        }
      }
      state.events.push({ type: "leap_land", playerId: p.id, pos: { ...p.pos }, zone: zone.id });
    } else {
      const step = 1 / (leap.endTick - leap.startTick);
      const t = (state.tick - leap.startTick + 1) * step;
      p.pos = {
        x: leap.from.x + (leap.to.x - leap.from.x) * t,
        y: leap.from.y + (leap.to.y - leap.from.y) * t,
      };
    }
  }
}

export function manaRegenSystem(players: Player[]): void {
  for (const p of players) p.mana = Math.min(p.maxMana, p.mana + MANA_REGEN_PER_TICK);
}
