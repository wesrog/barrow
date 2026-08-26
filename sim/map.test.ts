import { describe, expect, test } from "bun:test";
import { mapFromStrings, isWalkable } from "./map";

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

  test("out-of-bounds cells are not walkable", () => {
    const map = mapFromStrings(["@."]);
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 2, 0)).toBe(false);
    expect(isWalkable(map, 0, 5)).toBe(false);
  });
});
