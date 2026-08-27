import { expect, test } from "bun:test";
import { createGame, joinPlayer, step, travel } from "../sim/tick";
import { deserializeGame, serializeGame } from "./snapshot";

test("snapshot round-trip: the restored game steps identically to the original", () => {
  const g = createGame(777);
  joinPlayer(g, { id: 0 });
  joinPlayer(g, { id: 1 });
  travel(g, g.players.get(0)!, "floor:1");
  for (let t = 0; t < 120; t++) {
    step(g, { tick: g.tick, inputs: t % 5 === 0 ? { 0: { moveTo: { x: 4 + (t % 10), y: 4 } } } : {} });
  }
  const copy = deserializeGame(serializeGame(g));
  expect(serializeGame(copy)).toBe(serializeGame(g));
  for (let t = 0; t < 120; t++) {
    const f = { tick: g.tick, inputs: t % 3 === 0 ? { 1: { moveTo: { x: 8, y: 2 } } } : {} };
    step(g, structuredClone(f));
    step(copy, structuredClone(f));
  }
  expect(serializeGame(copy)).toBe(serializeGame(g));
});

test("deserialize rejects garbage", () => {
  expect(() => deserializeGame("{}")).toThrow();
});
