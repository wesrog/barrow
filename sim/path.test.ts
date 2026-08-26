import { describe, expect, test } from "bun:test";
import { mapFromStrings, isWalkable } from "./map";
import { findPath } from "./path";

describe("findPath", () => {
  test("finds a path across open ground ending at the goal cell", () => {
    const map = mapFromStrings([
      "@....",
      ".....",
      ".....",
    ]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 2 });
    for (const cell of path!) {
      expect(isWalkable(map, cell.x, cell.y)).toBe(true);
    }
  });

  test("routes around a wall", () => {
    const map = mapFromStrings([
      "@.#..",
      "..#..",
      ".....",
    ]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    // Must dip below the wall at column 2.
    expect(path!.some((c) => c.y === 2)).toBe(true);
    for (const cell of path!) {
      expect(isWalkable(map, cell.x, cell.y)).toBe(true);
    }
  });

  test("does not cut corners diagonally through walls", () => {
    const map = mapFromStrings([
      "@#",
      ".#",
      "..",
    ]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 1, y: 2 });
    expect(path).not.toBeNull();
    // Each step must be adjacent, and diagonal steps need both orthogonal neighbors open.
    let prev = { x: 0, y: 0 };
    for (const cell of path!) {
      const dx = cell.x - prev.x;
      const dy = cell.y - prev.y;
      expect(Math.abs(dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      if (dx !== 0 && dy !== 0) {
        expect(isWalkable(map, prev.x + dx, prev.y)).toBe(true);
        expect(isWalkable(map, prev.x, prev.y + dy)).toBe(true);
      }
      prev = cell;
    }
  });

  test("returns null when the goal is unreachable", () => {
    const map = mapFromStrings([
      "@#.",
      ".#.",
      ".#.",
    ]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 1 })).toBeNull();
  });
});
