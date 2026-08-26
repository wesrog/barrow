import type { GameState } from "./state";

export type SkillId = "cleave" | "crush" | "warcry" | "leap";

export interface SkillDef {
  id: SkillId;
  name: string;
  /** Character level required to put the first point in. */
  levelReq: number;
  manaCost: number;
  /** Buff duration in ticks (warcry only). */
  buffTicks: number;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  cleave: { id: "cleave", name: "Cleave", levelReq: 1, manaCost: 3, buffTicks: 0 },
  crush: { id: "crush", name: "Crush", levelReq: 2, manaCost: 4, buffTicks: 0 },
  warcry: { id: "warcry", name: "Warcry", levelReq: 4, manaCost: 6, buffTicks: 500 },
  leap: { id: "leap", name: "Leap", levelReq: 6, manaCost: 5, buffTicks: 0 },
};

export const CLEAVE_RADIUS = 1.8;
export const CRUSH_RANGE = 1.6;
export const LEAP_RANGE = 8;
export const LEAP_STUN_RADIUS = 1.6;

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

/** Global damage multiplier from active buffs. */
export function damageMultiplier(state: GameState): number {
  const p = state.player;
  if (p.warcryUntil > state.tick && p.skills.warcry > 0) {
    return warcryMultiplier(p.skills.warcry);
  }
  return 1.0;
}
