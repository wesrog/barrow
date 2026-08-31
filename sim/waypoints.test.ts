import { describe, expect, test } from "bun:test";
import { AREAS } from "./areas";
import { getZone } from "./state";
import { ensureArea, resetRun, stepSolo } from "./tick";
import { player, soloGame } from "./test-helpers";

/** The W marker of an area's generated map. */
function waypointMarker(g: ReturnType<typeof soloGame>, area: "overworld" | "redfen") {
  ensureArea(g, area);
  return getZone(g, area).map.markers.find((m) => m.ch === "W")!;
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
    p.zoneId = "redfen";
    ensureArea(g, "redfen");
    const w = waypointMarker(g, "redfen");
    p.pos = { x: w.x, y: w.y };
    stepSolo(g, {});
    expect(p.waypoints).toEqual(["overworld", "redfen"]);
    expect(p.checkpoint).toBe("redfen");
    expect(g.events.some((e) => e.type === "waypoint_found" && e.area === "redfen")).toBe(true);
    // A second touch neither duplicates nor re-announces.
    stepSolo(g, {});
    expect(p.waypoints).toEqual(["overworld", "redfen"]);
    expect(g.events.some((e) => e.type === "waypoint_found")).toBe(false);
  });

  test("arriving on safe ground stamps the checkpoint without a waypoint touch", () => {
    const g = soloGame(1);
    const p = player(g);
    const zone = ensureArea(g, "redfen");
    p.zoneId = "redfen";
    // Step onto the outpost's safe ground away from its W marker.
    const safe = AREAS.redfen.safe;
    p.pos = { x: safe.x0 + 0.5, y: safe.y0 + 0.5 };
    p.wasInCamp = false;
    stepSolo(g, {});
    expect(p.checkpoint).toBe("redfen");
    expect(zone.id).toBe("redfen");
  });

  test("waypoint travel: standing at one waypoint jumps to any discovered one", () => {
    const g = soloGame(1);
    const p = player(g);
    p.waypoints = ["overworld", "redfen"];
    const w = waypointMarker(g, "overworld");
    p.pos = { x: w.x, y: w.y };
    stepSolo(g, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("redfen");
    const dw = waypointMarker(g, "redfen");
    expect(Math.hypot(p.pos.x - dw.x, p.pos.y - dw.y)).toBeLessThan(0.1);
  });

  test("undiscovered destinations and far-from-waypoint casts are refused", () => {
    const g = soloGame(1);
    const p = player(g);
    const w = waypointMarker(g, "overworld");
    p.pos = { x: w.x, y: w.y };
    stepSolo(g, { waypointTo: "redfen" }); // not discovered
    expect(p.zoneId).toBe("overworld");
    p.waypoints = ["overworld", "redfen"];
    p.pos = { x: w.x + 5, y: w.y }; // discovered, but nowhere near the pad
    stepSolo(g, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("overworld");
  });

  test("death sends you to your last checkpoint, not always the camp", () => {
    const g = soloGame(1);
    const p = player(g);
    p.checkpoint = "redfen";
    // Out on the moor — standing on safe ground would re-stamp the checkpoint.
    p.pos = { x: 30.5, y: 32.5 };
    p.wasInCamp = false;
    p.life = 0;
    stepSolo(g, {});
    // Death respawns immediately — at the checkpoint outpost, gear stripped.
    expect(p.dead).toBe(false);
    expect(p.zoneId).toBe("redfen");
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
    expect(p.zoneId).toBe("overworld");
  });
});
