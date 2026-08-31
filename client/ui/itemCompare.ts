import {
  computeStats,
  slotForItem,
  type DerivedStats,
  type Equipment,
} from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import type { Klass } from "../../sim/skills";

export type StatDelta = Pick<
  DerivedStats,
  "dmgMin" | "dmgMax" | "attackRating" | "defense" | "maxLife" | "maxMana" | "magicFind"
>;

/** Character-stat change from equipping `item` into the slot it would occupy. */
export function equipDelta(eq: Equipment, item: Item, level: number, klass: Klass): StatDelta {
  const slot = slotForItem(item, eq);
  const swapped: Equipment = { ...eq, [slot]: item };
  const before = computeStats(eq, level, klass);
  const after = computeStats(swapped, level, klass);
  return {
    dmgMin: after.dmgMin - before.dmgMin,
    dmgMax: after.dmgMax - before.dmgMax,
    attackRating: after.attackRating - before.attackRating,
    defense: after.defense - before.defense,
    maxLife: after.maxLife - before.maxLife,
    maxMana: after.maxMana - before.maxMana,
    magicFind: after.magicFind - before.magicFind,
  };
}
