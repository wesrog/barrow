import { mapFromStrings, type MapMarker, type ZoneMap } from "./map";
import type { Rng } from "./rng";
import { zoneDepth, type ZoneId } from "./state";

/** Map marker characters -> monster types. */
export const MARKER_TYPES: Record<string, string> = {
  z: "shambler",
  s: "skitter",
  r: "gravespit",
  e: "tomb_bloat",
  B: "barrow_lord",
};

/**
 * The crypt under the barrow. '#' wall, '.' floor, '@' spawn,
 * z/s/r/e monsters, B the Barrow Lord in his vault.
 */
export function cryptZone(): ZoneMap {
  return mapFromStrings([
    "######################################",
    "#@........#..........#....z.....#...#",
    "#.........#....s.....#..........#.r.#",
    "#...##....#..........#...####...#...#",
    "#...##....####...#####...#..#.......#",
    "#..............s.........#..#...z...#",
    "#......z..................ss........#",
    "###..#####....#####...#######...#####",
    "#.......#........#....#.............#",
    "#..s....#...e....#....#....e....s...#",
    "#.......#........#.........s........#",
    "#..##...####..####....#......###..###",
    "#..##......#..#.......#......#......#",
    "#......r...#..#...z...#......#.r....#",
    "#..........#..#.......###..###......#",
    "####..######..####........##....B...#",
    "#........s......s#...z....##........#",
    "#.e...............#......###...##.>.#",
    "#.........z.......#......#......##..#",
    "######################################",
  ]);
}

/** What the locals call each stretch of the descent. Depth 0 is the camp. */
export function zoneName(depth: number): string {
  if (depth <= 0) return "The Camp";
  if (depth <= 2) return "The Barrow Crypt";
  if (depth <= 4) return "The Sunken Halls";
  if (depth <= 6) return "The Bone Vaults";
  return "The Wyrm's Undercroft";
}

/** Display name for a zone id (the depth-based names cover the crypt floors). */
export function zoneTitle(id: ZoneId): string {
  if (id === "overworld") return "The Wither Moors";
  return zoneName(zoneDepth(id));
}

/** The camp's display name — a region of the moors, not a zone of its own. */
export const CAMP_TITLE = "The Camp";

/**
 * The moors above the barrow: an open world of windswept heath. The camp is a
 * palisaded clearing at the west end — safe ground holding the spawn, V the
 * vendor, H the healer, and P the travel pad — open to the moor through a gap
 * in its east wall. Procedural rock crags and dead copses break up the open
 * ground beyond, '>' is the barrow mouth far to the southeast, and monster
 * packs thicken the farther you roam from the palisade.
 */
export function overworldZone(rng: Rng): ZoneMap {
  const size = 64;
  const cells = new Uint8Array(size * size).fill(1);
  const idx = (x: number, y: number) => y * size + x;

  // A rim of impassable crags hems in the moor.
  for (let i = 0; i < size; i++) {
    cells[idx(i, 0)] = 0;
    cells[idx(i, size - 1)] = 0;
    cells[idx(0, i)] = 0;
    cells[idx(size - 1, i)] = 0;
  }

  // Safe ground: the palisade ring sits on the rect's edges, camp floor inside.
  const camp = { x0: 2, y0: 26, x1: 13, y1: 39 };
  const spawn = { x: 7.5, y: 32.5 };
  const barrow = { x: size - 6, y: size - 8 };

  // Crag/copse blobs: short random walks of wall, steering clear of the anchors.
  const nearAnchor = (x: number, y: number) =>
    Math.hypot(x - spawn.x, y - spawn.y) < 4 ||
    Math.hypot(x - barrow.x, y - barrow.y) < 4;
  for (let b = 0; b < 120; b++) {
    let x = rng.int(2, size - 3);
    let y = rng.int(2, size - 3);
    const len = rng.int(3, 10);
    for (let i = 0; i < len; i++) {
      if (!nearAnchor(x, y)) cells[idx(x, y)] = 0;
      x = Math.min(size - 3, Math.max(2, x + rng.int(-1, 1)));
      y = Math.min(size - 3, Math.max(2, y + rng.int(-1, 1)));
    }
  }

  // Raise the palisade and clear the camp floor (blobs never carve safe ground).
  for (let y = camp.y0 - 1; y <= camp.y1; y++) {
    for (let x = camp.x0 - 1; x <= camp.x1; x++) {
      const onEdge = x === camp.x0 - 1 || x === camp.x1 || y === camp.y0 - 1 || y === camp.y1;
      cells[idx(x, y)] = onEdge ? 0 : 1;
    }
  }
  // The east wall opens onto the moor.
  const sy = Math.floor(spawn.y);
  for (let y = sy - 1; y <= sy + 1; y++) cells[idx(camp.x1, y)] = 1;

  // A worn trail from the camp gap to the barrow mouth is always open.
  const sx = Math.floor(spawn.x);
  for (let x = camp.x1; x <= barrow.x; x++) cells[idx(x, sy)] = 1;
  for (let y = Math.min(sy, barrow.y); y <= Math.max(sy, barrow.y); y++) {
    cells[idx(barrow.x, y)] = 1;
  }

  // Seal off any pocket the blobs cut away from the trail network.
  const reachable = new Set<number>([idx(sx, sy)]);
  const queue = [{ x: sx, y: sy }];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const key = idx(nx, ny);
      if (reachable.has(key) || cells[key] !== 1) continue;
      reachable.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 1 && !reachable.has(i)) cells[i] = 0;
  }

  const markers: MapMarker[] = [
    { ch: "V", x: 4.5, y: 29.5 },
    { ch: "H", x: 4.5, y: 35.5 },
    { ch: "P", x: 10.5, y: 28.5 },
    { ch: ">", x: barrow.x + 0.5, y: barrow.y + 0.5 },
  ];

  // Monster packs scattered over the open ground, never crowding the palisade.
  const kinds = ["z", "z", "z", "s", "s", "r", "e"];
  const taken = new Set<number>();
  let placed = 0;
  for (let tries = 0; placed < 55 && tries < 4000; tries++) {
    const x = rng.int(2, size - 3);
    const y = rng.int(2, size - 3);
    const key = idx(x, y);
    if (!reachable.has(key) || taken.has(key)) continue;
    if (Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 10) continue;
    taken.add(key);
    markers.push({ ch: kinds[rng.int(0, kinds.length - 1)]!, x: x + 0.5, y: y + 0.5 });
    placed++;
  }

  return { width: size, height: size, cells, spawn, markers, camp };
}
