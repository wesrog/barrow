import { expect, test } from "bun:test";
import { createGame, joinPlayer, step, stepSolo, travel } from "./tick";
import { getZone } from "./state";
import { soloGame } from "./test-helpers";

test("casting in a crypt creates a linked pair; camp end lands near camp spawn", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:2");
  stepSolo(g, { townPortal: true });
  const here = [...getZone(g, "floor:2").portals.values()];
  const camp = [...getZone(g, "camp").portals.values()];
  expect(here).toHaveLength(1);
  expect(camp).toHaveLength(1);
  expect(here[0]!.link).toEqual({ zone: "camp", pos: camp[0]!.pos });
  expect(camp[0]!.link).toEqual({ zone: "floor:2", pos: here[0]!.pos });
});

test("recasting replaces the old pair; casting in camp does nothing", () => {
  const g = soloGame(1);
  const p = g.players.get(0)!;
  travel(g, p, "floor:1");
  stepSolo(g, { townPortal: true });
  travel(g, p, "floor:2");
  stepSolo(g, { townPortal: true });
  expect(getZone(g, "floor:1").portals.size).toBe(0);
  expect(getZone(g, "floor:2").portals.size).toBe(1);
  expect(getZone(g, "camp").portals.size).toBe(1);
  travel(g, p, "camp");
  const before = getZone(g, "camp").portals.size;
  stepSolo(g, { townPortal: true });
  expect(getZone(g, "camp").portals.size).toBe(before);
});

test("any player can ride any portal, both directions", () => {
  const g = createGame(5);
  joinPlayer(g, { id: 0 });
  joinPlayer(g, { id: 1 });
  const p0 = g.players.get(0)!,
    p1 = g.players.get(1)!;
  travel(g, p0, "floor:1");
  stepSolo(g, { townPortal: true }); // p0 casts on floor 1
  const campEnd = [...getZone(g, "camp").portals.values()][0]!;
  p1.pos = { ...campEnd.pos };
  step(g, { tick: g.tick, inputs: { 1: { usePortal: campEnd.id } } });
  // walk-to resolves within a few ticks when already standing on it
  for (let i = 0; i < 5 && p1.zoneId === "camp"; i++) step(g, { tick: g.tick, inputs: {} });
  expect(p1.zoneId).toBe("floor:1");
});
