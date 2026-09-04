import { hasLineOfSight, isWalkable } from "../map";
import {
  BLINK_RANGE,
  SOULCHAIN_FALLOFF,
  SOULCHAIN_RANGE,
  SOULCHAIN_TARGETS,
  CLEAVE_RADIUS,
  CRUSH_RANGE,
  DEATHBLOW_RANGE,
  FIREBALL_RADIUS,
  FIREBALL_RANGE,
  FIREBOLT_RANGE,
  FROSTNOVA_RADIUS,
  LEAP_TICKS,
  LEAP_STUN_RADIUS,
  MAX_RANK,
  SKILLS,
  soulchainDamage,
  applyBuff,
  BUFF_TICKS,
  CHILL_POWER,
  CURSE_RADIUS,
  CURSE_RANGE,
  FROSTBOLT_RANGE,
  frostboltDamage,
  frostboltChillTicks,
  weakenPower,
  weakenTicks,
  slowPower,
  slowTicks,
  doomPower,
  doomTicks,
  soulchainDrain,
  warmthRegen,
  fireDamageMultiplier,
  cleaveMultiplier,
  crushMultiplier,
  damageMultiplier,
  deathblowMultiplier,
  fireballDamage,
  fireboltDamage,
  frostnovaChillTicks,
  frostnovaDamage,
  CHARGE_RANGE,
  CHARGE_STOP_SHORT,
  CHARGE_SPEED,
  CHARGE_HIT_RADIUS,
  chargeMultiplier,
  chargeStunTicks,
  leapMultiplier,
  leapRange,
  leapStunTicks,
  spellMultiplier,
  STOMP_RADIUS,
  stompMultiplier,
  stompStunTicks,
  type SkillId,
} from "../skills";
import { zoneOf, type GameState, type Player, type PlayerInput, type ZoneState } from "../state";
import { computeHitChance, hitMonster, rollDamage } from "./combat";
import { recomputePlayerStats } from "./inventory";
import { applyDebuff, pruneDebuffs, type DebuffKind } from "../debuffs";
import { breakProp, type Breakable } from "../breakables";
import { findPath, smoothPath } from "../path";
import type { Monster } from "../monsters";

export const MANA_REGEN_PER_TICK = 0.05; // 1.25/s at 25 Hz

/** The whole spend gate, shared with the panel so the + button and the sim agree. */
export function canSpendOn(p: Player, id: SkillId): boolean {
  const def = SKILLS[id];
  if (!def || def.klass !== p.klass || def.pending) return false;
  if (p.skillPoints <= 0 || p.level < def.tier) return false;
  if (def.prereqs.some((pre) => p.skills[pre] <= 0)) return false;
  return p.skills[id] < MAX_RANK;
}

export function applySpendSkillInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id || !canSpendOn(p, id)) return;
  p.skills[id]++;
  p.skillPoints--;
  // Passives live in the derived stats, so a new rank has to reach them.
  recomputePlayerStats(state, p);
  state.events.push({ type: "skill_learned", playerId: p.id, skill: id, rank: p.skills[id] });
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

/** The two hover-targeted bolts share one path; only the payload differs. */
type BoltSkill = "firebolt" | "frostbolt";
const BOLT_RANGE: Record<BoltSkill, number> = { firebolt: FIREBOLT_RANGE, frostbolt: FROSTBOLT_RANGE };

/** Range and line of sight — the whole gate for a bolt; spells never miss. */
function boltReaches(
  zone: ZoneState,
  p: Player,
  c: { pos: { x: number; y: number } },
  skill: BoltSkill,
): boolean {
  return (
    Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= BOLT_RANGE[skill] &&
    hasLineOfSight(zone.map, p.pos, c.pos)
  );
}

function boltMonster(state: GameState, zone: ZoneState, p: Player, m: Monster, skill: BoltSkill): void {
  if (skill === "firebolt") {
    const { min, max } = fireboltDamage(p.skills.firebolt, p.skills.focus);
    const amount = Math.max(
      1,
      Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p) * fireDamageMultiplier(p)),
    );
    hitMonster(state, zone, m, p, amount, "fire");
  } else {
    const { min, max } = frostboltDamage(p.skills.frostbolt);
    const amount = Math.max(1, Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p)));
    applyDebuff(m, {
      kind: "chill",
      until: state.tick + frostboltChillTicks(p.skills.frostbolt),
      power: CHILL_POWER,
    });
    hitMonster(state, zone, m, p, amount, "cold");
  }
  state.events.push({
    type: "skill_cast",
    playerId: p.id,
    skill,
    pos: { ...p.pos },
    at: { ...m.pos },
    zone: zone.id,
  });
}

function boltBreakable(state: GameState, zone: ZoneState, p: Player, b: Breakable, skill: BoltSkill): void {
  breakProp(state, zone, b);
  state.events.push({
    type: "skill_cast",
    playerId: p.id,
    skill,
    pos: { ...p.pos },
    at: { ...b.pos },
    zone: zone.id,
  });
}

/** Walk toward a hovered cast mark; the bolt fires the moment range and sight allow. */
export function castPursuitSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    const pursuit = p.castTarget;
    if (!pursuit) continue;
    const target =
      pursuit.monster !== undefined
        ? zone.monsters.get(pursuit.monster)
        : pursuit.breakable !== undefined
          ? zone.breakables.get(pursuit.breakable)
          : undefined;
    if (!target) {
      p.castTarget = null;
      continue;
    }
    const skill = pursuit.skill as BoltSkill;
    if (boltReaches(zone, p, target, skill)) {
      p.castTarget = null;
      p.path = [];
      if (!spendMana(state, p, skill)) continue;
      if (pursuit.monster !== undefined) boltMonster(state, zone, p, target as Monster, skill);
      else boltBreakable(state, zone, p, target as Breakable, skill);
    } else if (p.path.length === 0) {
      const cells = findPath(
        zone.map,
        { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
        { x: Math.floor(target.pos.x), y: Math.floor(target.pos.y) },
      );
      if (cells === null) {
        p.castTarget = null;
        continue;
      }
      p.path = smoothPath(zone.map, p.pos, cells);
      p.path.push({ ...target.pos });
    }
  }
}

function rollSkillDamage(state: GameState, p: Player, multiplier: number): number {
  const total = multiplier * damageMultiplier(state, p);
  return Math.max(1, Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * total));
}

type Cast = NonNullable<PlayerInput["cast"]>;

/** Hover-targeted bolt: the pick is a hint, reach decides, out-of-reach queues a walk-in. */
function castBolt(state: GameState, zone: ZoneState, p: Player, cast: Cast, skill: BoltSkill): void {
  // Spells never miss — range and line of sight are the whole gate.
  const hintM = cast.target !== undefined ? zone.monsters.get(cast.target) : undefined;
  const hintB = cast.breakable !== undefined ? zone.breakables.get(cast.breakable) : undefined;
  const hint = hintM ?? hintB;
  if (hint && !boltReaches(zone, p, hint, skill)) {
    // A hovered mark beyond reach queues a walk-in; the pursuit system fires on arrival.
    if (p.skills[skill] <= 0) return;
    p.castTarget = { skill: skill, monster: hintM?.id, breakable: hintB?.id };
    p.attackTarget = null;
    p.pickupTarget = null;
    p.smashTarget = null;
    p.portalTarget = null;
    p.reclaimTarget = null;
    p.path = [];
    return;
  }
  if (hintB && !hintM) {
    if (!spendMana(state, p, skill)) return;
    boltBreakable(state, zone, p, hintB, skill);
    return;
  }
  // Barrels are only hit on an explicit hover — the fallback hunts monsters alone.
  const m =
    hintM ??
    nearestTo(
      p.pos,
      [...zone.monsters.values()].filter((c) => boltReaches(zone, p, c, skill)),
    );
  if (!m) return;
  if (!spendMana(state, p, skill)) return;
  boltMonster(state, zone, p, m, skill);
}

/** Point-aimed curse: every monster near the spot, within range and sight. Shadow
 * resistance shortens the hold rather than resisting it; an immune shrugs it off. */
function castCurse(
  state: GameState,
  zone: ZoneState,
  p: Player,
  cast: Cast,
  skill: "weaken" | "slow" | "doom",
  debuff: { kind: DebuffKind; power: number; ticks: number },
): void {
  if (!cast.at) return;
  const at = cast.at;
  if (Math.hypot(at.x - p.pos.x, at.y - p.pos.y) > CURSE_RANGE) return;
  if (!hasLineOfSight(zone.map, p.pos, at)) return;
  const targets = [...zone.monsters.values()].filter(
    (m) => Math.hypot(m.pos.x - at.x, m.pos.y - at.y) <= CURSE_RADIUS,
  );
  if (targets.length === 0) return;
  if (!spendMana(state, p, skill)) return;
  for (const m of targets) {
    const ticks = Math.floor((debuff.ticks * Math.max(0, 100 - m.resist.shadow)) / 100);
    if (ticks <= 0) continue;
    applyDebuff(m, { kind: debuff.kind, power: debuff.power, until: state.tick + ticks });
  }
  state.events.push({
    type: "skill_cast",
    playerId: p.id,
    skill,
    pos: { ...p.pos },
    at: { x: at.x, y: at.y },
    zone: zone.id,
  });
}

export function applyCastInput(state: GameState, p: Player, input: PlayerInput): void {
  const cast = input.cast;
  if (!cast) return;
  const zone = zoneOf(state, p);
  p.castTarget = null; // a fresh cast supersedes any queued walk-in

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
          hitMonster(state, zone, m, p, amount, "physical");
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
      hitMonster(state, zone, m, p, amount, "physical");
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
    case "charge": {
      // Same forgiving targeting as crush, gated like a bolt: range plus sight.
      const reaches = (c: { pos: { x: number; y: number } }) =>
        Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= CHARGE_RANGE &&
        hasLineOfSight(zone.map, p.pos, c.pos);
      let m = cast.target !== undefined ? zone.monsters.get(cast.target) : undefined;
      if (!m || !reaches(m)) {
        m = nearestTo(p.pos, [...zone.monsters.values()].filter(reaches));
      }
      if (!m) return;
      const dist = Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y);
      if (dist <= CHARGE_STOP_SHORT) return; // already beside it — nothing to rush
      if (!spendMana(state, p, "charge")) return;
      // The destination locks at cast time: beside the quarry, along the rush line.
      const t = (dist - CHARGE_STOP_SHORT) / dist;
      const to = {
        x: p.pos.x + (m.pos.x - p.pos.x) * t,
        y: p.pos.y + (m.pos.y - p.pos.y) * t,
      };
      p.charge = {
        from: { ...p.pos },
        to,
        target: m.id,
        startTick: state.tick,
        endTick: state.tick + Math.max(1, Math.ceil((dist - CHARGE_STOP_SHORT) / CHARGE_SPEED)),
      };
      p.path = [];
      p.attackTarget = null;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "charge",
        pos: { ...p.pos },
        at: to,
        zone: zone.id,
      });
      break;
    }
    case "warcry": {
      if (!spendMana(state, p, "warcry")) return;
      applyBuff(state, p, "warcry", BUFF_TICKS);
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
      if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > leapRange(p.skills.leap)) return;
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
      const mult = stompMultiplier(p.skills.stomp, p.skills.leap);
      const stunFor = stompStunTicks(p.skills.stomp, p.skills.leap);
      for (const m of targets) {
        // A ground slam: no dodging it, like the leap's landing.
        const amount = rollSkillDamage(state, p, mult);
        m.stunnedUntil = Math.max(m.stunnedUntil, state.tick + stunFor);
        hitMonster(state, zone, m, p, amount, "physical");
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "stomp",
        pos: { ...p.pos },
        at: { ...nearestTo(p.pos, targets)!.pos },
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
      const amount = rollSkillDamage(state, p, deathblowMultiplier(p.skills.deathblow, p.skills.crush));
      hitMonster(state, zone, m, p, amount, "physical");
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
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p) * fireDamageMultiplier(p)),
        );
        hitMonster(state, zone, m, p, amount, "fire");
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
    case "soulchain": {
      const inSight = (c: { pos: { x: number; y: number } }) =>
        Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y) <= SOULCHAIN_RANGE &&
        hasLineOfSight(zone.map, p.pos, c.pos);
      const targets = [...zone.monsters.values()]
        .filter(inSight)
        .sort(
          (a, b) =>
            Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y) -
            Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y),
        )
        .slice(0, SOULCHAIN_TARGETS);
      if (targets.length === 0) return;
      if (!spendMana(state, p, "soulchain")) return;
      const { min, max } = soulchainDamage(p.skills.soulchain);
      let dealt = 0;
      targets.forEach((m, i) => {
        const falloff = i === 0 ? 1 : SOULCHAIN_FALLOFF;
        const amount = Math.max(
          1,
          Math.floor(rollDamage(state.rng, min, max) * spellMultiplier(state, p) * falloff),
        );
        const before = m.life;
        hitMonster(state, zone, m, p, amount, "shadow");
        dealt += before - m.life;
      });
      // The chain drinks: a share of what it took comes home as life.
      p.life = Math.min(p.maxLife, p.life + Math.floor(dealt * soulchainDrain(p.skills.soulchain, p.skills.doom)));
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "soulchain",
        pos: { ...p.pos },
        at: { ...targets[0]!.pos },
        zone: zone.id,
      });
      break;
    }
    case "firebolt":
      castBolt(state, zone, p, cast, "firebolt");
      break;
    case "frostbolt":
      castBolt(state, zone, p, cast, "frostbolt");
      break;
    case "weaken": {
      const r = p.skills.weaken;
      castCurse(state, zone, p, cast, "weaken", { kind: "weaken", power: weakenPower(r), ticks: weakenTicks(r) });
      break;
    }
    case "slow": {
      const r = p.skills.slow;
      castCurse(state, zone, p, cast, "slow", { kind: "slow", power: slowPower(r), ticks: slowTicks(r, p.skills.weaken) });
      break;
    }
    case "doom": {
      const r = p.skills.doom;
      castCurse(state, zone, p, cast, "doom", { kind: "doom", power: doomPower(r), ticks: doomTicks(r, p.skills.slow) });
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
        applyDebuff(m, { kind: "chill", until: state.tick + chill, power: CHILL_POWER });
        hitMonster(state, zone, m, p, amount, "cold");
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "frostnova",
        pos: { ...p.pos },
        at: { ...nearestTo(p.pos, targets)!.pos },
        zone: zone.id,
      });
      break;
    }
    case "focus": {
      if (!spendMana(state, p, "focus")) return;
      applyBuff(state, p, "focus", BUFF_TICKS);
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
      // pos is the departure point, at the arrival — the renderer faces along that line.
      const from = { ...p.pos };
      p.pos = { x: cast.at.x, y: cast.at.y };
      p.path = [];
      p.attackTarget = null;
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "blink",
        pos: from,
        at: { ...p.pos },
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
          hitMonster(state, zone, m, p, amount, "physical");
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

/** Carry charging players along the ground; arrival rams and stuns the quarry. */
export function chargeSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    const charge = p.charge;
    if (!charge) continue;
    if (p.dead) {
      p.charge = null;
      continue;
    }
    if (state.tick >= charge.endTick - 1) {
      p.pos = { ...charge.to };
      p.charge = null;
      const m = zone.monsters.get(charge.target);
      if (m && Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= CHARGE_HIT_RADIUS) {
        m.stunnedUntil = state.tick + chargeStunTicks(p.skills.charge);
        const amount = rollSkillDamage(state, p, chargeMultiplier(p.skills.charge));
        hitMonster(state, zone, m, p, amount, "physical");
      }
      state.events.push({ type: "charge_hit", playerId: p.id, pos: { ...p.pos }, zone: zone.id });
    } else {
      const step = 1 / (charge.endTick - charge.startTick);
      const t = (state.tick - charge.startTick + 1) * step;
      p.pos = {
        x: charge.from.x + (charge.to.x - charge.from.x) * t,
        y: charge.from.y + (charge.to.y - charge.from.y) * t,
      };
    }
  }
}

/** Tick damage-over-time and shed expired debuffs. Runs before monster AI. */
export function debuffSystem(state: GameState, zone: ZoneState): void {
  for (const m of zone.monsters.values()) {
    for (const d of m.debuffs) {
      if (d.until <= state.tick) continue;
      if (d.kind !== "burn" && d.kind !== "bleed") continue;
      const source = d.source !== undefined ? state.players.get(d.source) : undefined;
      if (!source) continue;
      hitMonster(state, zone, m, source, Math.floor(d.power), d.element ?? "physical");
    }
    pruneDebuffs(m, state.tick);
  }
}

export function manaRegenSystem(players: Player[]): void {
  for (const p of players) {
    p.mana = Math.min(p.maxMana, p.mana + MANA_REGEN_PER_TICK + warmthRegen(p.skills.warmth));
  }
}

/** Gear-granted life trickle (D2's Replenish Life). Life never comes back on
 * its own — lifeRegen is 0 without the affix, keeping potions load-bearing. */
export function lifeRegenSystem(players: Player[]): void {
  for (const p of players) {
    if (p.dead || p.lifeRegen <= 0) continue;
    p.life = Math.min(p.maxLife, p.life + p.lifeRegen / 25);
  }
}
