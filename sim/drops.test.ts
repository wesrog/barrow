import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import { recomputePlayerStats } from "./systems/inventory";
import type { GameState } from "./state";
import { createRng } from "./rng";
import { BASES } from "./items/bases";
import { AFFIXES } from "./items/affixes";
import { rollDrop } from "./items/treasure";
import { rollItem } from "./items/generate";

const arena = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

/** Equip a one-shot test weapon so overrides survive stat recomputes. */
function armToTheTeeth(game: GameState): void {
  player(game).equipment.weapon = {
    baseId: "rusted_blade",
    rarity: "unique",
    name: "Test Cleaver",
    affixIds: [],
    mods: [
      { stat: "dmgMin", value: 500 },
      { stat: "dmgMax", value: 500 },
      { stat: "life", value: 100000 },
    ],
    ilvl: 99,
  };
  recomputePlayerStats(game, player(game));
  player(game).life = player(game).maxLife;
}

describe("monster drops", () => {
  test("killing many monsters produces ground items at corpse positions", () => {
    const game = createGameOn(2, arena());
    armToTheTeeth(game);
    let kills = 0;
    for (let round = 0; round < 60; round++) {
      const m = spawnAt(game, "skitter", { x: 2.5, y: 1.5 });
      for (let i = 0; i < 60 && playerZone(game).monsters.has(m.id); i++)
        stepSolo(game, { attack: m.id });
      if (!playerZone(game).monsters.has(m.id)) kills++;
    }
    expect(kills).toBe(60);
    const items = [...playerZone(game).groundItems.values()];
    // trash TC drops ~30% of the time; 60 kills should yield some but not all.
    expect(items.length).toBeGreaterThan(2);
    expect(items.length).toBeLessThan(55);
    for (const gi of items) {
      expect(gi.item.baseId).toBeDefined();
      // dropped near the corpse (scatter is small)
      expect(Math.abs(gi.pos.x - 2.5)).toBeLessThanOrEqual(1.6);
      expect(Math.abs(gi.pos.y - 1.5)).toBeLessThanOrEqual(1.6);
    }
    const ids = items.map((gi) => gi.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("drops respect the monster's level for base selection", () => {
    const game = createGameOn(3, arena());
    armToTheTeeth(game);
    for (let round = 0; round < 80; round++) {
      const m = spawnAt(game, "skitter", { x: 2.5, y: 1.5 });
      for (let i = 0; i < 60 && playerZone(game).monsters.has(m.id); i++)
        stepSolo(game, { attack: m.id });
    }
    for (const gi of playerZone(game).groundItems.values()) {
      expect(gi.item.ilvl).toBe(2); // skitter mlvl
    }
  });
});

describe("potion drops", () => {
  test("trash and standard classes drop mana potions, less often than healing", () => {
    for (const tc of ["trash", "standard"]) {
      const rng = createRng(7);
      let heal = 0;
      let mana = 0;
      for (let i = 0; i < 2000; i++) {
        const item = rollDrop(rng, tc, 5, { guaranteed: true });
        if (item?.baseId === "minor_potion") heal++;
        if (item?.baseId === "minor_mana_potion") mana++;
      }
      expect(mana).toBeGreaterThan(0);
      expect(heal).toBeGreaterThan(mana);
    }
  });
});

describe("high-level content", () => {
  test("low monster levels never drop bases above their level", () => {
    const rng = createRng(1);
    for (let i = 0; i < 400; i++) {
      const item = rollDrop(rng, "standard", 15, { guaranteed: true });
      if (item) expect(BASES[item.baseId]!.levelReq).toBeLessThanOrEqual(15);
    }
  });

  test("deep-region monster levels unlock the new bases", () => {
    const rng = createRng(2);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const item = rollDrop(rng, "standard", 28, { guaranteed: true });
      if (item) seen.add(item.baseId);
    }
    expect([...seen].some((id) => BASES[id]!.levelReq > 16)).toBe(true);
  });

  test("high item levels roll the new affixes, never above the ilvl cap", () => {
    const rng = createRng(3);
    const rolled = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      const item = rollItem(rng, "kingsbane", 24, "rare");
      for (const id of item.affixIds) {
        rolled.add(id);
        expect(AFFIXES[id]!.alvl).toBeLessThanOrEqual(24);
      }
    }
    expect([...rolled].some((id) => AFFIXES[id]!.alvl > 18)).toBe(true);
  });
});
