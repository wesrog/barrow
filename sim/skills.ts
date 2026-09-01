import type { GameState, Player } from "./state";

export type Klass = "warrior" | "witch";

export type SkillId =
  | "cleave"
  | "crush"
  | "warcry"
  | "leap"
  | "stomp"
  | "deathblow"
  | "firebolt"
  | "frostnova"
  | "focus"
  | "blink"
  | "fireball"
  | "chainbolt";

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
  /** Tree link: this skill needs a rank here before points can go in. */
  prereq?: SkillId;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  cleave: { id: "cleave", name: "Cleave", klass: "warrior", targeting: "none", levelReq: 1, manaCost: 3, buffTicks: 0, castTicks: 18 },
  crush: { id: "crush", name: "Crush", klass: "warrior", targeting: "target", levelReq: 2, manaCost: 4, buffTicks: 0, castTicks: 14 },
  warcry: { id: "warcry", name: "Warcry", klass: "warrior", targeting: "none", levelReq: 4, manaCost: 6, buffTicks: 500, castTicks: 15 },
  leap: { id: "leap", name: "Leap", klass: "warrior", targeting: "point", levelReq: 6, manaCost: 5, buffTicks: 0, castTicks: 20 },
  stomp: { id: "stomp", name: "Stomp", klass: "warrior", targeting: "none", levelReq: 9, manaCost: 7, buffTicks: 0, castTicks: 16, prereq: "leap" },
  deathblow: { id: "deathblow", name: "Deathblow", klass: "warrior", targeting: "target", levelReq: 12, manaCost: 8, buffTicks: 0, castTicks: 16, prereq: "crush" },
  firebolt: { id: "firebolt", name: "Firebolt", klass: "witch", targeting: "target", levelReq: 1, manaCost: 4, buffTicks: 0, castTicks: 14 },
  frostnova: { id: "frostnova", name: "Frost Nova", klass: "witch", targeting: "none", levelReq: 2, manaCost: 6, buffTicks: 0, castTicks: 15 },
  focus: { id: "focus", name: "Focus", klass: "witch", targeting: "none", levelReq: 4, manaCost: 5, buffTicks: 500, castTicks: 12 },
  blink: { id: "blink", name: "Blink", klass: "witch", targeting: "point", levelReq: 6, manaCost: 6, buffTicks: 0, castTicks: 16 },
  fireball: { id: "fireball", name: "Fireball", klass: "witch", targeting: "point", levelReq: 9, manaCost: 9, buffTicks: 0, castTicks: 16, prereq: "firebolt" },
  chainbolt: { id: "chainbolt", name: "Chain Bolt", klass: "witch", targeting: "none", levelReq: 12, manaCost: 10, buffTicks: 0, castTicks: 15, prereq: "fireball" },
};

/**
 * Ranks per skill cap here. With ~1 point per level and xp tapering past 30,
 * a career earns roughly 38 points against 60 of capacity — you can max two
 * or three skills, not the tree. Scarcity is what makes spending a choice.
 */
export const MAX_RANK = 10;

/** Every skill id, in definition (and therefore save/init) order. */
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** A class's skills, in hotbar (and unlock) order. */
export function CLASS_SKILLS(klass: Klass): SkillDef[] {
  return Object.values(SKILLS).filter((d) => d.klass === klass);
}

export const CLEAVE_RADIUS = 1.8;
export const CRUSH_RANGE = 1.6;
export const STOMP_RADIUS = 2.2;
export const DEATHBLOW_RANGE = 1.6;
export const FIREBALL_RANGE = 8;
export const FIREBALL_RADIUS = 2.0;
export const CHAINBOLT_RANGE = 8;
export const CHAINBOLT_TARGETS = 3;
/** Second and third chain bolt strikes land at this fraction of full damage. */
export const CHAINBOLT_FALLOFF = 0.7;
export const LEAP_RANGE = 8;
export const LEAP_STUN_RADIUS = 1.6;
/** Airborne travel time — the stun and landing hit resolve when the flight ends. */
export const LEAP_TICKS = 10;
export const FIREBOLT_RANGE = 12;
export const FROSTNOVA_RADIUS = 2.5;
export const BLINK_RANGE = 12;

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

/** Leap landing: 150% weapon damage, +40% per extra rank. The slam always hits. */
export function leapMultiplier(rank: number): number {
  return 1.5 + 0.4 * (rank - 1);
}

/** Stomp: 120% weapon damage around you, +30% per extra rank, ×(1 + 5% per Leap rank). Always hits. */
export function stompMultiplier(rank: number, leapRank: number): number {
  return (1.2 + 0.3 * (rank - 1)) * (1 + 0.05 * leapRank);
}

/** Stomp stun: +2 ticks per Leap rank (synergy). */
export function stompStunTicks(rank: number, leapRank: number): number {
  return 20 + 5 * (rank - 1) + 2 * leapRank;
}

/** Deathblow: 300% weapon damage, +75% per extra rank, ×(1 + 15% per Crush rank). Always hits. */
export function deathblowMultiplier(rank: number, crushRank: number): number {
  return (3 + 0.75 * (rank - 1)) * (1 + 0.15 * crushRank);
}

/** Fireball: spell blast by rank, +8% per Firebolt rank (synergy). */
export function fireballDamage(rank: number, fireboltRank: number): { min: number; max: number } {
  const synergy = 1 + 0.08 * fireboltRank;
  return {
    min: Math.floor((8 + 5 * (rank - 1)) * synergy),
    max: Math.floor((14 + 8 * (rank - 1)) * synergy),
  };
}

/** Chain Bolt: per-strike spell damage by rank, +8% per Fireball rank (synergy). */
export function chainboltDamage(rank: number, fireballRank: number): { min: number; max: number } {
  const synergy = 1 + 0.08 * fireballRank;
  return {
    min: Math.floor((6 + 4 * (rank - 1)) * synergy),
    max: Math.floor((11 + 5 * (rank - 1)) * synergy),
  };
}

/** Firebolt: spell damage by rank, +10% per Focus rank (synergy). Spells never miss. */
export function fireboltDamage(rank: number, focusRank: number): { min: number; max: number } {
  const synergy = 1 + 0.1 * focusRank;
  return {
    min: Math.floor((5 + 4 * (rank - 1)) * synergy),
    max: Math.floor((9 + 5 * (rank - 1)) * synergy),
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
