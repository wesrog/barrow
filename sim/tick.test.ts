import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { step, TICK_RATE } from "./tick";
import { createGameOn } from "./test-helpers";

const openMap = () =>
  mapFromStrings([
    "##########",
    "#@.......#",
    "#........#",
    "#........#",
    "##########",
  ]);

describe("new game", () => {
  test("starts with a rusted blade equipped and stats derived from it", () => {
    const game = createGameOn(1, openMap());
    expect(game.player.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(game.player.dmgMin).toBe(1);
    expect(game.player.dmgMax).toBe(6);
  });
});

describe("player movement", () => {
  test("game starts with the player at the map spawn", () => {
    const game = createGameOn(1, openMap());
    expect(game.tick).toBe(0);
    expect(game.player.pos).toEqual({ x: 1.5, y: 1.5 });
  });

  test("clicking a destination walks the player there and stops", () => {
    const game = createGameOn(1, openMap());
    step(game, { moveTo: { x: 7.5, y: 3.5 } });
    for (let i = 0; i < 200; i++) step(game, {});
    expect(game.player.pos.x).toBeCloseTo(7.5, 1);
    expect(game.player.pos.y).toBeCloseTo(3.5, 1);
    const before = { ...game.player.pos };
    step(game, {});
    expect(game.player.pos).toEqual(before);
  });

  test("moves at walk speed, not teleporting", () => {
    const game = createGameOn(1, openMap());
    step(game, { moveTo: { x: 7.5, y: 1.5 } });
    const d0 = Math.abs(7.5 - game.player.pos.x);
    step(game, {});
    const d1 = Math.abs(7.5 - game.player.pos.x);
    expect(d1).toBeLessThan(d0);
    expect(d0 - d1).toBeLessThan(0.5); // sane per-tick distance
  });

  test("walks around walls, never through them", () => {
    const game = createGameOn(1, mapFromStrings([
      "#######",
      "#@.#..#",
      "#..#..#",
      "#.....#",
      "#######",
    ]));
    step(game, { moveTo: { x: 5.5, y: 1.5 } });
    for (let i = 0; i < 300; i++) {
      step(game, {});
      // Never inside the wall column at x=3 rows y=1..2
      const cx = Math.floor(game.player.pos.x);
      const cy = Math.floor(game.player.pos.y);
      expect(cx === 3 && (cy === 1 || cy === 2)).toBe(false);
    }
    expect(game.player.pos.x).toBeCloseTo(5.5, 1);
    expect(game.player.pos.y).toBeCloseTo(1.5, 1);
  });

  test("clicking an unwalkable cell is ignored", () => {
    const game = createGameOn(1, openMap());
    step(game, { moveTo: { x: 0.5, y: 0.5 } });
    for (let i = 0; i < 50; i++) step(game, {});
    expect(game.player.pos).toEqual({ x: 1.5, y: 1.5 });
  });
});

describe("determinism", () => {
  test("same seed and inputs produce identical state", () => {
    const run = () => {
      const game = createGameOn(42, openMap());
      step(game, { moveTo: { x: 7.5, y: 3.5 } });
      for (let i = 0; i < 100; i++) step(game, {});
      return JSON.stringify({ tick: game.tick, player: game.player });
    };
    expect(run()).toBe(run());
  });

  test("tick counter advances once per step at 25 Hz", () => {
    expect(TICK_RATE).toBe(25);
    const game = createGameOn(1, openMap());
    step(game, {});
    step(game, {});
    expect(game.tick).toBe(2);
  });
});
