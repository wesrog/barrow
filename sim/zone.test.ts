import { describe, expect, test } from "bun:test";
import { player, soloGame } from "./test-helpers";
import { ensureFloor, stepSolo, travel } from "./tick";
import { floorZone, getZone, zoneDepth } from "./state";
import { cryptZone } from "./zone";

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
  test("the crypt zone has a boss and all four monster types", () => {
    const state = soloGame(1);
    const types = new Set([...getZone(state, "floor:1").monsters.values()].map((m) => m.typeId));
    expect(types.has("barrow_lord")).toBe(true);
    expect(types.has("shambler")).toBe(true);
    expect(types.has("skitter")).toBe(true);
    expect(types.has("gravespit")).toBe(true);
    expect(types.has("tomb_bloat")).toBe(true);
  });
});

describe("new game reset", () => {
  test("respawns the floors, revives the player, keeps the character", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    const populated = getZone(state, "floor:1").monsters.size;
    // Progress a character: kill everything cheaply, get hurt, die.
    for (const m of getZone(state, "floor:1").monsters.values()) m.life = 0;
    stepSolo(state, {});
    const xpAfterKills = player(state).xp;
    expect(xpAfterKills).toBeGreaterThan(0);
    player(state).life = 0;
    stepSolo(state, {});
    // Death resolves to an immediate camp respawn — dead is never persistent.
    expect(player(state).dead).toBe(false);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).life).toBe(player(state).maxLife);

    stepSolo(state, { newGame: true });
    expect(player(state).dead).toBe(false);
    expect(player(state).life).toBe(player(state).maxLife);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).pos).toEqual(getZone(state, "surface").map.spawn);
    expect(player(state).xp).toBe(xpAfterKills); // character persists
    const fresh = getZone(state, "floor:1");
    expect(fresh.monsters.size).toBe(populated); // floor repopulated
    expect(fresh.groundItems.size).toBe(0);
    expect(fresh.corpses).toHaveLength(0);
  });

  test("a reset mid-run also clears the field and forgets deeper floors", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    const populated = getZone(state, "floor:1").monsters.size;
    ensureFloor(state, 4);
    stepSolo(state, {});
    stepSolo(state, { newGame: true });
    expect([...state.zones.keys()]).toEqual(["surface", "floor:1"]);
    expect(getZone(state, "floor:1").monsters.size).toBe(populated);
    expect(player(state).dead).toBe(false);
  });
});

describe("zones", () => {
  test("createGame builds the surface and floor:1; player starts on camp ground", () => {
    const g = soloGame(1);
    expect([...g.zones.keys()]).toEqual(["surface", "floor:1"]);
    expect(player(g).zoneId).toBe("surface");
    expect(getZone(g, "floor:1").monsters.size).toBeGreaterThan(0);
  });

  test("ensureFloor generates lazily, deterministically, and only once", () => {
    const g = soloGame(7);
    expect(g.zones.has("floor:2")).toBe(false);
    const z = ensureFloor(g, 2);
    expect(ensureFloor(g, 2)).toBe(z); // same instance, not regenerated
    const h = soloGame(7);
    stepSolo(h, {}); // an unrelated tick must not affect gen determinism given same call order
    expect([...ensureFloor(h, 2).monsters.values()].map((m) => m.pos))
      .toEqual([...z.monsters.values()].map((m) => m.pos));
  });

  test("deeper floors scale monsters", () => {
    const g = soloGame(3);
    const f1 = [...getZone(g, "floor:1").monsters.values()].find((m) => m.typeId === "shambler")!;
    const f3 = [...ensureFloor(g, 3).monsters.values()].find((m) => m.typeId === "shambler")!;
    expect(f3.maxLife).toBeGreaterThan(f1.maxLife);
  });

  test("standing at the barrow mouth travels to floor:1; stairs go one deeper", () => {
    const g = soloGame(1);
    const mouth = getZone(g, "surface").map.markers.find((m) => m.ch === ">")!;
    player(g).pos = { x: mouth.x, y: mouth.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("floor:1");
    expect(g.events.some((e) => e.type === "traveled" && e.to === "floor:1")).toBe(true);
    const stairs = getZone(g, "floor:1").map.markers.find((m) => m.ch === ">")!;
    player(g).pos = { x: stairs.x, y: stairs.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("floor:2");
  });

  test("the crypt's stairs up climb one floor toward daylight", () => {
    const g = soloGame(1);
    travel(g, player(g), "floor:2");
    const up = getZone(g, "floor:2").map.markers.find((m) => m.ch === "<")!;
    expect(up).toBeDefined();
    player(g).pos = { x: up.x, y: up.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("floor:1");
    // Lands beside floor 1's down-stairs — near them, but not on the trigger.
    const down = getZone(g, "floor:1").map.markers.find((m) => m.ch === ">")!;
    const d = Math.hypot(player(g).pos.x - down.x, player(g).pos.y - down.y);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThanOrEqual(1.5);
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("floor:1"); // standing beside stairs stays put
  });

  test("floor 1's stairs up surface beside the barrow mouth", () => {
    const g = soloGame(1);
    travel(g, player(g), "floor:1");
    const up = getZone(g, "floor:1").map.markers.find((m) => m.ch === "<")!;
    player(g).pos = { x: up.x, y: up.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("surface");
    const mouth = getZone(g, "surface").map.markers.find((m) => m.ch === ">")!;
    const d = Math.hypot(player(g).pos.x - mouth.x, player(g).pos.y - mouth.y);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThanOrEqual(1.5);
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("surface"); // beside the mouth, not back in it
  });

  test("floors persist: a cleared monster stays dead after leaving and returning", () => {
    const g = soloGame(1);
    travel(g, player(g), "floor:1");
    const first = [...getZone(g, "floor:1").monsters.keys()][0]!;
    getZone(g, "floor:1").monsters.delete(first);
    const count = getZone(g, "floor:1").monsters.size;
    travel(g, player(g), "surface");
    travel(g, player(g), "floor:1");
    expect(getZone(g, "floor:1").monsters.size).toBe(count);
  });

  test("empty zones are frozen: monsters there do not act", () => {
    const g = soloGame(1);
    expect(player(g).zoneId).toBe("surface");
    const before = [...getZone(g, "floor:1").monsters.values()].map((m) => ({ ...m.pos }));
    for (let i = 0; i < 200; i++) stepSolo(g, {});
    const after = [...getZone(g, "floor:1").monsters.values()].map((m) => ({ ...m.pos }));
    expect(after).toEqual(before);
  });

  test("zoneDepth", () => {
    expect(zoneDepth("surface")).toBe(1);
    expect(zoneDepth(floorZone(4))).toBe(4);
  });
});
