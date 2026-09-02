import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";
import { AREAS, AREA_IDS } from "./areas";
import { LANDMARKS, LANDMARK_IDS, landmarkAt } from "./landmarks";
import { stitchSurface } from "./surface";
import type { ZoneMap } from "./map";
import { getZone } from "./state";
import { soloGame } from "./test-helpers";

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

describe("landmark table", () => {
  test("stamps are rectangular, carry lore, and claim at least one region", () => {
    for (const id of LANDMARK_IDS) {
      const def = LANDMARKS[id];
      const w = def.rows[0]!.length;
      for (const row of def.rows) expect(row.length).toBe(w);
      expect(def.regions.length).toBeGreaterThan(0);
      for (const r of def.regions) expect(AREA_IDS).toContain(r);
      expect(def.lore.title.length).toBeGreaterThan(0);
      expect(def.lore.lines.length).toBeGreaterThan(0);
    }
  });

  test("every stamp's center column stays open where trails arrive", () => {
    // The gate trail's vertical leg lands on the stamp's center column — the
    // top and bottom rows must not wall it out.
    for (const id of LANDMARK_IDS) {
      const def = LANDMARKS[id];
      const cx = Math.floor(def.rows[0]!.length / 2);
      expect(def.rows[0]![cx]).not.toBe("#");
      expect(def.rows[def.rows.length - 1]![cx]).not.toBe("#");
    }
  });
});

describe("surface placement", () => {
  test("each region hosts its configured landmark count, all sites reachable", () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { map } = stitchSurface(createRng(seed));
      const seen = reachableFrom(map);
      expect(map.landmarks!.length).toBe(
        AREA_IDS.reduce((s, id) => s + AREAS[id].gen.landmarks, 0),
      );
      for (const m of map.markers) {
        if (m.ch !== "$" && m.ch !== "L" && m.ch !== "X") continue;
        expect(seen.has(Math.floor(m.y) * map.width + Math.floor(m.x))).toBe(true);
      }
      // Every placed landmark actually stamped its lore stone into the world.
      for (const placed of map.landmarks!) {
        const hasLore = map.markers.some(
          (m) => m.ch === "L" && landmarkAt(map.landmarks!, { x: m.x, y: m.y })?.id === placed.id,
        );
        expect(hasLore).toBe(true);
      }
    }
  });

  test("landmarkAt resolves a position inside a site to its definition", () => {
    const { map } = stitchSurface(createRng(1));
    const placed = map.landmarks![0]!;
    const def = LANDMARKS[placed.id];
    const inside = { x: placed.x0 + 1.5, y: placed.y0 + 1.5 };
    expect(landmarkAt(map.landmarks!, inside)?.id).toBe(placed.id);
    expect(
      landmarkAt(map.landmarks!, { x: placed.x0 - 50.5, y: placed.y0 + def.rows.length + 50.5 }),
    ).toBeNull();
  });
});

describe("world integration", () => {
  test("chest markers become treasure chests; guard markers become champions", () => {
    let chests = 0;
    let guards = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const state = soloGame(seed);
      const zone = getZone(state, "surface");
      for (const m of zone.map.markers) {
        if (m.ch === "$") {
          const found = [...zone.breakables.values()].some(
            (b) => b.kind === "chest" && b.pos.x === m.x && b.pos.y === m.y,
          );
          expect(found).toBe(true);
          chests++;
        }
        if (m.ch === "X") {
          const found = [...zone.monsters.values()].some(
            (mo) => mo.championId && mo.pos.x === m.x && mo.pos.y === m.y,
          );
          expect(found).toBe(true);
          guards++;
        }
      }
    }
    expect(chests).toBeGreaterThan(0);
    expect(guards).toBeGreaterThan(0);
  });
});
