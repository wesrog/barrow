import { describe, expect, test } from "bun:test";
import { isWalkable, mapFromStrings, SECRET, secretRunAt } from "../map";
import { createGameOn } from "../test-helpers";
import { player, playerZone } from "../test-helpers";
import { stepSolo } from "../tick";

/** A room, a hidden run of three cells east of it, and a room beyond. */
function secretMap() {
  const map = mapFromStrings([
    "#########",
    "#..#####",
    "#@.####.#",
    "#..#####",
    "#########",
  ].map((r) => r.padEnd(9, "#")));
  for (const x of [3, 4, 5, 6]) map.cells[2 * map.width + x] = SECRET;
  return map;
}

describe("secret passages", () => {
  test("a secret run is wall until a player stands beside it, then the whole run opens", () => {
    const state = createGameOn(1, secretMap());
    const map = playerZone(state).map;
    expect(isWalkable(map, 3, 2)).toBe(false);
    expect(secretRunAt(map, 3, 2).length).toBe(4);
    const p = player(state);
    p.pos = { x: 1.5, y: 1.5 }; // two cells from the run: nothing happens
    stepSolo(state, {});
    expect(isWalkable(map, 3, 2)).toBe(false);
    expect(state.events.some((e) => e.type === "secret_found")).toBe(false);
    p.pos = { x: 2.5, y: 2.5 }; // beside the first secret cell
    stepSolo(state, {});
    for (const x of [3, 4, 5, 6]) expect(isWalkable(map, x, 2)).toBe(true);
    const found = state.events.find((e) => e.type === "secret_found");
    expect(found && found.type === "secret_found" ? found.cells.length : 0).toBe(4);
    expect(map.revision).toBe(1);
    // Opening is once: the next tick finds no secret left.
    state.events.length = 0;
    stepSolo(state, {});
    expect(state.events.some((e) => e.type === "secret_found")).toBe(false);
  });
});
