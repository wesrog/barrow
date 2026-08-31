import { describe, expect, test } from "bun:test";
import {
  AREA_ORDER,
  areaAt,
  areaRect,
  inRect,
  surfaceLayout,
  worldAreaSpawn,
  worldCampRect,
  worldWaypointPos,
} from "./surface";
import { AREAS } from "./areas";

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
