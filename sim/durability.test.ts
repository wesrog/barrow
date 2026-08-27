import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, spawnAt } from "./test-helpers";
import { rollItem } from "./items/generate";
import { createRng } from "./rng";
import { BASE_STATS } from "./character";
import { recomputePlayerStats, repairAllCost, repairAll } from "./systems/inventory";

const arena = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

describe("durability", () => {
  test("weapons and armor roll with durability; potions and jewelry don't", () => {
    const rng = createRng(3);
    expect(rollItem(rng, "rusted_blade", 1, "normal").durability).toBeDefined();
    expect(rollItem(rng, "rag_tunic", 1, "magic").durability).toBeDefined();
    expect(rollItem(rng, "bone_ring", 5, "rare").durability).toBeUndefined();
    expect(rollItem(rng, "minor_potion", 1, "normal").durability).toBeUndefined();
  });

  test("swinging wears the weapon down over time", () => {
    const state = createGameOn(2, arena());
    const weapon = player(state).equipment.weapon!;
    expect(weapon.durability).toBeDefined();
    const start = weapon.durability!.cur;
    // An immortal target to swing at forever
    const m = spawnAt(state, "shambler", { x: 2.2, y: 1.5 });
    m.life = 1000000;
    m.dmgMin = 0;
    m.dmgMax = 0;
    stepSolo(state, { attack: m.id });
    for (let i = 0; i < 3000; i++) stepSolo(state, {});
    expect(weapon.durability!.cur).toBeLessThan(start);
    expect(weapon.durability!.cur).toBeGreaterThanOrEqual(0);
  });

  test("a broken weapon fights like bare fists until repaired", () => {
    const state = createGameOn(1, arena());
    const weapon = player(state).equipment.weapon!;
    weapon.durability!.cur = 0;
    recomputePlayerStats(state, player(state));
    expect(player(state).dmgMax).toBe(BASE_STATS.dmgMax);
    player(state).gold = 1000;
    const cost = repairAllCost(state, player(state));
    expect(cost).toBeGreaterThan(0);
    repairAll(state, player(state));
    expect(player(state).gold).toBe(1000 - cost);
    expect(weapon.durability!.cur).toBe(weapon.durability!.max);
    expect(player(state).dmgMax).toBe(6); // blade again
  });

  test("repair does nothing when gold is short", () => {
    const state = createGameOn(1, arena());
    player(state).equipment.weapon!.durability!.cur = 0;
    player(state).gold = 0;
    repairAll(state, player(state));
    expect(player(state).equipment.weapon!.durability!.cur).toBe(0);
  });
});
