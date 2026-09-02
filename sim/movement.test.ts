import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { applyMoveInput } from "./systems/movement";
import { createGameOn, player } from "./test-helpers";

describe("applyMoveInput detour cap", () => {
  test("a click across a long barrier walks to the barrier, not all the way around", () => {
    // Wall column at x=8 spans rows 0-8; the only way around is a ~23-cell
    // loop through row 9, versus a 5-cell direct line.
    const map = mapFromStrings([
      "......@.#....",
      "........#....",
      "........#....",
      "........#....",
      "........#....",
      "........#....",
      "........#....",
      "........#....",
      "........#....",
      ".............",
    ]);
    const state = createGameOn(1, map);
    const p = player(state);
    applyMoveInput(state, p, { moveTo: { x: 11.5, y: 0.5 } });
    expect(p.path.length).toBeGreaterThan(0);
    const last = p.path[p.path.length - 1]!;
    // Stops on the near side of the wall, on the straight line to the click.
    expect(last.x).toBeLessThan(8);
    expect(last.x).toBeGreaterThan(6.5);
    expect(Math.abs(last.y - 0.5)).toBeLessThan(0.01);
    // No waypoint wanders off toward the loop through row 9.
    for (const wp of p.path) expect(wp.y).toBeLessThan(2);
  });

  test("a short detour around a small wall is still taken", () => {
    const map = mapFromStrings([
      "@.#..",
      "..#..",
      ".....",
    ]);
    const state = createGameOn(1, map);
    const p = player(state);
    applyMoveInput(state, p, { moveTo: { x: 4.5, y: 0.5 } });
    expect(p.path.length).toBeGreaterThan(0);
    expect(p.path[p.path.length - 1]).toEqual({ x: 4.5, y: 0.5 });
  });

  test("open ground still walks straight to the click", () => {
    const map = mapFromStrings([
      "@....",
      ".....",
      ".....",
    ]);
    const state = createGameOn(1, map);
    const p = player(state);
    applyMoveInput(state, p, { moveTo: { x: 4.5, y: 2.5 } });
    expect(p.path).toEqual([{ x: 4.5, y: 2.5 }]);
  });
});
