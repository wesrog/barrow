import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { cryptZone } from "./zone";

const markedMap = () =>
  mapFromStrings([
    "#########",
    "#@..z..s#",
    "#..r.e..#",
    "#...B...#",
    "#########",
  ]);

describe("crypt reachability", () => {
  test("every floor cell and every marker can be walked to from the spawn", () => {
    const map = cryptZone();
    const seen = new Set<number>();
    const start = { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
    const queue = [start];
    seen.add(start.y * map.width + start.x);
    while (queue.length > 0) {
      const { x, y } = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const key = ny * map.width + nx;
        if (!seen.has(key) && nx >= 0 && ny >= 0 && nx < map.width && ny < map.height) {
          if (map.cells[key] === 1) {
            seen.add(key);
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.cells[y * map.width + x] === 1) {
          expect(seen.has(y * map.width + x)).toBe(true);
        }
      }
    }
    for (const marker of map.markers) {
      expect(seen.has(Math.floor(marker.y) * map.width + Math.floor(marker.x))).toBe(true);
    }
  });
});

describe("marker spawns", () => {
  test("createGame populates monsters from map markers", () => {
    const state = createGame(1, markedMap());
    const types = [...state.monsters.values()].map((m) => m.typeId).sort();
    expect(types).toEqual(["barrow_lord", "gravespit", "shambler", "skitter", "tomb_bloat"]);
  });

  test("the crypt zone has a boss and all four monster types", () => {
    const state = createGame(1, cryptZone());
    const types = new Set([...state.monsters.values()].map((m) => m.typeId));
    expect(types.has("barrow_lord")).toBe(true);
    expect(types.has("shambler")).toBe(true);
    expect(types.has("skitter")).toBe(true);
    expect(types.has("gravespit")).toBe(true);
    expect(types.has("tomb_bloat")).toBe(true);
  });
});

describe("new game reset", () => {
  test("respawns the zone, revives the player, keeps the character", () => {
    const state = createGame(1, markedMap());
    // Progress a character: kill everything cheaply, get hurt, die.
    for (const m of state.monsters.values()) m.life = 0;
    step(state, {});
    const xpAfterKills = state.player.xp;
    expect(xpAfterKills).toBeGreaterThan(0);
    state.player.life = 0;
    step(state, {});
    expect(state.player.dead).toBe(true);

    step(state, { newGame: true });
    expect(state.player.dead).toBe(false);
    expect(state.player.life).toBe(state.player.maxLife);
    expect(state.player.pos).toEqual(state.map.spawn);
    expect(state.player.xp).toBe(xpAfterKills); // character persists
    expect(state.monsters.size).toBe(5); // zone repopulated
    expect(state.groundItems.size).toBe(0);
    expect(state.corpses).toHaveLength(0);
  });

  test("a reset mid-run also clears the field", () => {
    const state = createGame(1, markedMap());
    step(state, {});
    step(state, { newGame: true });
    expect(state.monsters.size).toBe(5);
    expect(state.player.dead).toBe(false);
  });
});
