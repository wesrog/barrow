import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";
import { bandFor, cryptFloor } from "./crypt";
import { MARKER_TYPES } from "./zone";
import type { ZoneMap } from "./map";
import { getZone } from "./state";
import { ensureFloor } from "./world";
import { soloGame } from "./test-helpers";

/** Cells reachable on foot from the spawn. */
function reachableFrom(map: ZoneMap): Set<number> {
  const seen = new Set<number>();
  const start = { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
  seen.add(start.y * map.width + start.x);
  const queue = [start];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const key = ny * map.width + nx;
      if (seen.has(key) || map.cells[key] !== 1) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

describe("cryptFloor generation", () => {
  test("same rng seed and depth produce the identical floor", () => {
    for (const depth of [1, 3, 5, 8]) {
      const a = cryptFloor(createRng(42), depth);
      const b = cryptFloor(createRng(42), depth);
      expect([...a.cells]).toEqual([...b.cells]);
      expect(a.markers).toEqual(b.markers);
      expect(a.spawn).toEqual(b.spawn);
    }
  });

  test("different seeds grow different floors", () => {
    const a = cryptFloor(createRng(1), 1);
    const b = cryptFloor(createRng(2), 1);
    expect([...a.cells]).not.toEqual([...b.cells]);
  });

  test("every marker, the stairs down, and the way up are reachable from spawn", () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const depth of [1, 2, 3, 4, 5, 6, 7, 9]) {
        const map = cryptFloor(createRng(seed), depth);
        const seen = reachableFrom(map);
        expect(map.markers.some((m) => m.ch === ">")).toBe(true);
        expect(map.markers.some((m) => m.ch === "<")).toBe(true);
        for (const m of map.markers) {
          expect(seen.has(Math.floor(m.y) * map.width + Math.floor(m.x))).toBe(true);
        }
      }
    }
  });

  test("monsters come from the depth band's own table", () => {
    for (const depth of [1, 3, 5, 8]) {
      const band = bandFor(depth);
      const map = cryptFloor(createRng(3), depth);
      const monsterChs = map.markers.map((m) => m.ch).filter((ch) => MARKER_TYPES[ch] && ch !== "B");
      expect(monsterChs.length).toBeGreaterThan(0);
      for (const ch of monsterChs) expect(band.spawnTable).toContain(ch);
    }
  });

  test("the Barrow Lord holds floor 5 and floor 5 only", () => {
    for (let seed = 1; seed <= 4; seed++) {
      for (const depth of [1, 2, 3, 4, 5, 6, 7]) {
        const map = cryptFloor(createRng(seed), depth);
        const lords = map.markers.filter((m) => m.ch === "B").length;
        expect(lords).toBe(depth === 5 ? 1 : 0);
      }
    }
  });

  test("the way up sits in a dead-end nook so pathing never trips it", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const map = cryptFloor(createRng(seed), 1);
      const up = map.markers.find((m) => m.ch === "<")!;
      const cx = Math.floor(up.x);
      const cy = Math.floor(up.y);
      let openings = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = (cy + dy) * map.width + (cx + dx);
        if (map.cells[key] === 1) openings++;
      }
      expect(openings).toBe(1);
    }
  });

  test("consecutive floors differ from one another", () => {
    // Distinct floors of one descent draw from one rng stream — no repeats.
    const rng = createRng(9);
    const f1 = cryptFloor(rng, 1);
    const f2 = cryptFloor(rng, 2);
    expect([...f1.cells]).not.toEqual([...f2.cells]);
  });
});

describe("world integration", () => {
  test("floor 5 spawns the Barrow Lord; floor 1 does not", () => {
    const state = soloGame(1);
    for (let n = 2; n <= 5; n++) ensureFloor(state, n);
    const typesOn = (id: `floor:${number}`) =>
      new Set([...getZone(state, id).monsters.values()].map((m) => m.typeId));
    expect(typesOn("floor:1").has("barrow_lord")).toBe(false);
    expect(typesOn("floor:5").has("barrow_lord")).toBe(true);
  });

  test("floors are populated and scale with depth", () => {
    const state = soloGame(2);
    ensureFloor(state, 4);
    const shallow = [...getZone(state, "floor:1").monsters.values()];
    const deep = [...getZone(state, "floor:4").monsters.values()];
    expect(shallow.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    const avg = (ms: typeof deep) => ms.reduce((s, m) => s + m.maxLife, 0) / ms.length;
    expect(avg(deep)).toBeGreaterThan(avg(shallow));
  });
});
