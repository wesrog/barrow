import { describe, expect, test } from "bun:test";
import { mapFromStrings, isWalkable } from "./map";
import { findPath, furthestWalkable, smoothPath } from "./path";

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

describe("smoothPath", () => {
  test("open ground collapses to a straight shot", () => {
    const map = mapFromStrings([
      "@....",
      ".....",
      ".....",
    ]);
    const cells = findPath(map, { x: 0, y: 0 }, { x: 4, y: 2 })!;
    const smooth = smoothPath(map, { x: 0.5, y: 0.5 }, cells);
    expect(smooth.length).toBe(1);
    expect(smooth[0]).toEqual({ x: 4.5, y: 2.5 });
  });

  test("keeps a bend when a wall blocks the straight line", () => {
    const map = mapFromStrings([
      "@.#..",
      "..#..",
      ".....",
    ]);
    const cells = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    const smooth = smoothPath(map, { x: 0.5, y: 0.5 }, cells);
    expect(smooth.length).toBeGreaterThanOrEqual(2);
    expect(smooth[smooth.length - 1]).toEqual({ x: 4.5, y: 0.5 });
    // No leg of the smoothed path may cross the wall column x=2 above y=2
    let prev = { x: 0.5, y: 0.5 };
    for (const wp of smooth) {
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        const x = prev.x + ((wp.x - prev.x) * i) / steps;
        const y = prev.y + ((wp.y - prev.y) * i) / steps;
        expect(isWalkable(map, Math.floor(x), Math.floor(y))).toBe(true);
      }
      prev = wp;
    }
  });
});

describe("furthestWalkable", () => {
  test("a clear line reaches the target", () => {
    const map = mapFromStrings([
      "@....",
      ".....",
    ]);
    const p = furthestWalkable(map, { x: 0.5, y: 0.5 }, { x: 4.5, y: 1.5 });
    expect(p.x).toBeCloseTo(4.5);
    expect(p.y).toBeCloseTo(1.5);
  });

  test("a blocked line stops on the near side of the wall", () => {
    const map = mapFromStrings([
      "@.#..",
      "..#..",
    ]);
    const p = furthestWalkable(map, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 });
    expect(p.x).toBeLessThan(2);
    expect(p.x).toBeGreaterThan(0.5);
    expect(p.y).toBeCloseTo(0.5);
    expect(isWalkable(map, Math.floor(p.x), Math.floor(p.y))).toBe(true);
  });

  test("a wall in the adjacent cell leaves the point inside the start cell", () => {
    const map = mapFromStrings([
      "@#...",
    ]);
    const p = furthestWalkable(map, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 });
    expect(p.x).toBeGreaterThanOrEqual(0.5);
    expect(p.x).toBeLessThan(1);
    expect(p.y).toBeCloseTo(0.5);
  });
});

describe("findPath expansion cap", () => {
  const open = mapFromStrings(Array.from({ length: 20 }, () => ".".repeat(20)));

  test("a tiny budget still yields a partial path toward the goal", () => {
    const path = findPath(open, { x: 0, y: 0 }, { x: 19, y: 19 }, 6);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    const last = path![path!.length - 1]!;
    // Strictly closer to the goal than the start was.
    expect(Math.hypot(19 - last.x, 19 - last.y)).toBeLessThan(Math.hypot(19, 19));
  });

  test("unreachable goals still return null", () => {
    const walled = mapFromStrings(["...#.", "...#.", "...#."]);
    expect(findPath(walled, { x: 0, y: 0 }, { x: 4, y: 1 })).toBeNull();
  });
});
