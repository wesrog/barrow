import { describe, expect, test } from "bun:test";
import { mapFromStrings, isWalkable } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone } from "./test-helpers";
import { dropSpot } from "./systems/combat";
import { createRng } from "./rng";
import type { Item } from "./items/generate";
import type { GameState } from "./state";

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
  playerZone(state).groundItems.set(id, { id, item, pos: { x, y } });
  return id;
}

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepSolo(state, {});
}

describe("clicking blocked ground", () => {
  test("walks the player up to the nearest open cell instead of ignoring the click", () => {
    const state = createGameOn(1, mapFromStrings([
      "########",
      "#@....##",
      "#.....##",
      "########",
    ]));
    const start = { ...player(state).pos };
    stepSolo(state, { moveTo: { x: 6.5, y: 1.5 } }); // wall cell
    run(state, 100);
    const p = player(state);
    expect(p.pos.x).toBeGreaterThan(start.x + 2);
  });

  test("a click on open floor lands on the exact point, not the cell center", () => {
    const state = createGameOn(1, mapFromStrings([
      "########",
      "#@.....#",
      "#......#",
      "########",
    ]));
    stepSolo(state, { moveTo: { x: 5.25, y: 2.25 } });
    run(state, 200);
    const p = player(state);
    expect(p.pos.x).toBeCloseTo(5.25, 5);
    expect(p.pos.y).toBeCloseTo(2.25, 5);
  });
});

describe("picking up loot from blocked ground", () => {
  test("an item that fell into a wall cell can still be picked up", () => {
    const state = createGameOn(1, mapFromStrings([
      "########",
      "#@....##",
      "#.....##",
      "########",
    ]));
    const id = dropAt(state, potion(), 6.5, 1.5); // wall cell beside the floor
    stepSolo(state, { pickup: id });
    run(state, 300);
    expect(playerZone(state).groundItems.has(id)).toBe(false);
  });

  test("an item reachable only diagonally is grabbed from the adjacent cell", () => {
    const state = createGameOn(1, mapFromStrings([
      "######",
      "#@..##",
      "#..###",
      "######",
      "######",
    ]));
    // Cell (3,3) is walled and all its orthogonal neighbors are too; the only
    // open cell touching it is (2,2), diagonally, at distance ~1.41.
    const id = dropAt(state, potion(), 3.5, 3.5);
    stepSolo(state, { pickup: id });
    run(state, 300);
    expect(playerZone(state).groundItems.has(id)).toBe(false);
  });
});

describe("dropSpot", () => {
  test("never scatters loot into blocked cells", () => {
    const map = mapFromStrings([
      "#####",
      "#.@.#",
      "#####",
    ]);
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const pos = dropSpot(rng, map, { x: 2.5, y: 1.5 });
      expect(isWalkable(map, Math.floor(pos.x), Math.floor(pos.y))).toBe(true);
    }
  });
});
