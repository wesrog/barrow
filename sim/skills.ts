import type { GameState, Player } from "./state";

export type Klass = "warrior" | "witch";

export type SkillId =
  | "cleave"
  | "crush"
  | "warcry"
  | "leap"
  | "firebolt"
  | "frostnova"
  | "focus"
  | "blink";

/** How the client aims a cast: none = fire-and-forget, target = a monster, point = a ground spot. */
export type Targeting = "none" | "target" | "point";

export interface SkillDef {
  id: SkillId;
  name: string;
  klass: Klass;
  targeting: Targeting;
  /** Character level required to put the first point in. */
  levelReq: number;
  manaCost: number;
  /** Buff duration in ticks (warcry/focus only). */
  buffTicks: number;
  /** Ticks the cast occupies the shared action cooldown — tuned to the animation. */
  castTicks: number;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  cleave: { id: "cleave", name: "Cleave", klass: "warrior", targeting: "none", levelReq: 1, manaCost: 3, buffTicks: 0, castTicks: 18 },
  crush: { id: "crush", name: "Crush", klass: "warrior", targeting: "target", levelReq: 2, manaCost: 4, buffTicks: 0, castTicks: 14 },
  warcry: { id: "warcry", name: "Warcry", klass: "warrior", targeting: "none", levelReq: 4, manaCost: 6, buffTicks: 500, castTicks: 15 },
  leap: { id: "leap", name: "Leap", klass: "warrior", targeting: "point", levelReq: 6, manaCost: 5, buffTicks: 0, castTicks: 20 },
  firebolt: { id: "firebolt", name: "Firebolt", klass: "witch", targeting: "target", levelReq: 1, manaCost: 4, buffTicks: 0, castTicks: 14 },
  frostnova: { id: "frostnova", name: "Frost Nova", klass: "witch", targeting: "none", levelReq: 2, manaCost: 6, buffTicks: 0, castTicks: 15 },
  focus: { id: "focus", name: "Focus", klass: "witch", targeting: "none", levelReq: 4, manaCost: 5, buffTicks: 500, castTicks: 12 },
  blink: { id: "blink", name: "Blink", klass: "witch", targeting: "point", levelReq: 6, manaCost: 6, buffTicks: 0, castTicks: 16 },
};

/** A class's four skills, in hotbar (and unlock) order. */
export function CLASS_SKILLS(klass: Klass): SkillDef[] {
  return Object.values(SKILLS).filter((d) => d.klass === klass);
}

export const CLEAVE_RADIUS = 1.8;
export const CRUSH_RANGE = 1.6;
export const LEAP_RANGE = 8;
export const LEAP_STUN_RADIUS = 1.6;
/** Airborne travel time — the stun and landing hit resolve when the flight ends. */
export const LEAP_TICKS = 10;
export const FIREBOLT_RANGE = 8;
export const FROSTNOVA_RADIUS = 2.5;
export const BLINK_RANGE = 8;

/** Cleave: 100% weapon damage, +25% per extra rank, +10% per Warcry rank (synergy). */
export function cleaveMultiplier(cleaveRank: number, warcryRank: number): number {
  return 1 + 0.25 * (cleaveRank - 1) + 0.1 * warcryRank;
}

/** Crush: 200% weapon damage, +50% per extra rank. Always hits. */
export function crushMultiplier(rank: number): number {
  return 2 + 0.5 * (rank - 1);
}

/** Warcry buff: +10% damage, +5% per extra rank, while active. */
export function warcryMultiplier(rank: number): number {
  return 1 + 0.1 + 0.05 * (rank - 1);
}

export function leapStunTicks(rank: number): number {
  return 30 + 10 * (rank - 1);
}

/** Firebolt: spell damage by rank, +10% per Focus rank (synergy). Spells never miss. */
export function fireboltDamage(rank: number, focusRank: number): { min: number; max: number } {
  const synergy = 1 + 0.1 * focusRank;
  return {
    min: Math.floor((5 + 3 * (rank - 1)) * synergy),
    max: Math.floor((9 + 4 * (rank - 1)) * synergy),
  };
}

export function frostnovaDamage(rank: number): { min: number; max: number } {
  return { min: 3 + 2 * (rank - 1), max: 6 + 3 * (rank - 1) };
}

export function frostnovaChillTicks(rank: number): number {
  return 20 + 5 * (rank - 1);
}

/** Focus buff: +10% spell damage, +5% per extra rank, while active. */
export function focusMultiplier(rank: number): number {
  return 1 + 0.1 + 0.05 * (rank - 1);
}

/** Weapon-damage multiplier from a player's active buffs (Warcry). */
export function damageMultiplier(state: GameState, p: Player): number {
  if (p.buffUntil > state.tick && p.skills.warcry > 0) {
    return warcryMultiplier(p.skills.warcry);
  }
  return 1.0;
}

/** Spell-damage multiplier from a player's active buffs (Focus). */
export function spellMultiplier(state: GameState, p: Player): number {
  if (p.buffUntil > state.tick && p.skills.focus > 0) {
    return focusMultiplier(p.skills.focus);
  }
  return 1.0;
}
