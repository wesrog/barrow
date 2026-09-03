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
import { DUNGEON_ORDER } from "./dungeons";
import { dungeonAtEntrance, worldDungeonEntrance } from "./surface";
import { player, soloGame } from "./test-helpers";
import { resetRun, stepSolo } from "./tick";
import { getZone } from "./state";

describe("surfaceLayout", () => {
  test("registry order drives iteration", () => {
    expect(AREA_ORDER).toEqual([
      "overworld",
      "redfen",
      "gallowmire",
      "cragmaw",
      "ashfell",
      "hollowcrown",
    ]);
  });

  test("current registry stitches to the expected offsets and bounds", () => {
    const layout = surfaceLayout();
    expect(layout.offsets.overworld).toEqual({ x: 0, y: 13 });
    expect(layout.offsets.redfen).toEqual({ x: 64, y: 16 });
    expect(layout.offsets.gallowmire).toEqual({ x: 144, y: 0 });
    expect(layout.offsets.cragmaw).toEqual({ x: 200, y: 12 });
    expect(layout.offsets.ashfell).toEqual({ x: 272, y: 12 });
    expect(layout.offsets.hollowcrown).toEqual({ x: 352, y: 12 });
    expect(layout.width).toBe(424);
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
    const { map } = stitchSurface(createRng(7));
    // The town pad is fixed registry data; wild pads are wherever this seed hid them.
    expect(worldWaypointPos(map, "overworld")).toEqual({ x: 10.5, y: 48.5 });
    expect(areaAt(worldWaypointPos(map, "redfen"))).toBe("redfen");
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
    expect(map.width).toBe(424);
    expect(map.height).toBe(88);
    expect(map.spawn).toEqual({ x: 7.5, y: 45.5 });
    expect(map.camps.length).toBe(1); // only the moors camp — the wilds are hostile
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
    // Flood fill from the overworld spawn must reach redfen's hidden waypoint cell.
    const wp = worldWaypointPos(map, "redfen");
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
    expect(seen.has(Math.floor(wp.y) * map.width + Math.floor(wp.x))).toBe(true);
  });

  test("feature markers land at world offsets; monster markers are stripped", () => {
    // One crypt mouth per dungeon; the barrow's sits at its historic world spot.
    expect(map.markers.filter((m) => m.ch === ">").length).toBe(DUNGEON_ORDER.length);
    expect(map.markers).toContainEqual({ ch: ">", x: 58.5, y: 69.5 });
    expect(map.markers.filter((m) => m.ch === "W").length).toBe(6);
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

describe("one surface zone", () => {
  test("createGame seats the world in a single surface zone", () => {
    const state = soloGame(3);
    expect(state.zones.has("surface")).toBe(true);
    expect(state.zones.has("overworld" as never)).toBe(false);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).pos).toEqual({ x: 7.5, y: 45.5 });
  });

  test("walking across the corridor changes region, not zone", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 63.5, y: 45.5 };
    stepSolo(state, { moveTo: { x: 65.5, y: 45.5 } });
    for (let i = 0; i < 60; i++) stepSolo(state, {});
    expect(p.zoneId).toBe("surface");
    expect(p.pos.x).toBeGreaterThan(64);
  });

  test("waypoint travel lands on the destination pad, same zone", () => {
    const state = soloGame(3);
    const p = player(state);
    const surfaceMap = getZone(state, "surface").map;
    p.waypoints = ["overworld", "redfen"];
    p.pos = { ...worldWaypointPos(surfaceMap, "overworld") };
    stepSolo(state, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("surface");
    expect(p.pos).toEqual(worldWaypointPos(surfaceMap, "redfen"));
  });

  test("stairs still swap zones: surface > barrow floor 1 > surface", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 58.5, y: 69.5 }; // the barrow mouth '>'
    stepSolo(state, {});
    expect(p.zoneId).toBe("dungeon:barrow:1");
    const up = getZone(state, "dungeon:barrow:1").map.markers.find((m) => m.ch === "<")!;
    p.pos = { x: up.x, y: up.y };
    stepSolo(state, {});
    expect(p.zoneId).toBe("surface");
  });

  test("outposts have no safe ground: only touching the pad stamps the checkpoint", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { ...worldWaypointPos(getZone(state, "surface").map, "redfen") };
    stepSolo(state, {});
    expect(p.checkpoint).toBe("redfen");
    expect(p.wasInCamp).toBe(false); // the pad is hostile ground, not a camp
  });

  test("resetRun regenerates one surface and reseats everyone at camp", () => {
    const state = soloGame(3);
    resetRun(state);
    expect([...state.zones.keys()]).toEqual(["surface"]);
    expect(player(state).zoneId).toBe("surface");
    expect(inRect(worldCampRect("overworld"), player(state).pos)).toBe(true);
  });
});

describe("region_entered", () => {
  test("crossing the corridor emits region_entered exactly once", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 63.5, y: 45.5 };
    p.region = "overworld";
    const areas: string[] = [];
    for (let i = 0; i < 60; i++) {
      stepSolo(state, i === 0 ? { moveTo: { x: 66.5, y: 45.5 } } : {});
      for (const e of state.events) {
        if (e.type === "region_entered") areas.push(e.area);
      }
    }
    expect(areas).toEqual(["redfen"]);
    expect(p.region).toBe("redfen");
  });

  test("no event fires while pacing inside one region", () => {
    const state = soloGame(3);
    for (let i = 0; i < 10; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "region_entered")).toBe(false);
    }
  });

  test("descending keeps the last surface region", () => {
    const state = soloGame(3);
    const p = player(state);
    p.pos = { x: 58.5, y: 69.5 };
    stepSolo(state, {});
    expect(p.zoneId).toBe("dungeon:barrow:1");
    expect(p.region).toBe("overworld");
  });
});

describe("dungeon entrances on the surface", () => {
  test("every dungeon's '>' marker lands on the stitched map, walkable", () => {
    const { map } = stitchSurface(createRng(11));
    for (const id of DUNGEON_ORDER) {
      const at = worldDungeonEntrance(id);
      const m = map.markers.find(
        (mk) => mk.ch === ">" && Math.hypot(mk.x - at.x, mk.y - at.y) < 0.01,
      );
      expect(m).toBeDefined();
      expect(isWalkable(map, Math.floor(at.x), Math.floor(at.y))).toBe(true);
    }
    // Exactly one '>' per dungeon, no strays.
    expect(map.markers.filter((mk) => mk.ch === ">").length).toBe(DUNGEON_ORDER.length);
  });

  test("dungeonAtEntrance resolves each entrance and nothing else", () => {
    for (const id of DUNGEON_ORDER) {
      expect(dungeonAtEntrance(worldDungeonEntrance(id))).toBe(id);
    }
    expect(dungeonAtEntrance({ x: 1.5, y: 1.5 })).toBe(null);
  });
});
