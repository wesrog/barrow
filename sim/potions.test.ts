import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { BELT_SIZE, placeItem } from "./character";
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

function dropAt(state: GameState, item: Item, x: number, y: number): number {
  const id = state.nextId++;
  state.groundItems.set(id, { id, item, pos: { x, y } });
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
    const state = createGame(1, arena());
    for (let i = 0; i < BELT_SIZE + 1; i++) {
      const id = dropAt(state, potion(), 2.5, 1.5);
      step(state, { pickup: id });
      for (let t = 0; t < 40 && state.groundItems.has(id); t++) step(state, {});
    }
    expect(state.player.belt).toBe(BELT_SIZE);
    expect(state.player.inventory.entries).toHaveLength(1);
  });

  test("drinking heals, consumes a charge, and never overheals", () => {
    const state = createGame(1, arena());
    state.player.belt = 2;
    state.player.life = 40;
    step(state, { drink: true });
    expect(state.player.belt).toBe(1);
    expect(state.player.life).toBe(75); // +35
    step(state, { drink: true });
    expect(state.player.life).toBe(state.player.maxLife); // clamped
    step(state, { drink: true }); // belt empty: no-op
    expect(state.player.belt).toBe(0);
  });

  test("clicking an inventory potion moves it to the belt", () => {
    const state = createGame(1, arena());
    state.player.belt = 0;
    const id = state.nextId++;
    placeItem(state.player.inventory, id, potion());
    step(state, { equip: id });
    expect(state.player.belt).toBe(1);
    expect(state.player.inventory.entries).toHaveLength(0);
    // never lands in an equipment slot
    expect(Object.values(state.player.equipment).every((it) => it === null || it.baseId !== "minor_potion")).toBe(true);
  });
});
