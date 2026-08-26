import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { spawnMonster } from "./monsters";
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
    const state = createGame(2, arena());
    const weapon = state.player.equipment.weapon!;
    expect(weapon.durability).toBeDefined();
    const start = weapon.durability!.cur;
    // An immortal target to swing at forever
    const m = spawnMonster(state, "shambler", { x: 2.2, y: 1.5 });
    m.life = 1000000;
    m.dmgMin = 0;
    m.dmgMax = 0;
    step(state, { attack: m.id });
    for (let i = 0; i < 3000; i++) step(state, {});
    expect(weapon.durability!.cur).toBeLessThan(start);
    expect(weapon.durability!.cur).toBeGreaterThanOrEqual(0);
  });

  test("a broken weapon fights like bare fists until repaired", () => {
    const state = createGame(1, arena());
    const weapon = state.player.equipment.weapon!;
    weapon.durability!.cur = 0;
    recomputePlayerStats(state);
    expect(state.player.dmgMax).toBe(BASE_STATS.dmgMax);
    state.player.gold = 1000;
    const cost = repairAllCost(state);
    expect(cost).toBeGreaterThan(0);
    repairAll(state);
    expect(state.player.gold).toBe(1000 - cost);
    expect(weapon.durability!.cur).toBe(weapon.durability!.max);
    expect(state.player.dmgMax).toBe(6); // blade again
  });

  test("repair does nothing when gold is short", () => {
    const state = createGame(1, arena());
    state.player.equipment.weapon!.durability!.cur = 0;
    state.player.gold = 0;
    repairAll(state);
    expect(state.player.equipment.weapon!.durability!.cur).toBe(0);
  });
});
