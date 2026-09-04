import { describe, expect, test } from "bun:test";
import { createEquipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { equipDelta, isComparable } from "./itemCompare";

function plain(baseId: string, mods: Item["mods"] = []): Item {
  return { baseId, rarity: "normal", name: baseId, affixIds: [], mods, ilvl: 1 };
}

describe("isComparable", () => {
  test("gear compares, potions and quest items do not", () => {
    expect(isComparable(plain("rusted_blade"))).toBe(true);
    expect(isComparable(plain("bone_ring"))).toBe(true);
    expect(isComparable(plain("minor_potion"))).toBe(false);
    expect(isComparable(plain("grave_moss"))).toBe(false);
    expect(isComparable(plain("fen_heart"))).toBe(false);
  });
});

describe("equipDelta", () => {
  test("weapon swap reports damage change vs currently equipped weapon", () => {
    const eq = createEquipment();
    eq.weapon = plain("rusted_blade"); // 1–6
    const delta = equipDelta(eq, plain("war_maul"), 10, "warrior"); // 6–14
    expect(delta.dmgMin).toBe(5);
    expect(delta.dmgMax).toBe(8);
    expect(delta.defense).toBe(0);
  });

  test("armor into an empty slot is a pure gain", () => {
    const eq = createEquipment();
    const delta = equipDelta(eq, plain("cracked_helm"), 1, "warrior"); // defense 3
    expect(delta.defense).toBe(3);
    expect(delta.dmgMin).toBe(0);
  });

  test("downgrade reports negative deltas", () => {
    const eq = createEquipment();
    eq.chest = plain("grave_plate"); // defense 16
    const delta = equipDelta(eq, plain("rag_tunic"), 20, "warrior"); // defense 4
    expect(delta.defense).toBe(-12);
  });

  test("percent damage mods interact with the weapon, not the item alone", () => {
    const eq = createEquipment();
    eq.weapon = plain("war_maul"); // 6–14
    const withEd = plain("rusted_blade", [{ stat: "dmgPct", value: 50 }]); // 1–6 +50%
    const delta = equipDelta(eq, withEd, 10, "warrior");
    // 1*1.5=1, 6*1.5=9 vs 6/14
    expect(delta.dmgMin).toBe(-5);
    expect(delta.dmgMax).toBe(-5);
  });

  test("ring prefers the empty slot, so a second ring adds instead of replacing", () => {
    const eq = createEquipment();
    eq.ring1 = plain("bone_ring", [{ stat: "life", value: 10 }]);
    const delta = equipDelta(eq, plain("bone_ring", [{ stat: "mana", value: 5 }]), 10, "warrior");
    expect(delta.maxLife).toBe(0);
    expect(delta.maxMana).toBe(5);
  });

  test("a named ring slot compares against that ring instead of the first", () => {
    const eq = createEquipment();
    eq.ring1 = plain("bone_ring", [{ stat: "life", value: 10 }]);
    eq.ring2 = plain("bone_ring", [{ stat: "mana", value: 5 }]);
    const ring = plain("bone_ring", [{ stat: "life", value: 4 }]);
    const vsFirst = equipDelta(eq, ring, 10, "warrior");
    expect(vsFirst.maxLife).toBe(-6);
    expect(vsFirst.maxMana).toBe(0);
    const vsSecond = equipDelta(eq, ring, 10, "warrior", "ring2");
    expect(vsSecond.maxLife).toBe(4);
    expect(vsSecond.maxMana).toBe(-5);
  });
});
