import { describe, expect, test } from "bun:test";
import { getZone } from "./state";
import { areaAt, worldCampRect, worldWaypointPos } from "./surface";
import { resetRun, stepSolo } from "./tick";
import { player, soloGame } from "./test-helpers";

describe("waypoints", () => {
  test("players wake knowing only the moors waypoint, checkpointed at camp", () => {
    const g = soloGame(1);
    expect(player(g).waypoints).toEqual(["overworld"]);
    expect(player(g).checkpoint).toBe("overworld");
  });

  test("touching a waypoint discovers it once and stamps the checkpoint", () => {
    const g = soloGame(1);
    const p = player(g);
    p.pos = { ...worldWaypointPos("redfen") };
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
    // Step onto the outpost's safe ground away from its W marker.
    const safe = worldCampRect("redfen");
    p.pos = { x: safe.x0 + 0.5, y: safe.y0 + 0.5 };
    p.wasInCamp = false;
    stepSolo(g, {});
    expect(p.checkpoint).toBe("redfen");
    expect(p.zoneId).toBe("surface");
    expect(p.waypoints).toEqual(["overworld"]); // safe ground is not the pad
  });

  test("waypoint travel: standing at one waypoint jumps to any discovered one", () => {
    const g = soloGame(1);
    const p = player(g);
    p.waypoints = ["overworld", "redfen"];
    p.pos = { ...worldWaypointPos("overworld") };
    stepSolo(g, { waypointTo: "redfen" });
    expect(p.zoneId).toBe("surface"); // one world — only the region changes
    expect(areaAt(p.pos)).toBe("redfen");
    const dw = worldWaypointPos("redfen");
    expect(Math.hypot(p.pos.x - dw.x, p.pos.y - dw.y)).toBeLessThan(0.1);
  });

  test("undiscovered destinations and far-from-waypoint casts are refused", () => {
    const g = soloGame(1);
    const p = player(g);
    const w = worldWaypointPos("overworld");
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
    expect(p.pos).toEqual(worldWaypointPos("redfen"));
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
