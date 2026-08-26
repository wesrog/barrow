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
import type { GameState, PlayerInput } from "../state";
import { computeHitChance, rollDamage } from "./combat";

const MANA_REGEN_PER_TICK = 0.05; // 1.25/s at 25 Hz

export function applySpendSkillInput(state: GameState, input: PlayerInput): void {
  const id = input.spendSkill;
  if (!id) return;
  const p = state.player;
  const def = SKILLS[id];
  if (!def || p.skillPoints <= 0 || p.level < def.levelReq) return;
  p.skills[id]++;
  p.skillPoints--;
}

/** Rank, mana, and the shared action cooldown all gate a cast; success starts it. */
function spendMana(state: GameState, id: SkillId): boolean {
  const p = state.player;
  if (p.skills[id] <= 0) return false;
  if (p.swingCooldown > 0) return false;
  const cost = SKILLS[id].manaCost;
  if (p.mana < cost) return false;
  p.mana -= cost;
  p.swingCooldown = SKILLS[id].castTicks;
  return true;
}

function rollSkillDamage(state: GameState, multiplier: number): number {
  const p = state.player;
  const total = multiplier * damageMultiplier(state);
  return Math.max(
    1,
    Math.floor(rollDamage(state.rng, p.dmgMin, p.dmgMax) * total),
  );
}

export function applyCastInput(state: GameState, input: PlayerInput): void {
  const cast = input.cast;
  if (!cast) return;
  const p = state.player;

  switch (cast.skill) {
    case "cleave": {
      const targets = [...state.monsters.values()].filter(
        (m) => Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= CLEAVE_RADIUS,
      );
      if (targets.length === 0) return;
      if (!spendMana(state, "cleave")) return;
      const mult = cleaveMultiplier(p.skills.cleave, p.skills.warcry);
      for (const m of targets) {
        if (state.rng.next() < computeHitChance(p.attackRating, m.defense)) {
          const amount = rollSkillDamage(state, mult);
          m.life -= amount;
          state.events.push({ type: "monster_hit", id: m.id, amount, pos: { ...m.pos } });
        }
      }
      state.events.push({ type: "skill_cast", skill: "cleave", pos: { ...p.pos } });
      break;
    }
    case "crush": {
      if (cast.target === undefined) return;
      const m = state.monsters.get(cast.target);
      if (!m) return;
      if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) > CRUSH_RANGE) return;
      if (!spendMana(state, "crush")) return;
      const amount = rollSkillDamage(state, crushMultiplier(p.skills.crush));
      m.life -= amount;
      state.events.push({ type: "monster_hit", id: m.id, amount, pos: { ...m.pos } });
      state.events.push({ type: "skill_cast", skill: "crush", pos: { ...m.pos } });
      break;
    }
    case "warcry": {
      if (!spendMana(state, "warcry")) return;
      p.warcryUntil = state.tick + SKILLS.warcry.buffTicks;
      state.events.push({ type: "skill_cast", skill: "warcry", pos: { ...p.pos } });
      break;
    }
    case "leap": {
      if (!cast.at) return;
      const cell = { x: Math.floor(cast.at.x), y: Math.floor(cast.at.y) };
      if (!isWalkable(state.map, cell.x, cell.y)) return;
      if (Math.hypot(cast.at.x - p.pos.x, cast.at.y - p.pos.y) > LEAP_RANGE) return;
      if (!spendMana(state, "leap")) return;
      p.pos = { x: cell.x + 0.5, y: cell.y + 0.5 };
      p.path = [];
      p.attackTarget = null;
      const stunFor = leapStunTicks(p.skills.leap);
      for (const m of state.monsters.values()) {
        if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y) <= LEAP_STUN_RADIUS) {
          m.stunnedUntil = state.tick + stunFor;
        }
      }
      state.events.push({ type: "skill_cast", skill: "leap", pos: { ...p.pos } });
      break;
    }
  }
}

export function manaRegenSystem(state: GameState): void {
  const p = state.player;
  p.mana = Math.min(p.maxMana, p.mana + MANA_REGEN_PER_TICK);
}
