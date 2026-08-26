import { describe, expect, test } from "bun:test";
import { mapFromStrings, isWalkable, hasLineOfSight } from "./map";

describe("mapFromStrings", () => {
  test("parses walkable floor, walls, and spawn point", () => {
    const map = mapFromStrings([
      "#####",
      "#@..#",
      "#.#.#",
      "#####",
    ]);
    expect(map.width).toBe(5);
    expect(map.height).toBe(4);
    expect(map.spawn).toEqual({ x: 1.5, y: 1.5 }); // center of the @ cell
    expect(isWalkable(map, 1, 1)).toBe(true);
    expect(isWalkable(map, 2, 1)).toBe(true);
    expect(isWalkable(map, 0, 0)).toBe(false);
    expect(isWalkable(map, 2, 2)).toBe(false);
  });

  test("collects non-floor marker characters with their cell centers", () => {
    const map = mapFromStrings([
      "#####",
      "#@z.#",
      "#.B.#",
      "#####",
    ]);
    expect(map.markers).toEqual([
      { ch: "z", x: 2.5, y: 1.5 },
      { ch: "B", x: 2.5, y: 2.5 },
    ]);
    // marker cells are still walkable floor
    expect(isWalkable(map, 2, 1)).toBe(true);
    expect(isWalkable(map, 2, 2)).toBe(true);
  });

  test("out-of-bounds cells are not walkable", () => {
    const map = mapFromStrings(["@."]);
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 2, 0)).toBe(false);
    expect(isWalkable(map, 0, 5)).toBe(false);
  });
});

describe("hasLineOfSight", () => {
  test("open ground has sight, walls block it", () => {
    const map = mapFromStrings([
      "@....",
      "..#..",
      ".....",
    ]);
    expect(hasLineOfSight(map, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 })).toBe(true);
    expect(hasLineOfSight(map, { x: 0.5, y: 1.5 }, { x: 4.5, y: 1.5 })).toBe(false);
    // diagonal across the wall corner is blocked too
    expect(hasLineOfSight(map, { x: 2.5, y: 0.5 }, { x: 2.5, y: 2.5 })).toBe(false);
  });
});
