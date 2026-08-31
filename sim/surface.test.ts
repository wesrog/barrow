import { describe, expect, test } from "bun:test";
import {
  AREA_ORDER,
  areaAt,
  areaRect,
  inRect,
  surfaceLayout,
  stitchSurface,
  worldAreaSpawn,
  worldCampRect,
  worldWaypointPos,
} from "./surface";
import { mapFromStrings, inCamp, isWalkable } from "./map";
import { AREAS } from "./areas";
import { createRng } from "./rng";

describe("surfaceLayout", () => {
  test("registry order drives iteration", () => {
    expect(AREA_ORDER).toEqual(["overworld", "redfen", "gallowmire", "cragmaw"]);
  });

  test("current registry stitches to the expected offsets and bounds", () => {
    const layout = surfaceLayout();
    expect(layout.offsets.overworld).toEqual({ x: 0, y: 13 });
    expect(layout.offsets.redfen).toEqual({ x: 64, y: 16 });
    expect(layout.offsets.gallowmire).toEqual({ x: 144, y: 0 });
    expect(layout.offsets.cragmaw).toEqual({ x: 200, y: 12 });
    expect(layout.width).toBe(272);
    expect(layout.height).toBe(88);
  });

  test("every exit pair aligns: the reciprocal mouths share a world row", () => {
    const layout = surfaceLayout();
    for (const id of AREA_ORDER) {
      const def = AREAS[id];
      for (const e of def.exits) {
        const back = AREAS[e.to].exits.find((x) => x.to === id)!;
        // E/W exits: `at` is a row; world rows must match.
        expect(e.at + layout.offsets[id]!.y).toBe(back.at + layout.offsets[e.to]!.y);
      }
    }
  });
});

describe("areaAt", () => {
  test("resolves positions inside each region rect", () => {
    for (const id of AREA_ORDER) {
      const r = areaRect(id);
      expect(areaAt({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 })).toBe(id);
    }
  });

  test("the corridor cells split at the rect boundary", () => {
    expect(areaAt({ x: 63.5, y: 45.5 })).toBe("overworld");
    expect(areaAt({ x: 64.5, y: 45.5 })).toBe("redfen");
  });

  test("positions outside every rect resolve to the nearest region", () => {
    // Above redfen's band (redfen spans y 16..72): 11 cells below redfen's rect,
    // far from every other. And off the west edge, overworld is nearest.
    expect(areaAt({ x: 100, y: 5 })).toBe("redfen");
    expect(areaAt({ x: -5, y: 45 })).toBe("overworld");
  });
});

describe("world helpers", () => {
  test("waypoint, camp, and spawn positions carry their region offset", () => {
    expect(worldWaypointPos("overworld")).toEqual({ x: 10.5, y: 48.5 });
    expect(worldWaypointPos("redfen")).toEqual({ x: 70.5, y: 45.5 });
    expect(worldCampRect("overworld")).toEqual({ x0: 2, y0: 39, x1: 13, y1: 52 });
    expect(worldAreaSpawn("overworld")).toEqual({ x: 7.5, y: 45.5 });
    expect(inRect(worldCampRect("overworld"), { x: 7.5, y: 45.5 })).toBe(true);
    expect(inRect(worldCampRect("overworld"), { x: 20, y: 45.5 })).toBe(false);
  });
});

describe("camps", () => {
  test("inCamp checks every rect in camps", () => {
    const map = mapFromStrings(["....", "....", "....", "...."]);
    map.camps = [
      { x0: 0, y0: 0, x1: 2, y1: 2 },
      { x0: 3, y0: 3, x1: 4, y1: 4 },
    ];
    expect(inCamp(map, { x: 1, y: 1 })).toBe(true);
    expect(inCamp(map, { x: 3.5, y: 3.5 })).toBe(true);
    expect(inCamp(map, { x: 2.5, y: 2.5 })).toBe(false);
  });
});

describe("stitchSurface", () => {
  const { map, monsters } = stitchSurface(createRng(7));

  test("bounds and spawn", () => {
    expect(map.width).toBe(272);
    expect(map.height).toBe(88);
    expect(map.spawn).toEqual({ x: 7.5, y: 45.5 });
    expect(map.camps.length).toBe(4);
  });

  test("the overworld-redfen corridor is open exactly at the exit rows", () => {
    // Both rims meet at x=63|64; the 3-wide channels sit at world rows 44..46.
    for (let y = 0; y < map.height; y++) {
      const open = y >= 44 && y <= 46;
      expect(isWalkable(map, 63, y)).toBe(open);
      expect(isWalkable(map, 64, y)).toBe(open);
    }
  });

  test("the corridor connects: a walkable path of cells crosses the seam", () => {
    // Flood fill from the overworld spawn must reach redfen's waypoint cell.
    const seen = new Set<number>([Math.floor(45.5) * map.width + Math.floor(7.5)]);
    const stack = [{ x: 7, y: 45 }];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        const k = ny * map.width + nx;
        if (seen.has(k) || !isWalkable(map, nx, ny)) continue;
        seen.add(k);
        stack.push({ x: nx, y: ny });
      }
    }
    expect(seen.has(45 * map.width + 70)).toBe(true); // redfen waypoint cell (70,45)
  });

  test("feature markers land at world offsets; monster markers are stripped", () => {
    expect(map.markers.filter((m) => m.ch === ">").length).toBe(1);
    expect(map.markers.find((m) => m.ch === ">")).toEqual({ ch: ">", x: 58.5, y: 69.5 });
    expect(map.markers.filter((m) => m.ch === "W").length).toBe(4);
    expect(map.markers.some((m) => m.ch === "z" || m.ch === "h")).toBe(false);
  });

  test("monsters spawn inside their region at region-banded levels", () => {
    expect(monsters.length).toBeGreaterThan(150);
    for (const s of monsters) {
      const region = areaAt(s.pos);
      const def = AREAS[region];
      expect(inRect(areaRect(region), s.pos)).toBe(true);
      expect(s.level).toBeGreaterThanOrEqual(def.areaLevel);
      expect(s.level).toBeLessThanOrEqual(def.areaLevel + def.bandCap);
    }
  });

  test("deterministic: same seed, identical cells and spawns", () => {
    const a = stitchSurface(createRng(99));
    const b = stitchSurface(createRng(99));
    expect(Buffer.from(a.map.cells).equals(Buffer.from(b.map.cells))).toBe(true);
    expect(a.monsters).toEqual(b.monsters);
  });
});
