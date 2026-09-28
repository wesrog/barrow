import type { MapMarker } from "./map";
import type { Rng } from "./rng";

/**
 * Landmarks: the structures that break up the wilds. Each is a marker
 * character the renderer dresses (client/render/wildDressing.ts) plus what
 * the map needs to know: which cells the structure occupies (walled, so
 * nobody walks through a tent), how much open ground it wants around it,
 * which monsters lair there, and where its chest sits. Rows, not code.
 */

export interface LandmarkDef {
  ch: string;
  name: string;
  /** Cells the structure occupies, relative to the marker cell; the generator walls them. */
  solid: readonly (readonly [number, number])[];
  /** Chebyshev radius around the marker cleared to floor when it lands, so the
   * structure stands in the open; a spot is refused when most of that square
   * is solid ground already (no bulldozing a crag). */
  clear: number;
  /** Monsters that lair here: `count` markers on floor within `radius`, drawn from `chars`
   * or, without them, the area's own spawn table. */
  pack?: { count: number; radius: number; chars?: string };
  /** A treasure chest at this offset, as a `$` marker. */
  chest?: readonly [number, number];
}

export const LANDMARKS: Record<string, LandmarkDef> = {
  // A ring of standing stones with something waiting in the middle.
  O: {
    ch: "O",
    name: "stone circle",
    solid: [[2, 0], [1, 2], [-1, 2], [-2, 0], [-1, -2], [1, -2]],
    clear: 3,
    pack: { count: 3, radius: 1 },
  },
  // Two walls of an older building, a fallen pillar, and what its keepers left.
  U: {
    ch: "U",
    name: "ruin",
    solid: [[-2, -2], [-1, -2], [0, -2], [1, -2], [-2, -1], [-2, 0], [-2, 1], [2, 1]],
    clear: 3,
    pack: { count: 2, radius: 2 },
    chest: [1, -1],
  },
  // Raiders' tents around a cook fire, a watchtower and a spike wall; the
  // raiders are home.
  C: {
    ch: "C",
    name: "raider camp",
    solid: [[-3, -2], [-2, -2], [-3, -1], [-2, -1], [1, -2], [2, -2], [1, -1], [2, -1], [-3, 1], [-2, 1], [-3, 2], [-2, 2], [3, 0], [3, 1]],
    clear: 4,
    pack: { count: 4, radius: 2, chars: "sr" },
    chest: [0, -1],
  },
  // A traveller's camp gone cold, with their pack still beside the ashes.
  N: {
    ch: "N",
    name: "cold camp",
    solid: [],
    clear: 2,
    chest: [1, 1],
  },
  // A weathered idol with candles still burning before it.
  X: {
    ch: "X",
    name: "old shrine",
    solid: [[0, -2]],
    clear: 2,
  },
};

export const LANDMARK_CHARS = Object.keys(LANDMARKS);

export function isLandmarkMarker(ch: string): boolean {
  return ch in LANDMARKS;
}

/** What the placer needs to know about the region it is filling. */
export interface LandmarkSite {
  cells: Uint8Array;
  width: number;
  height: number;
  /** Floor cells reachable from the spawn; the placer keeps them so and updates the set. */
  reachable: Set<number>;
  /** Cells already holding a marker; the placer adds its own. */
  taken: Set<number>;
  /** Cells and radii nothing may land near: the spawn, safe ground, NPC homes, exit mouths, fixed features. */
  keepClear: (x: number, y: number) => boolean;
  spawnTable: readonly string[];
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Every floor cell connected to (sx, sy) by orthogonal steps. */
export function floodFloor(cells: Uint8Array, w: number, h: number, sx: number, sy: number): Set<number> {
  const seen = new Set<number>([sy * w + sx]);
  const stack = [{ x: sx, y: sy }];
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = ny * w + nx;
      if (seen.has(key) || cells[key] !== 1) continue;
      seen.add(key);
      stack.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/** Landmarks stay this far inside the region's edge, like every other feature. */
const RIM = 2;

/**
 * Raise one landmark of each character in `wanted` on reachable ground, at
 * least eight cells from the last: clear its square to floor, wall its
 * footprint, and keep it only when every floor cell the region had stays
 * reachable. Returns the markers to add (the landmark, its lairing pack, its
 * chest). Draws from `rng` after every other feature so existing layouts keep
 * their rolls.
 */
export function placeLandmarks(rng: Rng, wanted: string, site: LandmarkSite, spawn: { x: number; y: number }): MapMarker[] {
  const { cells, width: w, height: h } = site;
  const idx = (x: number, y: number) => y * w + x;
  const inside = (x: number, y: number) => x >= RIM && x < w - RIM && y >= RIM && y < h - RIM;
  const placed: { x: number; y: number }[] = [];
  const out: MapMarker[] = [];
  for (const ch of wanted) {
    const def = LANDMARKS[ch];
    if (!def) throw new Error(`unknown landmark: ${ch}`);
    const reach = Math.max(def.clear, ...def.solid.map(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy))));
    for (let tries = 0; tries < 300; tries++) {
      const x = rng.int(RIM + reach, w - RIM - reach - 1);
      const y = rng.int(RIM + reach, h - RIM - reach - 1);
      if (!site.reachable.has(idx(x, y)) || site.keepClear(x, y)) continue;
      if (placed.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 8)) continue;
      // The footprint may not bury a marker; the square around must be mostly open already.
      const solidKeys = def.solid.map(([dx, dy]) => idx(x + dx, y + dy));
      if (solidKeys.some((k) => site.taken.has(k))) continue;
      let floor = 0;
      let total = 0;
      for (let dy = -def.clear; dy <= def.clear; dy++) {
        for (let dx = -def.clear; dx <= def.clear; dx++) {
          total++;
          if (cells[idx(x + dx, y + dy)] === 1) floor++;
        }
      }
      if (floor < total * 0.55) continue;
      // Clear the square (floor only grows, so nothing gets cut off), wall the
      // footprint, then prove the walls cut nothing off; undo if they did.
      const carved: number[] = [];
      for (let dy = -def.clear; dy <= def.clear; dy++) {
        for (let dx = -def.clear; dx <= def.clear; dx++) {
          const k = idx(x + dx, y + dy);
          if (cells[k] !== 1 && inside(x + dx, y + dy)) {
            cells[k] = 1;
            carved.push(k);
          }
        }
      }
      const wasFloor = solidKeys.filter((k) => cells[k] === 1);
      for (const k of solidKeys) cells[k] = 0;
      const after = floodFloor(cells, w, h, Math.floor(spawn.x), Math.floor(spawn.y));
      const solidSet = new Set(solidKeys);
      let intact = true;
      for (const k of site.reachable) {
        if (!solidSet.has(k) && !after.has(k)) {
          intact = false;
          break;
        }
      }
      if (!intact) {
        for (const k of wasFloor) cells[k] = 1;
        for (const k of carved) cells[k] = 0;
        continue;
      }
      for (const k of carved) if (!solidSet.has(k)) site.reachable.add(k);
      for (const k of solidKeys) site.reachable.delete(k);
      placed.push({ x, y });
      site.taken.add(idx(x, y));
      out.push({ ch, x: x + 0.5, y: y + 0.5 });
      if (def.chest) {
        const cx = x + def.chest[0];
        const cy = y + def.chest[1];
        site.taken.add(idx(cx, cy));
        out.push({ ch: "$", x: cx + 0.5, y: cy + 0.5 });
      }
      if (def.pack) {
        const chars = def.pack.chars ?? site.spawnTable.join("");
        let lairing = 0;
        for (let t = 0; t < 60 && lairing < def.pack.count; t++) {
          const px = x + rng.int(-def.pack.radius, def.pack.radius);
          const py = y + rng.int(-def.pack.radius, def.pack.radius);
          const k = idx(px, py);
          if (cells[k] !== 1 || site.taken.has(k)) continue;
          site.taken.add(k);
          out.push({ ch: chars[rng.int(0, chars.length - 1)]!, x: px + 0.5, y: py + 0.5 });
          lairing++;
        }
      }
      break;
    }
  }
  return out;
}
