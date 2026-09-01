import { describe, expect, test } from "bun:test";
import { AREAS, isAreaId } from "./areas";
import { areaZone } from "./zone";
import { createRng } from "./rng";
import { MONSTER_TYPES } from "./monsters";
import { getZone } from "./state";
import { areaLevelAt, areaRect, inRect, worldAreaSpawn } from "./surface";
import { soloGame } from "./test-helpers";
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

describe("area registry", () => {
  test("difficulty comes from the region under your feet, floor number below", () => {
    expect(areaLevelAt("surface", worldAreaSpawn("overworld"))).toBe(1);
    expect(areaLevelAt("surface", worldAreaSpawn("redfen"))).toBe(AREAS.redfen.areaLevel);
    expect(areaLevelAt("floor:3", { x: 0, y: 0 })).toBe(3);
    expect(isAreaId("overworld")).toBe(true);
    expect(isAreaId("floor:2")).toBe(false);
  });

  test("rows are internally consistent", () => {
    for (const def of Object.values(AREAS)) {
      // Cell budget keeps pathfinding, AI, and the renderer comfortable.
      expect(def.width * def.height).toBeLessThanOrEqual(5200);
      if (def.safe) {
        // Safe ground sits clear of the rim so the landmass can breathe around it.
        expect(def.safe.x0).toBeGreaterThanOrEqual(2);
        expect(def.safe.y0).toBeGreaterThanOrEqual(2);
        expect(def.safe.x1).toBeLessThanOrEqual(def.width - 3);
        expect(def.safe.y1).toBeLessThanOrEqual(def.height - 3);
        // The spawn is on safe ground.
        expect(def.spawn.x).toBeGreaterThan(def.safe.x0);
        expect(def.spawn.x).toBeLessThan(def.safe.x1);
        expect(def.spawn.y).toBeGreaterThan(def.safe.y0);
        expect(def.spawn.y).toBeLessThan(def.safe.y1);
      } else {
        // Wild regions hide their waypoint per-seed instead of stamping one.
        expect(def.markers.some((m) => m.ch === "W")).toBe(false);
      }
      // Every exit leads to a real area that points back.
      for (const e of def.exits) {
        const back = AREAS[e.to];
        expect(back).toBeDefined();
        expect(back.exits.some((r) => r.to === def.id)).toBe(true);
      }
    }
  });
});

// The old teleport at the rim is gone — walking the corridor is covered by
// "walking across the corridor changes region, not zone" in surface.test.ts.
describe("region difficulty", () => {
  test("redfen monsters scale from its area level", () => {
    const g = soloGame(1);
    const spawn = worldAreaSpawn("redfen");
    const rect = areaRect("redfen");
    const near = [...getZone(g, "surface").monsters.values()].filter(
      (m) => inRect(rect, m.pos) && Math.hypot(m.pos.x - spawn.x, m.pos.y - spawn.y) < 28,
    );
    expect(near.length).toBeGreaterThan(0);
    for (const m of near) {
      const base = MONSTER_TYPES[m.typeId]!;
      expect(m.mlvl).toBe(base.mlvl + 3 * (AREAS.redfen.areaLevel - 1));
    }
  });
});

describe("organic landmass", () => {
  const seeds = [3, 7, 11];
  for (const def of Object.values(AREAS)) {
    describe(def.id, () => {
      test("same seed generates the same map", () => {
        const a = areaZone(createRng(5), def);
        const b = areaZone(createRng(5), def);
        expect([...a.cells]).toEqual([...b.cells]);
        expect(a.markers).toEqual(b.markers);
      });

      for (const seed of seeds) {
        test(`seed ${seed}: every floor cell and marker is reachable from spawn`, () => {
          const map = areaZone(createRng(seed), def);
          const seen = reachableFrom(map, Math.floor(map.spawn.x), Math.floor(map.spawn.y));
          for (let i = 0; i < map.cells.length; i++) {
            if (map.cells[i] === 1) expect(seen.has(i)).toBe(true);
          }
          for (const m of map.markers) {
            expect(seen.has(Math.floor(m.y) * map.width + Math.floor(m.x))).toBe(true);
          }
        });

        test(`seed ${seed}: the silhouette is an irregular blob, not a rimmed rectangle`, () => {
          const map = areaZone(createRng(seed), def);
          // Trace the first floor cell from each edge; an organic coast takes
          // many different depths, a walled rectangle takes one or two.
          const tops = new Set<number>();
          const bottoms = new Set<number>();
          for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
              if (map.cells[y * map.width + x] === 1) {
                tops.add(y);
                break;
              }
            }
            for (let y = map.height - 1; y >= 0; y--) {
              if (map.cells[y * map.width + x] === 1) {
                bottoms.add(y);
                break;
              }
            }
          }
          expect(tops.size).toBeGreaterThanOrEqual(6);
          expect(bottoms.size).toBeGreaterThanOrEqual(6);
        });

        test(`seed ${seed}: floor covers a sane fraction of the rect`, () => {
          const map = areaZone(createRng(seed), def);
          let floor = 0;
          for (const c of map.cells) if (c === 1) floor++;
          const fraction = floor / map.cells.length;
          expect(fraction).toBeGreaterThan(0.3);
          expect(fraction).toBeLessThan(0.75);
        });

        test(`seed ${seed}: safe ground interior is all floor, monster packs outside it`, () => {
          const safe = def.safe;
          if (!safe) return; // wild regions have no safe ground at all
          const map = areaZone(createRng(seed), def);
          for (let y = safe.y0; y < safe.y1; y++) {
            for (let x = safe.x0; x < safe.x1; x++) {
              expect(map.cells[y * map.width + x]).toBe(1);
            }
          }
          for (const m of map.markers) {
            if (!def.spawnTable.includes(m.ch)) continue;
            const inSafe = m.x >= safe.x0 && m.x < safe.x1 && m.y >= safe.y0 && m.y < safe.y1;
            expect(inSafe).toBe(false);
          }
        });
      }
    });
  }
});
