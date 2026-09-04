export type Element = "physical" | "fire" | "cold" | "shadow";
export const ELEMENTS: readonly Element[] = ["physical", "fire", "cold", "shadow"];

/** Immunities (100+) yield to mastery at one fifth: a maxed mastery makes an immune barely hittable. */
const IMMUNE_PIERCE = 0.2;

export function effectiveResist(resist: number, opts: { coldMasteryReduction?: number } = {}): number {
  const reduction = opts.coldMasteryReduction ?? 0;
  const pierced = resist >= 100 ? resist - reduction * IMMUNE_PIERCE : resist - reduction;
  return Math.max(-100, pierced);
}

/** Damage after resistance (percent; 100 = immune, negative = weakness) and Doom. */
export function resistedDamage(
  amount: number,
  resist: number,
  opts: { coldMasteryReduction?: number; doomPower?: number } = {},
): number {
  const r = effectiveResist(resist, opts);
  const afterResist = Math.floor((amount * (100 - r)) / 100);
  return Math.max(0, Math.floor(afterResist * (1 + (opts.doomPower ?? 0))));
}

export function zeroResist(): Record<Element, number> {
  return { physical: 0, fire: 0, cold: 0, shadow: 0 };
}
