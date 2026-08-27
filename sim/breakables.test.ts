import { describe, expect, test } from "bun:test";
import { stepSolo, travel } from "./tick";
import { mapFromStrings } from "./map";
import { getZone } from "./state";
import { createGameOn, player, playerZone, soloGame } from "./test-helpers";
import { zoneName } from "./zone";
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

describe("breakable spawning", () => {
  test("a crypt floor holds breakables, including exactly one chest", () => {
    const state = soloGame(7);
    const breakables = getZone(state, "floor:1").breakables;
    expect(breakables.size).toBeGreaterThan(0);
    const chests = [...breakables.values()].filter((b) => b.kind === "chest");
    expect(chests.length).toBe(1);
  });

  test("same seed produces the identical layout", () => {
    const a = soloGame(42);
    const b = soloGame(42);
    expect([...getZone(a, "floor:1").breakables.values()]).toEqual([
      ...getZone(b, "floor:1").breakables.values(),
    ]);
  });

  test("breakables sit on walkable cells, off the spawn and markers", () => {
    const state = soloGame(3);
    const zone = getZone(state, "floor:1");
    const map = zone.map;
    for (const b of zone.breakables.values()) {
      const cx = Math.floor(b.pos.x);
      const cy = Math.floor(b.pos.y);
      expect(map.cells[cy * map.width + cx]).toBe(1);
      expect(cx === Math.floor(map.spawn.x) && cy === Math.floor(map.spawn.y)).toBe(false);
      for (const m of map.markers) {
        expect(cx === Math.floor(m.x) && cy === Math.floor(m.y)).toBe(false);
      }
    }
  });

  test("each floor gets its own fresh breakables", () => {
    const state = soloGame(11);
    travel(state, player(state), "floor:1");
    const beforeIds = [...playerZone(state).breakables.keys()];
    travel(state, player(state), "floor:2");
    expect(playerZone(state).breakables.size).toBeGreaterThan(0);
    for (const id of playerZone(state).breakables.keys()) {
      expect(beforeIds).not.toContain(id);
    }
  });
});

describe("smashing", () => {
  test("clicking an adjacent breakable smashes it in one swing", () => {
    const state = createGameOn(5, roomMap());
    playerZone(state).breakables.clear();
    const id = state.nextId++;
    playerZone(state).breakables.set(id, { id, kind: "barrel", pos: { x: 2.5, y: 1.5 } });
    stepSolo(state, { smash: id });
    expect(playerZone(state).breakables.has(id)).toBe(false);
    expect(state.events.some((e) => e.type === "breakable_broken" && e.id === id)).toBe(true);
    expect(state.events.some((e) => e.type === "player_swing")).toBe(true);
  });

  test("a distant breakable pulls the player over before it breaks", () => {
    const state = createGameOn(5, roomMap());
    playerZone(state).breakables.clear();
    const id = state.nextId++;
    playerZone(state).breakables.set(id, { id, kind: "crate", pos: { x: 7.5, y: 3.5 } });
    stepSolo(state, { smash: id });
    expect(playerZone(state).breakables.has(id)).toBe(true); // too far to break yet
    for (let i = 0; i < 200 && playerZone(state).breakables.has(id); i++) stepSolo(state, {});
    expect(playerZone(state).breakables.has(id)).toBe(false);
  });

  test("a chest always drops an item", () => {
    const state = createGameOn(5, roomMap());
    playerZone(state).breakables.clear();
    const id = state.nextId++;
    playerZone(state).breakables.set(id, { id, kind: "chest", pos: { x: 2.5, y: 1.5 } });
    stepSolo(state, { smash: id });
    expect(playerZone(state).breakables.has(id)).toBe(false);
    expect(playerZone(state).groundItems.size).toBeGreaterThan(0);
  });

  test("moving elsewhere cancels the smash errand", () => {
    const state = createGameOn(5, roomMap());
    playerZone(state).breakables.clear();
    const id = state.nextId++;
    playerZone(state).breakables.set(id, { id, kind: "barrel", pos: { x: 7.5, y: 3.5 } });
    stepSolo(state, { smash: id });
    stepSolo(state, { moveTo: { x: 1.5, y: 3.5 } });
    for (let i = 0; i < 100; i++) stepSolo(state, {});
    expect(playerZone(state).breakables.has(id)).toBe(true);
  });
});

describe("camp trips", () => {
  test("breakables persist on the floor while the player is topside", () => {
    const state = soloGame(9);
    travel(state, player(state), "floor:1");
    const saved = [...playerZone(state).breakables.values()];
    expect(saved.length).toBeGreaterThan(0);
    travel(state, player(state), "overworld");
    // Walk onto the travel pad: back down to floor 1
    const pad = playerZone(state).map.markers.find((m) => m.ch === "P")!;
    player(state).pos = { x: pad.x, y: pad.y };
    stepSolo(state, {});
    expect([...playerZone(state).breakables.values()]).toEqual(saved);
  });
});

describe("zone names", () => {
  test("the crypt deepens through named tiers", () => {
    expect(zoneName(0)).toBe("The Camp");
    expect(zoneName(1)).toBe("The Barrow Crypt");
    expect(zoneName(2)).toBe("The Barrow Crypt");
    expect(zoneName(3)).toBe("The Sunken Halls");
    expect(zoneName(5)).toBe("The Bone Vaults");
    expect(zoneName(7)).toBe("The Wyrm's Undercroft");
    expect(zoneName(20)).toBe("The Wyrm's Undercroft");
  });
});
