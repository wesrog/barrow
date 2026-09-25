import { describe, expect, test } from "bun:test";
import { AREAS } from "./areas";
import { LANDMARKS, floodFloor, isLandmarkMarker, placeLandmarks } from "./landmarks";
import { LANDMARK_MARGIN, MARKER_TYPES, NPC_CLEARING, areaZone } from "./zone";
import { NPCS, NPC_IDS } from "./npcs";
import { createRng } from "./rng";
import { ensureSurface } from "./tick";
import { soloGame } from "./test-helpers";
import { surfaceLayout } from "./surface";

const seeds = [3, 7, 11, 42];

describe("landmark placement", () => {
  for (const def of Object.values(AREAS)) {
    if (!def.landmarks) continue;
    describe(def.id, () => {
      for (const seed of seeds) {
        test(`seed ${seed}: every landmark lands on open floor with its footprint walled`, () => {
          const map = areaZone(createRng(seed), def);
          const placed = map.markers.filter((m) => isLandmarkMarker(m.ch));
          expect(placed.map((m) => m.ch).sort().join("")).toBe([...def.landmarks!].sort().join(""));
          for (const m of placed) {
            const cx = Math.floor(m.x);
            const cy = Math.floor(m.y);
            expect(map.cells[cy * map.width + cx]).toBe(1);
            for (const [dx, dy] of LANDMARKS[m.ch]!.solid) {
              expect(map.cells[(cy + dy) * map.width + (cx + dx)]).toBe(0);
            }
          }
        });

        test(`seed ${seed}: the walled footprints cut nothing off`, () => {
          const map = areaZone(createRng(seed), def);
          const seen = floodFloor(map.cells, map.width, map.height, Math.floor(map.spawn.x), Math.floor(map.spawn.y));
          for (let i = 0; i < map.cells.length; i++) {
            if (map.cells[i] === 1) expect(seen.has(i)).toBe(true);
          }
        });

        test(`seed ${seed}: packs lair at their landmark and chests sit where the row says`, () => {
          const map = areaZone(createRng(seed), def);
          for (const m of map.markers) {
            const lm = LANDMARKS[m.ch];
            if (!lm) continue;
            if (lm.pack) {
              // Random packs may roam nearby too; the lair's own must be there in number.
              const near = map.markers.filter(
                (o) =>
                  MARKER_TYPES[o.ch] &&
                  (!lm.pack!.chars || lm.pack!.chars.includes(o.ch)) &&
                  Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y)) <= lm.pack!.radius,
              );
              expect(near.length).toBeGreaterThanOrEqual(lm.pack.count);
            }
            if (lm.chest) {
              expect(map.markers).toContainEqual({ ch: "$", x: m.x + lm.chest[0], y: m.y + lm.chest[1] });
            }
          }
        });

        test(`seed ${seed}: landmarks keep clear of the spawn, safe ground, NPC homes, and each other`, () => {
          const map = areaZone(createRng(seed), def);
          const placed = map.markers.filter((m) => isLandmarkMarker(m.ch));
          const homes = NPC_IDS.map((n) => NPCS[n]).filter((n) => n.area === def.id);
          for (const m of placed) {
            expect(Math.hypot(m.x - def.spawn.x, m.y - def.spawn.y)).toBeGreaterThanOrEqual(12);
            if (def.safe) {
              const nearSafe =
                m.x >= def.safe.x0 - LANDMARK_MARGIN && m.x < def.safe.x1 + LANDMARK_MARGIN && m.y >= def.safe.y0 - LANDMARK_MARGIN && m.y < def.safe.y1 + LANDMARK_MARGIN;
              expect(nearSafe).toBe(false);
            }
            for (const n of homes) expect(Math.hypot(m.x - n.pos.x, m.y - n.pos.y)).toBeGreaterThanOrEqual(NPC_CLEARING + 4);
            for (const o of placed) {
              if (o !== m) expect(Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y))).toBeGreaterThanOrEqual(8);
            }
          }
        });
      }
    });
  }

  test("a footprint that would seal off floor is refused", () => {
    // A 5-wide corridor with a single-cell neck at x = 6: the ruin's L wall
    // must not land across the neck.
    const w = 20;
    const h = 9;
    const cells = new Uint8Array(w * h);
    for (let y = 2; y <= 6; y++) for (let x = 1; x < w - 1; x++) cells[y * w + x] = 1;
    for (let y = 2; y <= 6; y++) if (y !== 4) cells[y * w + 6] = 0;
    const reachable = floodFloor(cells, w, h, 2, 4);
    const before = reachable.size;
    const out = placeLandmarks(createRng(1), "X", { cells, width: w, height: h, reachable, taken: new Set(), keepClear: () => false, spawnTable: ["z"] }, { x: 2.5, y: 4.5 });
    const after = floodFloor(cells, w, h, 2, 4);
    let floor = 0;
    for (const c of cells) if (c === 1) floor++;
    expect(after.size).toBe(floor);
    expect(after.size).toBe(before - out.filter((m) => m.ch === "X").length * LANDMARKS.X!.solid.length);
  });
});

describe("landmarks on the surface", () => {
  test("every $ marker on the surface holds a chest", () => {
    const state = soloGame(5);
    const zone = ensureSurface(state);
    const chests = [...zone.breakables.values()].filter((b) => b.kind === "chest");
    for (const m of zone.map.markers) {
      if (m.ch !== "$") continue;
      expect(chests.some((c) => c.pos.x === m.x && c.pos.y === m.y)).toBe(true);
    }
    expect(zone.map.markers.filter((m) => m.ch === "$").length).toBeGreaterThan(0);
  });

  test("landmark markers carry their region offset onto the surface", () => {
    const state = soloGame(5);
    const zone = ensureSurface(state);
    const o = surfaceLayout().offsets.overworld;
    const moorLandmarks = zone.map.markers.filter((m) => isLandmarkMarker(m.ch) && m.x < o.x + AREAS.overworld.width);
    expect(moorLandmarks.length).toBe(AREAS.overworld.landmarks!.length);
  });
});
