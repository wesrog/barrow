import { describe, expect, test } from "bun:test";
import { AREAS, type AreaId } from "./areas";
import { inCamp, isWalkable } from "./map";
import { getZone, type GameState } from "./state";
import { areaAt, areaRect, worldWaypointPos } from "./surface";
import { resetRun, stepSolo } from "./tick";
import { player, soloGame } from "./test-helpers";

/** This world's waypoint pad for a region — a lookup in the generated surface. */
function pad(g: GameState, id: AreaId) {
  return worldWaypointPos(getZone(g, "surface").map, id);
}

describe("waypoints", () => {
  test("players wake knowing only the moors waypoint, checkpointed at camp", () => {
    const g = soloGame(1);
    expect(player(g).waypoints).toEqual(["overworld"]);
    expect(player(g).checkpoint).toBe("overworld");
  });

  test("touching a waypoint discovers it once and stamps the checkpoint", () => {
    const g = soloGame(1);
    const p = player(g);
    p.pos = { ...pad(g, "redfen") };
    stepSolo(g, {});
    expect(p.waypoints).toEqual(["overworld", "redfen"]);
    expect(p.checkpoint).toBe("redfen");
    expect(g.events.some((e) => e.type === "waypoint_found" && e.area === "redfen")).toBe(true);
    // A second touch neither duplicates nor re-announces.
    stepSolo(g, {});
    expect(p.waypoints).toEqual(["overworld", "redfen"]);
    expect(g.events.some((e) => e.type === "waypoint_found")).toBe(false);
  });

  test("waypoint travel: standing at one waypoint jumps to any discovered one", () => {
    const g = soloGame(1);
    const p = player(g);
    p.waypoints = ["overworld", "redfen"];
    p.pos = { ...pad(g, "overworld") };
    stepSolo(g, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("surface"); // one world — only the region changes
    expect(areaAt(p.pos)).toBe("redfen");
    const dw = pad(g, "redfen");
    expect(Math.hypot(p.pos.x - dw.x, p.pos.y - dw.y)).toBeLessThan(0.1);
  });

  test("undiscovered destinations and far-from-waypoint casts are refused", () => {
    const g = soloGame(1);
    const p = player(g);
    const w = pad(g, "overworld");
    p.pos = { ...w };
    stepSolo(g, { waypointTo: "redfen" }); // not discovered
    expect(areaAt(p.pos)).toBe("overworld");
    p.waypoints = ["overworld", "redfen"];
    p.pos = { x: w.x + 5, y: w.y }; // discovered, but nowhere near the pad
    stepSolo(g, { waypointTo: "redfen" });
    expect(areaAt(p.pos)).toBe("overworld");
  });

  test("death sends you to your last checkpoint's pad, not always the camp", () => {
    const g = soloGame(1);
    const p = player(g);
    p.checkpoint = "redfen";
    // Out on the moor — standing on safe ground would re-stamp the checkpoint.
    p.pos = { x: 30.5, y: 45.5 };
    p.wasInCamp = false;
    p.life = 0;
    stepSolo(g, {});
    // Death respawns immediately — at the checkpoint outpost, gear stripped.
    expect(p.dead).toBe(false);
    expect(p.zoneId).toBe("surface");
    expect(p.pos).toEqual(pad(g, "redfen"));
    expect(g.events.some((e) => e.type === "player_died")).toBe(true);
  });

  test("a fresh run resets the checkpoint but keeps discovered waypoints", () => {
    const g = soloGame(1);
    const p = player(g);
    p.waypoints = ["overworld", "redfen"];
    p.checkpoint = "redfen";
    resetRun(g);
    expect(p.checkpoint).toBe("overworld");
    expect(p.waypoints).toEqual(["overworld", "redfen"]);
    expect(p.zoneId).toBe("surface");
    expect(getZone(g, "surface").map.spawn).toEqual(p.pos);
  });
});

/** World coordinates of the middle of an exit's opening in a region's rim. */
function exitMouths(id: AreaId): { x: number; y: number }[] {
  const r = areaRect(id);
  return AREAS[id].exits.map((e) =>
    e.edge === "N"
      ? { x: r.x0 + e.at + 0.5, y: r.y0 + 0.5 }
      : e.edge === "S"
        ? { x: r.x0 + e.at + 0.5, y: r.y1 - 0.5 }
        : e.edge === "W"
          ? { x: r.x0 + 0.5, y: r.y0 + e.at + 0.5 }
          : { x: r.x1 - 0.5, y: r.y0 + e.at + 0.5 },
  );
}

const OUTPOSTS: AreaId[] = ["redfen", "gallowmire", "cragmaw", "ashfell", "hollowcrown"];

describe("hidden waypoints", () => {
  test("every region rolls exactly one pad, on walkable ground in its own rect", () => {
    const g = soloGame(11);
    const map = getZone(g, "surface").map;
    const pads = map.markers.filter((m) => m.ch === "W");
    expect(pads).toHaveLength(Object.keys(AREAS).length);
    for (const id of Object.keys(AREAS) as AreaId[]) {
      const own = pads.filter((m) => areaAt({ x: m.x, y: m.y }) === id);
      expect(own).toHaveLength(1);
      expect(isWalkable(map, Math.floor(own[0]!.x), Math.floor(own[0]!.y))).toBe(true);
    }
  });

  test("outpost pads hide deep in the zone, never beside an entrance", () => {
    for (const seed of [1, 7, 42]) {
      const g = soloGame(seed);
      for (const id of OUTPOSTS) {
        const w = pad(g, id);
        for (const mouth of exitMouths(id)) {
          expect(Math.hypot(w.x - mouth.x, w.y - mouth.y)).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  test("pad spots are seed-random, not stamped from the registry", () => {
    const spots = [1, 7, 42].map((seed) => {
      const w = pad(soloGame(seed), "redfen");
      return `${w.x},${w.y}`;
    });
    expect(new Set(spots).size).toBeGreaterThan(1);
  });

  test("the wilds are wholly hostile: only the moors camp is safe ground", () => {
    const g = soloGame(11);
    const map = getZone(g, "surface").map;
    expect(map.camps).toHaveLength(1);
    for (const id of OUTPOSTS) {
      expect(inCamp(map, pad(g, id))).toBe(false);
    }
  });
});
