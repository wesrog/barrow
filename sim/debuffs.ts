import type { Element } from "./elements";
import type { PlayerId } from "./state";

export type DebuffKind = "chill" | "weaken" | "slow" | "doom" | "burn" | "bleed";

export interface Debuff {
  kind: DebuffKind;
  /** Tick the effect ends. */
  until: number;
  /** Fraction for chill/slow/weaken/doom; damage per tick for burn/bleed. */
  power: number;
  /** Damage-over-time element (burn: fire, bleed: physical). */
  element?: Element;
  /** Who gets credit for damage-over-time kills. */
  source?: PlayerId;
}

export interface Debuffed {
  debuffs: Debuff[];
}

/** Same kind refreshes the timer and keeps the higher power. */
export function applyDebuff(m: Debuffed, d: Debuff): void {
  const existing = m.debuffs.find((e) => e.kind === d.kind);
  if (!existing) {
    m.debuffs.push({ ...d });
    return;
  }
  existing.until = Math.max(existing.until, d.until);
  existing.power = Math.max(existing.power, d.power);
  if (d.element) existing.element = d.element;
  if (d.source !== undefined) existing.source = d.source;
}

function active(m: Debuffed, tick: number, kind: DebuffKind): Debuff | undefined {
  return m.debuffs.find((d) => d.kind === kind && d.until > tick);
}

/** Multiplier on move and attack speed: chill × slow. */
export function slowFactor(m: Debuffed, tick: number): number {
  let f = 1;
  const chill = active(m, tick, "chill");
  const slow = active(m, tick, "slow");
  if (chill) f *= 1 - chill.power;
  if (slow) f *= 1 - slow.power;
  return f;
}

/** Multiplier on damage dealt. */
export function weakenFactor(m: Debuffed, tick: number): number {
  const w = active(m, tick, "weaken");
  return w ? 1 - w.power : 1;
}

/** Multiplier on damage taken, applied after resistance. */
export function doomFactor(m: Debuffed, tick: number): number {
  const d = active(m, tick, "doom");
  return d ? 1 + d.power : 1;
}

/** Drop expired entries in place. */
export function pruneDebuffs(m: Debuffed, tick: number): void {
  for (let i = m.debuffs.length - 1; i >= 0; i--) {
    if (m.debuffs[i]!.until <= tick) m.debuffs.splice(i, 1);
  }
}
