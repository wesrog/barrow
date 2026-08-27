import { isWalkable } from "../map";
import {
  CLEAVE_RADIUS,
  CRUSH_RANGE,
  LEAP_RANGE,
  LEAP_STUN_RADIUS,
  SKILLS,
  cleaveMultiplier,
  crushMultiplier,
  damageMultiplier,
  leapStunTicks,
  type SkillId,
} from "../skills";
import { zoneOf, type GameState, type Player, type PlayerInput } from "../state";
import { computeHitChance, rollDamage } from "./combat";

export const MANA_REGEN_PER_TICK = 0.05; // 1.25/s at 25 Hz

export function applySpendSkillInput(state: GameState, p: Player, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id) return;
  const def = SKILLS[id];
  if (!def || p.skillPoints <= 0 || p.level < def.levelReq) return;
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
        zone: zone.id,
      });
      break;
    }
    case "crush": {
      if (cast.target === undefined) return;
      const m = zone.monsters.get(cast.target);
      if (!m) return;
      if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) > CRUSH_RANGE) return;
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
        zone: zone.id,
      });
      break;
    }
    case "warcry": {
      if (!spendMana(p, "warcry")) return;
      p.warcryUntil = state.tick + SKILLS.warcry.buffTicks;
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
      p.pos = { x: cell.x + 0.5, y: cell.y + 0.5 };
      p.path = [];
      p.attackTarget = null;
      const stunFor = leapStunTicks(p.skills.leap);
      for (const m of zone.monsters.values()) {
        if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= LEAP_STUN_RADIUS) {
          m.stunnedUntil = state.tick + stunFor;
        }
      }
      state.events.push({
        type: "skill_cast",
        playerId: p.id,
        skill: "leap",
        pos: { ...p.pos },
        zone: zone.id,
      });
      break;
    }
  }
}

export function manaRegenSystem(players: Player[]): void {
  for (const p of players) p.mana = Math.min(p.maxMana, p.mana + MANA_REGEN_PER_TICK);
}
