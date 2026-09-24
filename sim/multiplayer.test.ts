import { isWalkable } from "./map";
import { expect, test } from "bun:test";
import { createGame, joinPlayer, step, travel } from "./tick";
import { getZone } from "./state";

const join2 = () => {
  const g = createGame(42);
  joinPlayer(g, { id: 0, start: "surface" });
  joinPlayer(g, { id: 1, start: "surface" });
  return g;
};

test("two players join on camp ground with starter blades", () => {
  const g = join2();
  expect([...g.players.keys()]).toEqual([0, 1]);
  for (const p of g.players.values()) {
    expect(p.zoneId).toBe("surface");
    expect(p.equipment.weapon?.baseId).toBe("rusted_blade");
  }
});

test("joins and leaves ride the frame stream", () => {
  const g = createGame(9);
  step(g, { tick: 0, inputs: {}, joins: [{ id: 0 }] });
  expect(g.players.size).toBe(1);
  expect(g.events.some((e) => e.type === "player_joined" && e.playerId === 0)).toBe(true);
  step(g, { tick: 1, inputs: {}, leaves: [0] });
  expect(g.players.size).toBe(0);
});

test("players move independently in different zones", () => {
  const g = join2();
  const p0 = g.players.get(0)!,
    p1 = g.players.get(1)!;
  travel(g, p0, "dungeon:barrow:1");
  const before1 = { ...p1.pos };
  step(g, { tick: g.tick, inputs: { 0: { moveTo: { x: p0.pos.x + 2, y: p0.pos.y } } } });
  expect(p0.path.length).toBeGreaterThan(0);
  expect(p1.pos).toEqual(before1);
});

test("monsters target the nearest living player in their zone", () => {
  const g = join2();
  const p0 = g.players.get(0)!,
    p1 = g.players.get(1)!;
  travel(g, p0, "dungeon:barrow:1");
  travel(g, p1, "dungeon:barrow:1");
  const zone = getZone(g, "dungeon:barrow:1");
  // A monster with open floor to its east, so both players stand on walkable cells.
  const m = [...zone.monsters.values()].find(
    (c) => isWalkable(zone.map, Math.floor(c.pos.x + 1.5), Math.floor(c.pos.y)) && isWalkable(zone.map, Math.floor(c.pos.x + 5), Math.floor(c.pos.y)),
  )!;
  p0.pos = { x: m.pos.x + 1.5, y: m.pos.y }; // p0 closest
  p1.pos = { x: m.pos.x + 5, y: m.pos.y };
  // Stop at the first hit: a hall crowd can kill and respawn p0 at full life
  // well inside 300 ticks.
  const life0 = p0.life;
  let hurt = false;
  for (let i = 0; i < 300 && !hurt; i++) {
    step(g, { tick: g.tick, inputs: {} });
    hurt = p0.life < life0;
  }
  expect(hurt).toBe(true);
});

test("contested pickup: lower id wins deterministically", () => {
  const g = join2();
  const p0 = g.players.get(0)!,
    p1 = g.players.get(1)!;
  travel(g, p0, "dungeon:barrow:1");
  travel(g, p1, "dungeon:barrow:1");
  const zone = getZone(g, "dungeon:barrow:1");
  const id = g.nextId++;
  zone.groundItems.set(id, {
    id,
    item: {
      baseId: "rusted_blade",
      rarity: "normal",
      name: "Rusted Blade",
      affixIds: [],
      mods: [],
      ilvl: 1,
    },
    pos: { ...p0.pos },
  });
  p1.pos = { ...p0.pos };
  step(g, { tick: g.tick, inputs: { 0: { pickup: id }, 1: { pickup: id } } });
  expect(zone.groundItems.has(id)).toBe(false);
  expect(g.players.get(0)!.inventory.entries.some((e) => e.id === id)).toBe(true);
  expect(g.players.get(1)!.inventory.entries.some((e) => e.id === id)).toBe(false);
});
