import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone } from "./test-helpers";
import { BELT_CAPACITY, BELT_SIZE, placeItem } from "./character";
import { rollItem, type Item } from "./items/generate";
import { createRng } from "./rng";
import type { GameState } from "./state";

const arena = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

const potion = (): Item => ({
  baseId: "minor_potion",
  rarity: "normal",
  name: "Minor Healing Potion",
  affixIds: [],
  mods: [],
  ilvl: 1,
});

const manaPotion = (): Item => ({
  baseId: "minor_mana_potion",
  rarity: "normal",
  name: "Minor Mana Potion",
  affixIds: [],
  mods: [],
  ilvl: 1,
});

function dropAt(state: GameState, item: Item, x: number, y: number): number {
  const id = state.nextId++;
  playerZone(state).groundItems.set(id, { id, item, pos: { x, y } });
  return id;
}

describe("potions", () => {
  test("potion bases always roll plain, even at high rarity", () => {
    const rng = createRng(4);
    const item = rollItem(rng, "minor_potion", 20, "rare");
    expect(item.rarity).toBe("normal");
    expect(item.mods).toHaveLength(0);
  });

  test("picked-up potions fill the belt before the inventory", () => {
    const state = createGameOn(1, arena());
    for (let i = 0; i < BELT_CAPACITY + 1; i++) {
      const id = dropAt(state, potion(), 2.5, 1.5);
      stepSolo(state, { pickup: id });
      for (let t = 0; t < 40 && playerZone(state).groundItems.has(id); t++) stepSolo(state, {});
    }
    expect(player(state).belt).toBe(BELT_CAPACITY);
    expect(player(state).inventory.entries).toHaveLength(1);
  });

  test("a potion takes any free belt slot, even past its own row", () => {
    const state = createGameOn(1, arena());
    player(state).belt = BELT_SIZE; // healing row full, mana row empty
    const id = dropAt(state, potion(), 2.5, 1.5);
    stepSolo(state, { pickup: id });
    for (let t = 0; t < 40 && playerZone(state).groundItems.has(id); t++) stepSolo(state, {});
    expect(player(state).belt).toBe(BELT_SIZE + 1);
    expect(player(state).inventory.entries).toHaveLength(0);
  });

  test("the belt is one shared pool: mixed potions overflow only when every slot is taken", () => {
    const state = createGameOn(1, arena());
    player(state).belt = BELT_CAPACITY - 1;
    const mana = dropAt(state, manaPotion(), 2.5, 1.5);
    stepSolo(state, { pickup: mana });
    for (let t = 0; t < 40 && playerZone(state).groundItems.has(mana); t++) stepSolo(state, {});
    expect(player(state).manaBelt).toBe(1); // last slot
    expect(player(state).inventory.entries).toHaveLength(0);
    const extra = dropAt(state, potion(), 2.5, 1.5);
    stepSolo(state, { pickup: extra });
    for (let t = 0; t < 40 && playerZone(state).groundItems.has(extra); t++) stepSolo(state, {});
    expect(player(state).belt).toBe(BELT_CAPACITY - 1);
    expect(player(state).inventory.entries).toHaveLength(1);
  });

  test("drinking heals, consumes a charge, and never overheals", () => {
    const state = createGameOn(1, arena());
    player(state).belt = 2;
    player(state).life = 40;
    stepSolo(state, { drink: true });
    expect(player(state).belt).toBe(1);
    expect(player(state).life).toBe(75); // +35
    stepSolo(state, { drink: true });
    expect(player(state).life).toBe(player(state).maxLife); // clamped
    stepSolo(state, { drink: true }); // belt empty: no-op
    expect(player(state).belt).toBe(0);
  });

  test("mana potions fill their own belt row", () => {
    const state = createGameOn(1, arena());
    const id = dropAt(state, manaPotion(), 2.5, 1.5);
    stepSolo(state, { pickup: id });
    for (let t = 0; t < 40 && playerZone(state).groundItems.has(id); t++) stepSolo(state, {});
    expect(player(state).manaBelt).toBe(1);
    expect(player(state).belt).toBe(0);
    expect(player(state).inventory.entries).toHaveLength(0);
  });

  test("drinking a mana potion restores mana, consumes a charge, never overfills", () => {
    const state = createGameOn(1, arena());
    player(state).manaBelt = 2;
    player(state).mana = 0;
    stepSolo(state, { drink: "mana" });
    expect(player(state).manaBelt).toBe(1);
    expect(player(state).mana).toBeCloseTo(25, 0); // +25, give or take a tick of regen
    player(state).mana = player(state).maxMana - 1;
    stepSolo(state, { drink: "mana" });
    expect(player(state).mana).toBe(player(state).maxMana); // clamped
    stepSolo(state, { drink: "mana" }); // row empty: no-op
    expect(player(state).manaBelt).toBe(0);
  });

  test("drink 'health' and the legacy boolean both pull from the healing row", () => {
    const state = createGameOn(1, arena());
    player(state).belt = 2;
    player(state).life = 10;
    stepSolo(state, { drink: "health" });
    expect(player(state).belt).toBe(1);
    expect(player(state).life).toBe(45);
    stepSolo(state, { drink: true as unknown as "health" });
    expect(player(state).belt).toBe(0);
  });

  test("clicking an inventory mana potion moves it to the mana row", () => {
    const state = createGameOn(1, arena());
    const id = state.nextId++;
    placeItem(player(state).inventory, id, manaPotion());
    stepSolo(state, { equip: id });
    expect(player(state).manaBelt).toBe(1);
    expect(player(state).inventory.entries).toHaveLength(0);
  });

  test("clicking an inventory potion moves it to the belt", () => {
    const state = createGameOn(1, arena());
    player(state).belt = 0;
    const id = state.nextId++;
    placeItem(player(state).inventory, id, potion());
    stepSolo(state, { equip: id });
    expect(player(state).belt).toBe(1);
    expect(player(state).inventory.entries).toHaveLength(0);
    // never lands in an equipment slot
    expect(Object.values(player(state).equipment).every((it) => it === null || it.baseId !== "minor_potion")).toBe(true);
  });
});
