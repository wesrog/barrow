import { expect, test } from "bun:test";
import { serializeCharacter } from "../sim/save";
import { createGame, joinPlayer, step, travel } from "../sim/tick";
import { worldWaypointPos } from "../sim/surface";
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

test("the snapshot carries the world seed and checkpoint fields", () => {
  const g = createGame(1234);
  joinPlayer(g, { id: 0 });
  const copy = deserializeGame(serializeGame(g));
  expect(copy.seed).toBe(1234);
  expect(copy.players.get(0)!.waypoints).toEqual(["overworld"]);
  expect(copy.players.get(0)!.checkpoint).toBe("overworld");
});

test("a joiner restored at a far-off outpost replays identically on every peer", () => {
  // A joiner whose checkpoint is the redfen wakes on that outpost's pad, half a
  // world away from camp — which must land the same way on the host and on a
  // snapshot-synced peer.
  const donor = createGame(5);
  joinPlayer(donor, { id: 0 });
  donor.players.get(0)!.waypoints = ["overworld", "redfen"];
  donor.players.get(0)!.checkpoint = "redfen";
  const raw = serializeCharacter(donor, 0);

  const host = createGame(99);
  joinPlayer(host, { id: 0 });
  const peer = deserializeGame(serializeGame(host));
  const joinFrame = { tick: host.tick, inputs: {}, joins: [{ id: 1, character: raw }] };
  step(host, structuredClone(joinFrame));
  step(peer, structuredClone(joinFrame));
  expect(host.players.get(1)!.zoneId).toBe("surface");
  expect(host.players.get(1)!.pos).toEqual(worldWaypointPos("redfen"));
  for (let t = 0; t < 60; t++) {
    const f = { tick: host.tick, inputs: {} };
    step(host, structuredClone(f));
    step(peer, structuredClone(f));
  }
  expect(serializeGame(peer)).toBe(serializeGame(host));
});
