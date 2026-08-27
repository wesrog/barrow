import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, joinPlayer, step, stepSolo, travel, TICK_RATE } from "./tick";
import { createGameOn, player } from "./test-helpers";
import type { Frame, GameState } from "./state";

/** JSON.stringify replacer: Maps and typed arrays become plain arrays. */
const mapReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Map
    ? [...value.entries()]
    : value instanceof Uint8Array
      ? [...value]
      : typeof value === "function"
        ? undefined
        : value;

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
    expect(player(game).equipment.weapon?.baseId).toBe("rusted_blade");
    expect(player(game).dmgMin).toBe(1);
    expect(player(game).dmgMax).toBe(6);
  });
});

describe("player movement", () => {
  test("game starts with the player at the map spawn", () => {
    const game = createGameOn(1, openMap());
    expect(game.tick).toBe(0);
    expect(player(game).pos).toEqual({ x: 1.5, y: 1.5 });
  });

  test("clicking a destination walks the player there and stops", () => {
    const game = createGameOn(1, openMap());
    stepSolo(game, { moveTo: { x: 7.5, y: 3.5 } });
    for (let i = 0; i < 200; i++) stepSolo(game, {});
    expect(player(game).pos.x).toBeCloseTo(7.5, 1);
    expect(player(game).pos.y).toBeCloseTo(3.5, 1);
    const before = { ...player(game).pos };
    stepSolo(game, {});
    expect(player(game).pos).toEqual(before);
  });

  test("moves at walk speed, not teleporting", () => {
    const game = createGameOn(1, openMap());
    stepSolo(game, { moveTo: { x: 7.5, y: 1.5 } });
    const d0 = Math.abs(7.5 - player(game).pos.x);
    stepSolo(game, {});
    const d1 = Math.abs(7.5 - player(game).pos.x);
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
    stepSolo(game, { moveTo: { x: 5.5, y: 1.5 } });
    for (let i = 0; i < 300; i++) {
      stepSolo(game, {});
      // Never inside the wall column at x=3 rows y=1..2
      const cx = Math.floor(player(game).pos.x);
      const cy = Math.floor(player(game).pos.y);
      expect(cx === 3 && (cy === 1 || cy === 2)).toBe(false);
    }
    expect(player(game).pos.x).toBeCloseTo(5.5, 1);
    expect(player(game).pos.y).toBeCloseTo(1.5, 1);
  });

  test("clicking an unwalkable cell is ignored", () => {
    const game = createGameOn(1, openMap());
    stepSolo(game, { moveTo: { x: 0.5, y: 0.5 } });
    for (let i = 0; i < 50; i++) stepSolo(game, {});
    expect(player(game).pos).toEqual({ x: 1.5, y: 1.5 });
  });
});

describe("determinism", () => {
  test("same seed and inputs produce identical state", () => {
    const run = () => {
      const game = createGameOn(42, openMap());
      stepSolo(game, { moveTo: { x: 7.5, y: 3.5 } });
      for (let i = 0; i < 100; i++) stepSolo(game, {});
      return JSON.stringify({ tick: game.tick, player: player(game) });
    };
    expect(run()).toBe(run());
  });

  test("two-player determinism: same seed + same frames ⇒ identical state", () => {
    const script = (g: GameState) => {
      joinPlayer(g, { id: 0 });
      joinPlayer(g, { id: 1 });
      travel(g, g.players.get(0)!, "floor:1");
      travel(g, g.players.get(1)!, "floor:1");
      for (let t = 0; t < 500; t++) {
        const inputs: Frame["inputs"] = {};
        if (t % 7 === 0) inputs[0] = { moveTo: { x: 5 + (t % 20), y: 3 } };
        if (t % 11 === 0) inputs[1] = { moveTo: { x: 30 - (t % 20), y: 15 } };
        if (t === 200) inputs[1] = { cast: { skill: "cleave" } };
        step(g, { tick: g.tick, inputs });
      }
    };
    const a = createGame(1234),
      b = createGame(1234);
    script(a);
    script(b);
    expect(JSON.stringify(a, mapReplacer)).toBe(JSON.stringify(b, mapReplacer));
  });

  test("tick counter advances once per step at 25 Hz", () => {
    expect(TICK_RATE).toBe(25);
    const game = createGameOn(1, openMap());
    stepSolo(game, {});
    stepSolo(game, {});
    expect(game.tick).toBe(2);
  });
});
