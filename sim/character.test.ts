import { describe, expect, test } from "bun:test";
import {
  INV_W,
  INV_H,
  createInventory,
  createEquipment,
  findSpot,
  placeItem,
  removeEntry,
  slotForItem,
  computeStats,
  isTwoHanded,
  BASE_STATS,
} from "./character";
import type { Item } from "./items/generate";

const plain = (baseId: string): Item => ({
  baseId,
  rarity: "normal",
  name: baseId,
  affixIds: [],
  mods: [],
  ilvl: 1,
});

describe("inventory grid", () => {
  test("places items left-to-right, top-to-bottom without overlap", () => {
    const inv = createInventory();
    // rag_tunic is 2x3
    expect(placeItem(inv, 1, plain("rag_tunic"))).toBe(true);
    expect(placeItem(inv, 2, plain("rag_tunic"))).toBe(true);
    const [a, b] = inv.entries;
    expect(a!.x).toBe(0);
    expect(a!.y).toBe(0);
    expect(b!.x).toBe(2); // packed beside, not overlapping
    expect(b!.y).toBe(0);
  });

  test("fills the grid and rejects items when no spot fits", () => {
    const inv = createInventory();
    // 1x1 rings fill every cell
    for (let i = 0; i < INV_W * INV_H; i++) {
      expect(placeItem(inv, i, plain("bone_ring"))).toBe(true);
    }
    expect(placeItem(inv, 999, plain("bone_ring"))).toBe(false);
    expect(findSpot(inv, 1, 1)).toBeNull();
  });

  test("a 2x3 item does not fit in a 1-row gap but a 1x1 does", () => {
    const inv = createInventory();
    // Fill all but the last row with rings.
    for (let i = 0; i < INV_W * (INV_H - 1); i++) {
      placeItem(inv, i, plain("bone_ring"));
    }
    expect(findSpot(inv, 2, 3)).toBeNull();
    expect(findSpot(inv, 1, 1)).toEqual({ x: 0, y: INV_H - 1 });
  });

  test("removing an entry frees its cells for reuse", () => {
    const inv = createInventory();
    placeItem(inv, 1, plain("rag_tunic"));
    const removed = removeEntry(inv, 1);
    expect(removed?.item.baseId).toBe("rag_tunic");
    expect(findSpot(inv, 2, 3)).toEqual({ x: 0, y: 0 });
    expect(removeEntry(inv, 1)).toBeNull();
  });
});

describe("slotForItem", () => {
  test("maps bases to their equip slot, rings to the first free ring", () => {
    const eq = createEquipment();
    expect(slotForItem(plain("rusted_blade"), eq)).toBe("weapon");
    expect(slotForItem(plain("bone_ring"), eq)).toBe("ring1");
    eq.ring1 = plain("bone_ring");
    expect(slotForItem(plain("bone_ring"), eq)).toBe("ring2");
    eq.ring2 = plain("bone_ring");
    expect(slotForItem(plain("bone_ring"), eq)).toBe("ring1"); // both full: swap first
    expect(slotForItem(plain("plank_buckler"), eq)).toBe("shield");
  });

  test("a preferred ring slot wins over the first-free rule, but only for rings", () => {
    const eq = createEquipment();
    eq.ring1 = plain("bone_ring");
    eq.ring2 = plain("bone_ring");
    expect(slotForItem(plain("bone_ring"), eq, "ring2")).toBe("ring2");
    expect(slotForItem(plain("bone_ring"), eq, "ring1")).toBe("ring1");
    // An empty ring2 is still preferred over swapping a full ring1.
    eq.ring2 = null;
    expect(slotForItem(plain("bone_ring"), eq, "ring2")).toBe("ring2");
    // Non-ring slots ignore the preference: a blade can't go on a finger.
    expect(slotForItem(plain("rusted_blade"), eq, "ring2")).toBe("weapon");
    expect(slotForItem(plain("bone_ring"), eq, "weapon")).toBe("ring2");
  });
});

describe("orbs as off-hands", () => {
  test("orbs equip into the shield slot", () => {
    const eq = createEquipment();
    expect(slotForItem(plain("ashen_orb"), eq)).toBe("shield");
    expect(slotForItem(plain("fen_pearl"), eq)).toBe("shield");
    expect(slotForItem(plain("grave_star"), eq)).toBe("shield");
  });

  test("an orb in the off-hand adds its base damage to unarmed damage", () => {
    const eq = createEquipment();
    eq.shield = plain("ashen_orb"); // 1-5
    const s = computeStats(eq);
    expect(s.dmgMin).toBe(BASE_STATS.dmgMin + 1);
    expect(s.dmgMax).toBe(BASE_STATS.dmgMax + 5);
  });

  test("an orb stacks with weapon damage instead of replacing it", () => {
    const eq = createEquipment();
    eq.weapon = plain("bone_wand"); // 1-3
    eq.shield = plain("fen_pearl"); // 5-12
    const s = computeStats(eq);
    expect(s.dmgMin).toBe(1 + 5);
    expect(s.dmgMax).toBe(3 + 12);
  });

  test("a broken orb contributes no damage", () => {
    const eq = createEquipment();
    eq.shield = { ...plain("ashen_orb"), durability: { cur: 0, max: 20 } };
    const s = computeStats(eq);
    expect(s.dmgMin).toBe(BASE_STATS.dmgMin);
    expect(s.dmgMax).toBe(BASE_STATS.dmgMax);
  });
});

describe("two-handed weapons", () => {
  test("isTwoHanded reads the base flag", () => {
    expect(isTwoHanded(plain("war_maul"))).toBe(true);
    expect(isTwoHanded(plain("rusted_blade"))).toBe(false);
    expect(isTwoHanded(plain("plank_buckler"))).toBe(false);
  });

  test("a shield next to a two-hander contributes nothing (stale saves, corpses)", () => {
    const eq = createEquipment();
    eq.weapon = plain("war_maul");
    eq.shield = plain("barrow_bulwark"); // defense 22
    const withShield = computeStats(eq, 10);
    eq.shield = null;
    const without = computeStats(eq, 10);
    expect(withShield.defense).toBe(without.defense);
  });
});

describe("computeStats", () => {
  test("naked stats equal the base stats", () => {
    const s = computeStats(createEquipment());
    expect(s.dmgMin).toBe(BASE_STATS.dmgMin);
    expect(s.dmgMax).toBe(BASE_STATS.dmgMax);
    expect(s.defense).toBe(BASE_STATS.defense);
    expect(s.maxLife).toBe(BASE_STATS.maxLife);
  });

  test("weapon replaces unarmed damage and armor adds defense", () => {
    const eq = createEquipment();
    eq.weapon = plain("rusted_blade"); // 1-6
    eq.chest = plain("rag_tunic"); // def 4
    const s = computeStats(eq);
    expect(s.dmgMin).toBe(1);
    expect(s.dmgMax).toBe(6);
    expect(s.defense).toBe(BASE_STATS.defense + 4);
  });

  test("an equipped shield adds its defense", () => {
    const eq = createEquipment();
    eq.shield = plain("plank_buckler"); // def 4
    const s = computeStats(eq);
    expect(s.defense).toBe(BASE_STATS.defense + 4);
  });

  test("flat damage mods add, then dmgPct multiplies weapon damage", () => {
    const eq = createEquipment();
    eq.weapon = {
      ...plain("rusted_blade"), // 1-6
      rarity: "magic",
      mods: [
        { stat: "dmgMin", value: 2 },
        { stat: "dmgMax", value: 4 },
        { stat: "dmgPct", value: 50 },
      ],
    };
    const s = computeStats(eq);
    // (1+2)*1.5 = 4.5 -> floor 4; (6+4)*1.5 = 15
    expect(s.dmgMin).toBe(4);
    expect(s.dmgMax).toBe(15);
  });

  test("life, attack rating, magic find and speeds aggregate across all gear", () => {
    const eq = createEquipment();
    eq.ring1 = { ...plain("bone_ring"), mods: [{ stat: "life", value: 10 }, { stat: "magicFind", value: 12 }] };
    eq.amulet = { ...plain("grave_amulet"), mods: [{ stat: "attackRating", value: 30 }, { stat: "attackSpeedPct", value: 20 }] };
    eq.boots = { ...plain("worn_boots"), mods: [{ stat: "moveSpeedPct", value: 10 }] };
    const s = computeStats(eq);
    expect(s.maxLife).toBe(BASE_STATS.maxLife + 10);
    expect(s.attackRating).toBe(BASE_STATS.attackRating + 30);
    expect(s.magicFind).toBe(12);
    expect(s.moveSpeedPct).toBe(10);
    // 20% IAS on a 12-tick swing -> 10 ticks
    expect(s.swingEvery).toBe(Math.round(BASE_STATS.swingEvery / 1.2));
    // the sheet shows the raw percentage too
    expect(s.attackSpeedPct).toBe(20);
  });

  test("life regen comes only from gear, D2 Replenish Life style", () => {
    const eq = createEquipment();
    expect(computeStats(eq).lifeRegen).toBe(0); // no natural regen — potions stay king
    eq.ring1 = { ...plain("bone_ring"), mods: [{ stat: "lifeRegen", value: 2 }] };
    eq.amulet = { ...plain("grave_amulet"), mods: [{ stat: "lifeRegen", value: 3 }] };
    expect(computeStats(eq).lifeRegen).toBe(5);
  });
});
