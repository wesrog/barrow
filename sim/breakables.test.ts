import { describe, expect, test } from "bun:test";
import { createGame, descend, step } from "./tick";
import { mapFromStrings } from "./map";
import { cryptZone, zoneName } from "./zone";
import type { Breakable } from "./breakables";

/** Small open room: player in one corner, stairs far away. */
const roomMap = () =>
  mapFromStrings([
    "##########",
    "#@.......#",
    "#........#",
    "#........#",
    "#......>.#",
    "##########",
  ]);

const firstBreakable = (state: ReturnType<typeof createGame>): Breakable =>
  [...state.breakables.values()][0]!;

describe("breakable spawning", () => {
  test("a crypt floor holds breakables, including exactly one chest", () => {
    const state = createGame(7, cryptZone());
    expect(state.breakables.size).toBeGreaterThan(0);
    const chests = [...state.breakables.values()].filter((b) => b.kind === "chest");
    expect(chests.length).toBe(1);
  });

  test("same seed produces the identical layout", () => {
    const a = createGame(42, cryptZone());
    const b = createGame(42, cryptZone());
    expect([...a.breakables.values()]).toEqual([...b.breakables.values()]);
  });

  test("breakables sit on walkable cells, off the spawn and markers", () => {
    const state = createGame(3, cryptZone());
    const map = state.map;
    for (const b of state.breakables.values()) {
      const cx = Math.floor(b.pos.x);
      const cy = Math.floor(b.pos.y);
      expect(map.cells[cy * map.width + cx]).toBe(1);
      expect(cx === Math.floor(map.spawn.x) && cy === Math.floor(map.spawn.y)).toBe(false);
      for (const m of map.markers) {
        expect(cx === Math.floor(m.x) && cy === Math.floor(m.y)).toBe(false);
      }
    }
  });

  test("descending clears the floor's breakables and spawns fresh ones", () => {
    const state = createGame(11, cryptZone());
    const beforeIds = [...state.breakables.keys()];
    descend(state);
    expect(state.breakables.size).toBeGreaterThan(0);
    for (const id of state.breakables.keys()) {
      expect(beforeIds).not.toContain(id);
    }
  });
});

describe("smashing", () => {
  test("clicking an adjacent breakable smashes it in one swing", () => {
    const state = createGame(5, roomMap());
    state.breakables.clear();
    const id = state.nextId++;
    state.breakables.set(id, { id, kind: "barrel", pos: { x: 2.5, y: 1.5 } });
    step(state, { smash: id });
    expect(state.breakables.has(id)).toBe(false);
    expect(state.events.some((e) => e.type === "breakable_broken" && e.id === id)).toBe(true);
    expect(state.events.some((e) => e.type === "player_swing")).toBe(true);
  });

  test("a distant breakable pulls the player over before it breaks", () => {
    const state = createGame(5, roomMap());
    state.breakables.clear();
    const id = state.nextId++;
    state.breakables.set(id, { id, kind: "crate", pos: { x: 7.5, y: 3.5 } });
    step(state, { smash: id });
    expect(state.breakables.has(id)).toBe(true); // too far to break yet
    for (let i = 0; i < 200 && state.breakables.has(id); i++) step(state, {});
    expect(state.breakables.has(id)).toBe(false);
  });

  test("a chest always drops an item", () => {
    const state = createGame(5, roomMap());
    state.breakables.clear();
    const id = state.nextId++;
    state.breakables.set(id, { id, kind: "chest", pos: { x: 2.5, y: 1.5 } });
    step(state, { smash: id });
    expect(state.breakables.has(id)).toBe(false);
    expect(state.groundItems.size).toBeGreaterThan(0);
  });

  test("moving elsewhere cancels the smash errand", () => {
    const state = createGame(5, roomMap());
    state.breakables.clear();
    const id = state.nextId++;
    state.breakables.set(id, { id, kind: "barrel", pos: { x: 7.5, y: 3.5 } });
    step(state, { smash: id });
    step(state, { moveTo: { x: 1.5, y: 3.5 } });
    for (let i = 0; i < 100; i++) step(state, {});
    expect(state.breakables.has(id)).toBe(true);
  });
});

describe("town portal", () => {
  test("breakables freeze with the dungeon and thaw on return", () => {
    const state = createGame(9, cryptZone());
    const saved = [...state.breakables.values()];
    expect(saved.length).toBeGreaterThan(0);
    step(state, { townPortal: true });
    expect(state.breakables.size).toBe(0); // no barrels to smash topside
    // Walk onto the return pad
    const pad = state.map.markers.find((m) => m.ch === "P")!;
    state.player.pos = { x: pad.x, y: pad.y };
    step(state, {});
    expect([...state.breakables.values()]).toEqual(saved);
  });
});

describe("zone names", () => {
  test("the crypt deepens through named tiers", () => {
    expect(zoneName(1)).toBe("The Barrow Crypt");
    expect(zoneName(2)).toBe("The Barrow Crypt");
    expect(zoneName(3)).toBe("The Sunken Halls");
    expect(zoneName(5)).toBe("The Bone Vaults");
    expect(zoneName(7)).toBe("The Wyrm's Undercroft");
    expect(zoneName(20)).toBe("The Wyrm's Undercroft");
  });
});
