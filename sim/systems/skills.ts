import { hasLineOfSight, isWalkable } from "../map";
import {
  BLINK_RANGE,
  CHAINBOLT_FALLOFF,
  CHAINBOLT_RANGE,
  CHAINBOLT_TARGETS,
  CLEAVE_RADIUS,
  CRUSH_RANGE,
  DEATHBLOW_RANGE,
  FIREBALL_RADIUS,
  FIREBALL_RANGE,
  FIREBOLT_RANGE,
  FROSTNOVA_RADIUS,
  LEAP_RANGE,
  LEAP_TICKS,
  LEAP_STUN_RADIUS,
  SKILLS,
  chainboltDamage,
  cleaveMultiplier,
  crushMultiplier,
  damageMultiplier,
  deathblowMultiplier,
  fireballDamage,
  fireboltDamage,
  frostnovaChillTicks,
  frostnovaDamage,
  leapMultiplier,
  leapStunTicks,
  spellMultiplier,
  STOMP_RADIUS,
  stompMultiplier,
  stompStunTicks,
  type SkillId,
} from "../skills";
import { zoneOf, type GameState, type Player, type PlayerInput, type ZoneState } from "../state";
import { computeHitChance, hitMonster, rollDamage } from "./combat";

export const MANA_REGEN_PER_TICK = 0.05; // 1.25/s at 25 Hz

export function applySpendSkillInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id) return;
  const def = SKILLS[id];
  if (!def || def.klass !== p.klass || p.skillPoints <= 0 || p.level < def.levelReq) return;
  if (def.prereq && p.skills[def.prereq] <= 0) return;
  p.skills[id]++;
  p.skillPoints--;
}

/** Rank, mana, and the shared action cooldown all gate a cast; success starts it. */
function spendMana(state: GameState, p: Player, id: SkillId): boolean {
  if (p.skills[id] <= 0) return false;
  if (p.swingCooldown > 0) return false;
  const cost = SKILLS[id].manaCost;
  if (p.mana < cost) {
    // Ranked and off cooldown but the well is dry — the one refusal worth
    // announcing, so the client can flash and thunk instead of eating the click.
    state.events.push({ type: "cast_failed", playerId: p.id, reason: "mana" });
    return false;
  }
  p.mana -= cost;
  p.swingCooldown = SKILLS[id].castTicks;
  // Casting plants your feet: without this, a queued approach (click-to-attack)
  // keeps dragging a caster into melee after the spell already fired from afar.
  p.path = [];
  p.attackTarget = null;
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
      if (!spendMana(state, p, "cleave")) return;
      const mult = cleaveMultiplier(p.skills.cleave, p.skills.warcry);
      for (const m of targets) {
        if (state.rng.next() < computeHitChance(p.attackRating, m.defense)) {
          const amount = rollSkillDamage(state, p, mult);
          hitMonster(state, zone, m, p, amount);
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
      if (!spendMana(state, p, "crush")) return;
      const amount = rollSkillDamage(state, p, crushMultiplier(p.skills.crush));
      hitMonster(state, zone, m, p, amount);
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
      if (!spendMana(state, p, "warcry")) return;
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
      if (!spendMana(state, p, "leap")) return;
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
    case "stomp": {
      const targets = [...zone.monsters.values()].filter(
        (m) => Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= STOMP_RADIUS,
      );
      if (targets.length === 0) return;
      if (!spendMana(state, p, "stomp")) return;
      const mult = stompMultiplier(p.skills.stomp);
      const stunFor = stompStunTicks(p.skills.stomp);
      for (const m of targets) {
        // A ground slam: no dodging it, like the leap's landing.
        const amount = rollSkillDamage(state, p, mult);
        m.stunnedUntil = Math.max(m.stunnedUntil, state.tick + stunFor);
        hitMonster(state, zone, m, p, amount);
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "stomp",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
    case "deathblow": {
      // Same forgiving targeting as crush: the pick is a hint, reach decides.
      let m = cast.target !== undefined ? zone.monsters.get(cast.target) : undefined;
      if (!m || Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) > DEATHBLOW_RANGE) {
        m = nearestTo(
          p.pos,
          [...zone.monsters.values()].filter(
            (c) => Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= DEATHBLOW_RANGE,
          ),
        );
      }
      if (!m) return;
      if (!spendMana(state, p, "deathblow")) return;
      const amount = rollSkillDamage(state, p, deathblowMultiplier(p.skills.deathblow));
      hitMonster(state, zone, m, p, amount);
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "deathblow",
        pos: { ...m.pos },
        at: { ...m.pos },
        zone: zone.id,
      });
      break;
    }
    case "fireball": {
      if (!cast.at) return;
      if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > FIREBALL_RANGE) return;
      if (!hasLineOfSight(zone.map, p.pos, cast.at)) return;
      if (!spendMana(state, p, "fireball")) return;
      const { min, max } = fireballDamage(p.skills.fireball, p.skills.firebolt);
      for (const m of zone.monsters.values()) {
        if (Math.hypot(m.pos.x - cast.at.x, m.pos.y - cast.at.y) > FIREBALL_RADIUS) continue;
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)),
        );
        hitMonster(state, zone, m, p, amount);
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "fireball",
        pos: { ...p.pos },
        at: { x: cast.at.x, y: cast.at.y },
        zone: zone.id,
      });
      state.events.push({
        type: "exploded",
        pos: { x: cast.at.x, y: cast.at.y },
        radius: FIREBALL_RADIUS,
        zone: zone.id,
      });
      break;
    }
    case "chainbolt": {
      const inSight = (c: { pos: { x: number; y: number } }) =>
        Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= CHAINBOLT_RANGE &&
        hasLineOfSight(zone.map, p.pos, c.pos);
      const targets = [...zone.monsters.values()]
        .filter(inSight)
        .sort(
          (a, b) =>
            Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y) -
            Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y),
        )
        .slice(0, CHAINBOLT_TARGETS);
      if (targets.length === 0) return;
      if (!spendMana(state, p, "chainbolt")) return;
      const { min, max } = chainboltDamage(p.skills.chainbolt);
      targets.forEach((m, i) => {
        const falloff = i === 0 ? 1 : CHAINBOLT_FALLOFF;
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p) * falloff),
        );
        hitMonster(state, zone, m, p, amount);
      });
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "chainbolt",
        pos: { ...p.pos },
        at: { ...targets[0]!.pos },
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
      if (!spendMana(state, p, "firebolt")) return;
      const { min, max } = fireboltDamage(p.skills.firebolt, p.skills.focus);
      const amount = Math.max(
        1,
        Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)),
      );
      hitMonster(state, zone, m, p, amount);
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
      if (!spendMana(state, p, "frostnova")) return;
      const { min, max } = frostnovaDamage(p.skills.frostnova);
      const chill = frostnovaChillTicks(p.skills.frostnova);
      for (const m of targets) {
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)),
        );
        m.stunnedUntil = Math.max(m.stunnedUntil, state.tick + chill);
        hitMonster(state, zone, m, p, amount);
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
      if (!spendMana(state, p, "focus")) return;
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
      if (!spendMana(state, p, "blink")) return;
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
          hitMonster(state, zone, m, p, amount);
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
