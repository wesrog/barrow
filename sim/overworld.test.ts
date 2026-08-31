import { describe, expect, test } from "bun:test";
import { player, soloGame } from "./test-helpers";
import { ensureOverworld, stepSolo, travel } from "./tick";
import { getZone, zoneDepth } from "./state";
import { createRng } from "./rng";
import { overworldZone, zoneTitle } from "./zone";
import { inCamp } from "./map";
import type { ZoneMap } from "./map";

function reachableFrom(map: ZoneMap, sx: number, sy: number): Set<number> {
  const seen = new Set<number>([sy * map.width + sx]);
  const queue = [{ x: sx, y: sy }];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = ny * map.width + nx;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (seen.has(key) || map.cells[key] !== 1) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

describe("overworld map", () => {
  test("same seed generates the same moors", () => {
    const a = overworldZone(createRng(11));
    const b = overworldZone(createRng(11));
    expect([...a.cells]).toEqual([...b.cells]);
    expect(a.markers).toEqual(b.markers);
  });

  test("every floor cell and every marker is reachable from the spawn", () => {
    const map = overworldZone(createRng(3));
    const seen = reachableFrom(map, Math.floor(map.spawn.x), Math.floor(map.spawn.y));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.cells[y * map.width + x] === 1) expect(seen.has(y * map.width + x)).toBe(true);
      }
    }
    for (const m of map.markers) {
      expect(seen.has(Math.floor(m.y) * map.width + Math.floor(m.x))).toBe(true);
    }
  });

  test("the camp is part of the moors: spawn, vendor, healer, and campfire inside it", () => {
    const map = overworldZone(createRng(9));
    expect(map.camp).toBeDefined();
    expect(inCamp(map, map.spawn)).toBe(true);
    for (const ch of ["V", "H", "F"]) {
      const m = map.markers.find((mk) => mk.ch === ch)!;
      expect(m).toBeDefined();
      expect(inCamp(map, m)).toBe(true);
    }
  });

  test("no teleport gates remain — walking out is the only way", () => {
    const map = overworldZone(createRng(9));
    expect(map.markers.some((m) => m.ch === "C" || m.ch === "O")).toBe(false);
  });

  test("carries a barrow mouth outside camp and a wilderness worth of monsters", () => {
    const map = overworldZone(createRng(9));
    const mouths = map.markers.filter((m) => m.ch === ">");
    expect(mouths).toHaveLength(1);
    expect(inCamp(map, mouths[0]!)).toBe(false);
    const packs = map.markers.filter((m) => "zsre".includes(m.ch));
    expect(packs.length).toBeGreaterThanOrEqual(30);
    // Safe ground stays safe, and the moor just outside the palisade stays clear too.
    for (const m of packs) {
      expect(inCamp(map, m)).toBe(false);
      expect(Math.hypot(m.x - map.spawn.x, m.y - map.spawn.y)).toBeGreaterThan(8);
    }
  });
});

describe("overworld travel", () => {
  test("players start on the moors, inside the camp", () => {
    const g = soloGame(1);
    expect(player(g).zoneId).toBe("overworld");
    expect(inCamp(getZone(g, "overworld").map, player(g).pos)).toBe(true);
  });

  test("the barrow mouth in the moors descends to floor 1", () => {
    const g = soloGame(1);
    const mouth = getZone(g, "overworld").map.markers.find((m) => m.ch === ">")!;
    player(g).pos = { x: mouth.x, y: mouth.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("floor:1");
  });

  test("no travel pad remains — the barrow mouth is the only way down", () => {
    const g = soloGame(1);
    expect(getZone(g, "overworld").map.markers.some((m) => m.ch === "P")).toBe(false);
  });
});

describe("overworld population", () => {
  test("monsters roam the moors, tougher the farther from the camp", () => {
    const g = soloGame(2);
    const zone = ensureOverworld(g);
    expect(zone.monsters.size).toBeGreaterThanOrEqual(30);
    const spawn = zone.map.spawn;
    const byDist = [...zone.monsters.values()].sort(
      (a, b) =>
        Math.hypot(a.pos.x - spawn.x, a.pos.y - spawn.y) -
        Math.hypot(b.pos.x - spawn.x, b.pos.y - spawn.y),
    );
    const near = byDist[0]!;
    const far = [...byDist].reverse().find((m) => m.typeId === near.typeId);
    if (far && far !== near) expect(far.maxLife).toBeGreaterThanOrEqual(near.maxLife);
  });

  test("a new game regenerates the moors", () => {
    const g = soloGame(1);
    const before = getZone(g, "overworld");
    const populated = before.monsters.size;
    stepSolo(g, { newGame: true });
    const after = getZone(g, "overworld");
    expect(after).not.toBe(before);
    expect(after.monsters.size).toBe(populated);
    expect(player(g).zoneId).toBe("overworld");
  });

  test("zone identity", () => {
    expect(zoneDepth("overworld")).toBe(1);
    expect(zoneTitle("overworld")).toBe("The Wither Moors");
    expect(zoneTitle("floor:1")).toBe("The Barrow Crypt");
  });
});

describe("camp safety", () => {
  test("monsters ignore a player standing on camp ground", () => {
    const g = soloGame(1);
    const zone = getZone(g, "overworld");
    const p = player(g);
    // A monster right at the palisade gap, player just inside.
    const c = zone.map.camp!;
    p.pos = { x: c.x1 - 0.5, y: p.pos.y };
    const m = [...zone.monsters.values()][0]!;
    m.pos = { x: c.x1 + 1.5, y: p.pos.y };
    m.home = { ...m.pos };
    for (let i = 0; i < 50; i++) stepSolo(g, {});
    expect(m.ai).toBe("idle");
    expect(inCamp(zone.map, m.pos)).toBe(false);
    expect(p.life).toBe(p.maxLife);
  });

  test("monsters keep wandering while everyone stands in camp", () => {
    const g = soloGame(1);
    const zone = getZone(g, "overworld");
    const p = player(g);
    expect(inCamp(zone.map, p.pos)).toBe(true);
    const m = [...zone.monsters.values()][0]!;
    const home = { ...m.pos };
    let moved = false;
    for (let i = 0; i < 500; i++) {
      stepSolo(g, {});
      expect(m.ai).toBe("idle");
      if (Math.hypot(m.pos.x - home.x, m.pos.y - home.y) > 0.3) moved = true;
    }
    expect(moved).toBe(true);
  });
});
