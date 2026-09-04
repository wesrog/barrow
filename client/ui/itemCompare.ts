import {
  computeStats,
  isTwoHanded,
  slotForItem,
  type DerivedStats,
  type Equipment,
  type EquipSlot,
} from "../../sim/character";
import { BASES } from "../../sim/items/bases";
import type { Item } from "../../sim/items/generate";
import type { Klass } from "../../sim/skills";

/** Whether the hover tooltip can show an equip diff — potions and quest goods don't equip. */
export function isComparable(item: Item): boolean {
  const slot = BASES[item.baseId]!.slot;
  return slot !== "potion" && slot !== "quest";
}

export type StatDelta = Pick<
  DerivedStats,
  "dmgMin" | "dmgMax" | "attackRating" | "defense" | "maxLife" | "maxMana" | "magicFind"
>;

/** Character-stat change from equipping `item` into the slot it would occupy
 *  (or `into`, when the player names a ring slot). */
export function equipDelta(
  eq: Equipment,
  item: Item,
  level: number,
  klass: Klass,
  into?: EquipSlot,
): StatDelta {
  const slot = slotForItem(item, eq, into);
  const swapped: Equipment = { ...eq, [slot]: item };
  // A two-hander knocks the shield off; computeStats already ignores a shield
  // beside one, so the refused case (shield onto a two-hander) reads as no change.
  if (isTwoHanded(item)) swapped.shield = null;
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
