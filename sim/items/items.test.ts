import { describe, expect, test } from "bun:test";
import { createRng } from "../rng";
import { BASES } from "./bases";
import { AFFIXES } from "./affixes";
import { UNIQUES } from "./uniques";
import { TREASURE_CLASSES, rollDrop } from "./treasure";
import { rollItem } from "./generate";

describe("data table sanity", () => {
  test("every affix references only real slots and has sane ranges", () => {
    for (const a of Object.values(AFFIXES)) {
      expect(a.kind === "prefix" || a.kind === "suffix").toBe(true);
      expect(a.alvl).toBeGreaterThanOrEqual(1);
      for (const mod of a.mods) {
        expect(mod.min).toBeLessThanOrEqual(mod.max);
      }
    }
  });

  test("every unique references a real base", () => {
    for (const u of Object.values(UNIQUES)) {
      expect(BASES[u.baseId]).toBeDefined();
    }
  });

  test("every treasure class entry references real bases", () => {
    for (const tc of Object.values(TREASURE_CLASSES)) {
      for (const entry of tc.entries) {
        for (const id of entry.baseIds) expect(BASES[id]).toBeDefined();
      }
    }
  });
});

describe("rollItem", () => {
  const anyBase = () => Object.keys(BASES)[0]!;

  test("same seed produces the identical item", () => {
    const roll = () => rollItem(createRng(77), "rusted_blade", 10, "rare");
    expect(JSON.stringify(roll())).toBe(JSON.stringify(roll()));
  });

  test("magic items have 1-2 affixes, at most one prefix and one suffix", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const item = rollItem(rng, anyBase(), 20, "magic");
      const affixes = item.affixIds.map((id) => AFFIXES[id]!);
      expect(affixes.length).toBeGreaterThanOrEqual(1);
      expect(affixes.length).toBeLessThanOrEqual(2);
      expect(affixes.filter((a) => a.kind === "prefix").length).toBeLessThanOrEqual(1);
      expect(affixes.filter((a) => a.kind === "suffix").length).toBeLessThanOrEqual(1);
    }
  });

  test("rare items have 3-6 affixes, max 3 of each kind, distinct groups", () => {
    const rng = createRng(4);
    for (let i = 0; i < 500; i++) {
      const item = rollItem(rng, anyBase(), 30, "rare");
      const affixes = item.affixIds.map((id) => AFFIXES[id]!);
      expect(affixes.length).toBeGreaterThanOrEqual(3);
      expect(affixes.length).toBeLessThanOrEqual(6);
      expect(affixes.filter((a) => a.kind === "prefix").length).toBeLessThanOrEqual(3);
      expect(affixes.filter((a) => a.kind === "suffix").length).toBeLessThanOrEqual(3);
      const groups = affixes.map((a) => a.group);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  test("affixes never exceed the item level and match the base's slot", () => {
    const rng = createRng(5);
    for (const ilvl of [1, 5, 12, 40]) {
      for (let i = 0; i < 200; i++) {
        const item = rollItem(rng, "rusted_blade", ilvl, "rare");
        for (const id of item.affixIds) {
          const a = AFFIXES[id]!;
          expect(a.alvl).toBeLessThanOrEqual(ilvl);
          if (a.slots !== "any") {
            expect(a.slots).toContain(BASES["rusted_blade"]!.slot);
          }
        }
      }
    }
  });

  test("rolled mod values fall inside the affix's declared range", () => {
    const rng = createRng(6);
    for (let i = 0; i < 300; i++) {
      const item = rollItem(rng, anyBase(), 30, "magic");
      // Mods are emitted in affix order, one per declared range.
      const ranges = item.affixIds.flatMap((id) => AFFIXES[id]!.mods);
      expect(item.mods.length).toBe(ranges.length);
      item.mods.forEach((mod, i) => {
        const range = ranges[i]!;
        expect(mod.stat).toBe(range.stat);
        expect(mod.value).toBeGreaterThanOrEqual(range.min);
        expect(mod.value).toBeLessThanOrEqual(range.max);
      });
    }
  });

  test("unique items take a matching unique's fixed name and mods", () => {
    const rng = createRng(7);
    const uniq = Object.values(UNIQUES)[0]!;
    const item = rollItem(rng, uniq.baseId, 50, "unique");
    expect(item.rarity).toBe("unique");
    expect(item.name).toBe(uniq.name);
    expect(item.mods.length).toBeGreaterThan(0);
  });

  test("normal items carry no affixes and keep the base name", () => {
    const item = rollItem(createRng(8), "rusted_blade", 10, "normal");
    expect(item.affixIds).toEqual([]);
    expect(item.mods).toEqual([]);
    expect(item.name).toBe(BASES["rusted_blade"]!.name);
  });
});

describe("shields", () => {
  test("shield bases exist across the level curve and carry defense", () => {
    const shields = Object.values(BASES).filter((b) => b.slot === "shield");
    expect(shields.length).toBeGreaterThanOrEqual(3);
    for (const s of shields) expect(s.defense).toBeGreaterThan(0);
    expect(Math.min(...shields.map((s) => s.levelReq))).toBe(1);
  });

  test("shields drop from treasure classes", () => {
    const rng = createRng(21);
    let shields = 0;
    for (let i = 0; i < 3000; i++) {
      const item = rollDrop(rng, "standard", 30);
      if (item && BASES[item.baseId]!.slot === "shield") shields++;
    }
    expect(shields).toBeGreaterThan(0);
  });

  test("rare shields roll only shield-legal affixes", () => {
    const rng = createRng(22);
    for (let i = 0; i < 300; i++) {
      const item = rollItem(rng, "plank_buckler", 30, "rare");
      expect(item.affixIds.length).toBeGreaterThanOrEqual(3);
      for (const id of item.affixIds) {
        const a = AFFIXES[id]!;
        if (a.slots !== "any") expect(a.slots).toContain("shield");
      }
    }
  });
});

describe("rollDrop", () => {
  test("respects NoDrop weight within tolerance", () => {
    const rng = createRng(9);
    const tc = TREASURE_CLASSES["trash"]!;
    const totalWeight = tc.entries.reduce((s, e) => s + e.weight, 0);
    const expectedDropRate = totalWeight / (totalWeight + tc.nodrop);
    let drops = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
      if (rollDrop(rng, "trash", 10) !== null) drops++;
    }
    expect(drops / N).toBeGreaterThan(expectedDropRate - 0.03);
    expect(drops / N).toBeLessThan(expectedDropRate + 0.03);
  });

  test("never drops a base whose levelReq exceeds the monster level", () => {
    const rng = createRng(10);
    for (let i = 0; i < 2000; i++) {
      const item = rollDrop(rng, "boss", 3);
      if (item) expect(BASES[item.baseId]!.levelReq).toBeLessThanOrEqual(3);
    }
  });

  test("boss treasure class yields magic-or-better more often than trash", () => {
    const rng = createRng(11);
    const magicPlus = (tcId: string) => {
      let n = 0;
      let drops = 0;
      for (let i = 0; i < 5000; i++) {
        const item = rollDrop(rng, tcId, 20);
        if (item) {
          drops++;
          if (item.rarity !== "normal") n++;
        }
      }
      return n / drops;
    };
    expect(magicPlus("boss")).toBeGreaterThan(magicPlus("trash"));
  });
});

describe("class-restricted weapons", () => {
  test("caster weapons exist across the level curve, all witch-only", () => {
    const casters = Object.values(BASES).filter((b) => b.classReq === "witch");
    expect(casters.length).toBeGreaterThanOrEqual(6);
    for (const c of casters) expect(c.slot).toBe("weapon");
    expect(Math.min(...casters.map((c) => c.levelReq))).toBe(1);
    expect(Math.max(...casters.map((c) => c.levelReq))).toBeGreaterThanOrEqual(20);
  });

  test("heavy two-wide weapons are warrior-only, one-wide blades unrestricted", () => {
    expect(BASES["war_maul"]!.classReq).toBe("warrior");
    expect(BASES["grave_scythe"]!.classReq).toBe("warrior");
    expect(BASES["dire_flail"]!.classReq).toBe("warrior");
    expect(BASES["moon_glaive"]!.classReq).toBe("warrior");
    expect(BASES["rusted_blade"]!.classReq).toBeUndefined();
    expect(BASES["hatchet"]!.classReq).toBeUndefined();
    expect(BASES["twin_fang"]!.classReq).toBeUndefined();
    expect(BASES["kingsbane"]!.classReq).toBeUndefined();
  });

  test("caster weapons drop from every treasure class", () => {
    for (const tcId of ["trash", "standard", "boss"]) {
      const rng = createRng(31);
      let casters = 0;
      for (let i = 0; i < 4000; i++) {
        const item = rollDrop(rng, tcId, 30);
        if (item && BASES[item.baseId]!.classReq === "witch") casters++;
      }
      expect(casters).toBeGreaterThan(0);
    }
  });

  test("biasClass slightly favors that class's weapons without excluding others", () => {
    const count = (biasClass: "warrior" | "witch") => {
      const rng = createRng(32);
      let witch = 0;
      let warrior = 0;
      for (let i = 0; i < 8000; i++) {
        const item = rollDrop(rng, "standard", 30, { biasClass });
        if (!item) continue;
        const req = BASES[item.baseId]!.classReq;
        if (req === "witch") witch++;
        if (req === "warrior") warrior++;
      }
      return { witch, warrior };
    };
    const asWitch = count("witch");
    const asWarrior = count("warrior");
    expect(asWitch.witch).toBeGreaterThan(asWarrior.witch);
    expect(asWarrior.warrior).toBeGreaterThan(asWitch.warrior);
    // Slight bias: the off-class gear still drops.
    expect(asWitch.warrior).toBeGreaterThan(0);
    expect(asWarrior.witch).toBeGreaterThan(0);
  });
});
