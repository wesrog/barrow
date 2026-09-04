import { describe, expect, test } from "bun:test";
import { createEquipment } from "../../sim/character";
import type { Item } from "../../sim/items/generate";
import { equipDelta, groundVerdict, isComparable, upgradeVerdict } from "./itemCompare";

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
    const delta = equipDelta(eq, plain("war_maul"), 10, "warrior"); // 8–18
    expect(delta.dmgMin).toBe(7);
    expect(delta.dmgMax).toBe(12);
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
    eq.weapon = plain("war_maul"); // 8–18
    const withEd = plain("rusted_blade", [{ stat: "dmgPct", value: 50 }]); // 1–6 +50%
    const delta = equipDelta(eq, withEd, 10, "warrior");
    // 1*1.5=1, 6*1.5=9 vs 8/18
    expect(delta.dmgMin).toBe(-7);
    expect(delta.dmgMax).toBe(-9);
  });

  test("a two-hander's delta counts the shield it would knock off", () => {
    const eq = createEquipment();
    eq.weapon = plain("rusted_blade"); // 1–6
    eq.shield = plain("plank_buckler"); // defense 4
    const delta = equipDelta(eq, plain("war_maul"), 10, "warrior"); // 8–18
    expect(delta.dmgMin).toBe(7);
    expect(delta.dmgMax).toBe(12);
    expect(delta.defense).toBe(-4);
  });

  test("a shield beside a two-hander is a no-op, so its delta is zero", () => {
    const eq = createEquipment();
    eq.weapon = plain("war_maul");
    const delta = equipDelta(eq, plain("plank_buckler"), 10, "warrior");
    expect(delta.defense).toBe(0);
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

describe("upgradeVerdict", () => {
  const zero = { dmgMin: 0, dmgMax: 0, attackRating: 0, defense: 0, maxLife: 0, maxMana: 0, magicFind: 0 };
  test("all gains is better, all losses is worse", () => {
    expect(upgradeVerdict({ ...zero, defense: 5 })).toBe("better");
    expect(upgradeVerdict({ ...zero, dmgMin: -1, dmgMax: -3 })).toBe("worse");
  });
  test("gains and losses together are mixed; nothing moved is same", () => {
    expect(upgradeVerdict({ ...zero, defense: 5, maxLife: -10 })).toBe("mixed");
    expect(upgradeVerdict(zero)).toBe("same");
  });
});

describe("groundVerdict", () => {
  test("potions have no verdict; gear reports against current equipment", () => {
    const eq = createEquipment();
    eq.weapon = plain("war_maul"); // 8–18
    expect(groundVerdict(eq, plain("minor_potion"), 10, "warrior")).toBeNull();
    expect(groundVerdict(eq, plain("rusted_blade"), 10, "warrior")).toBe("worse");
    expect(groundVerdict(eq, plain("cracked_helm"), 10, "warrior")).toBe("better");
  });
});
