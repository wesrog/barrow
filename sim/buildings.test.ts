import { describe, expect, test } from "bun:test";
import { AREAS } from "./areas";
import { buildingCentre, buildingInterior, buildingRing, isBuildingCorner } from "./buildings";
import { floodFloor } from "./landmarks";
import { createRng } from "./rng";
import { areaZone } from "./zone";

describe("building geometry", () => {
  const hall = { ch: "J", x0: 13, y0: 25, x1: 19, y1: 29, door: [16, 29] as const };

  test("the ring is the rect's edge, the interior everything inside, the centre a cell centre", () => {
    expect(buildingRing(hall).length).toBe(7 * 2 + 3 * 2);
    expect(buildingInterior(hall).length).toBe(5 * 3);
    expect(buildingCentre(hall)).toEqual({ x: 16.5, y: 27.5 });
    expect(isBuildingCorner(hall, 13, 25)).toBe(true);
    expect(isBuildingCorner(hall, 16, 25)).toBe(false);
  });
});

describe("buildings on the moors", () => {
  const def = AREAS.overworld;
  const buildings = def.buildings ?? [];
  test("the camp has a hall and a storehouse", () => {
    expect(buildings.map((b) => b.ch).sort()).toEqual(["D", "J"]);
    for (const b of buildings) {
      const safe = def.safe!;
      expect(b.x0).toBeGreaterThanOrEqual(safe.x0);
      expect(b.x1).toBeLessThan(safe.x1);
      expect(b.y0).toBeGreaterThanOrEqual(safe.y0);
      expect(b.y1).toBeLessThan(safe.y1);
      expect(buildingRing(b).some((c) => c.x === b.door[0] && c.y === b.door[1])).toBe(true);
    }
  });

  for (const seed of [3, 7, 42]) {
    test(`seed ${seed}: walls stand, doors open, floors inside, the marker at the centre, all reachable`, () => {
      const map = areaZone(createRng(seed), def);
      const at = (x: number, y: number) => map.cells[y * map.width + x];
      const seen = floodFloor(map.cells, map.width, map.height, Math.floor(map.spawn.x), Math.floor(map.spawn.y));
      for (const b of buildings) {
        for (const c of buildingRing(b)) {
          const isDoor = c.x === b.door[0] && c.y === b.door[1];
          expect(at(c.x, c.y)).toBe(isDoor ? 1 : 0);
        }
        for (const c of buildingInterior(b)) {
          expect(at(c.x, c.y)).toBe(1);
          expect(seen.has(c.y * map.width + c.x)).toBe(true);
        }
        expect(map.markers).toContainEqual({ ch: b.ch, ...buildingCentre(b) });
      }
    });
  }
});
