// Procedural crypt floors. Each descent's floor is grown fresh from the world
// rng, themed by depth band: the shallow Barrow Crypt is a warren of small
// chambers, the Sunken Halls widen, the Bone Vaults open into great rooms (the
// Barrow Lord holds floor 5), and the Wyrm's Undercroft below dissolves into
// raw cavern. Pure functions of (rng, depth) — determinism is the contract.

import type { MapMarker, Vec, ZoneMap } from "./map";
import type { Rng } from "./rng";

export interface CryptBand {
  /** Display name — matches zoneName's bands. */
  title: string;
  width: number;
  height: number;
  /** Rooms to attempt (cavern bands ignore room shaping). */
  rooms: { min: number; max: number };
  roomSize: { min: number; max: number };
  /** Corridor carve width in cells. */
  corridor: 1 | 2;
  /** Monster marker chars this band scatters (see MARKER_TYPES). */
  spawnTable: string[];
  /** Monster markers per room (or per cavern-scatter batch). */
  packs: { min: number; max: number };
  /** Grown as one cellular-automata cave instead of rooms and corridors. */
  cavern?: boolean;
}

const BANDS: { maxDepth: number; band: CryptBand }[] = [
  {
    maxDepth: 2,
    band: {
      title: "The Barrow Crypt",
      width: 40, height: 30,
      rooms: { min: 9, max: 12 }, roomSize: { min: 3, max: 6 }, corridor: 1,
      spawnTable: ["z", "z", "s", "s", "r", "e"],
      packs: { min: 1, max: 3 },
    },
  },
  {
    maxDepth: 4,
    band: {
      title: "The Sunken Halls",
      width: 44, height: 34,
      rooms: { min: 7, max: 9 }, roomSize: { min: 5, max: 9 }, corridor: 2,
      spawnTable: ["z", "s", "r", "e", "m", "m"],
      packs: { min: 2, max: 3 },
    },
  },
  {
    maxDepth: 6,
    band: {
      title: "The Bone Vaults",
      width: 48, height: 38,
      rooms: { min: 6, max: 8 }, roomSize: { min: 6, max: 12 }, corridor: 2,
      spawnTable: ["w", "w", "e", "r", "s"],
      packs: { min: 2, max: 4 },
    },
  },
  {
    maxDepth: Infinity,
    band: {
      title: "The Wyrm's Undercroft",
      width: 52, height: 42,
      rooms: { min: 14, max: 20 }, // cavern: total monster scatter budget
      roomSize: { min: 0, max: 0 }, corridor: 1,
      spawnTable: ["w", "m", "h", "e", "z"],
      packs: { min: 14, max: 20 },
      cavern: true,
    },
  },
];

export function bandFor(depth: number): CryptBand {
  for (const { maxDepth, band } of BANDS) {
    if (depth <= maxDepth) return band;
  }
  return BANDS[BANDS.length - 1]!.band;
}

/** The floor the Barrow Lord holds — the campaign's kill quest points here. */
export const BARROW_LORD_FLOOR = 5;

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

const center = (r: Room): Vec => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/** Generate floor `depth` of the barrow from the given rng stream. */
export function cryptFloor(rng: Rng, depth: number): ZoneMap {
  const band = bandFor(depth);
  return band.cavern ? cavernFloor(rng, depth, band) : roomsFloor(rng, depth, band);
}

function roomsFloor(rng: Rng, depth: number, band: CryptBand): ZoneMap {
  const w = band.width;
  const h = band.height;
  const cells = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;

  // Scatter non-overlapping rooms (1-cell mortar between them and the rim).
  const rooms: Room[] = [];
  const target = rng.int(band.rooms.min, band.rooms.max);
  for (let tries = 0; rooms.length < target && tries < 300; tries++) {
    const rw = rng.int(band.roomSize.min, band.roomSize.max);
    const rh = rng.int(band.roomSize.min, band.roomSize.max);
    const rx = rng.int(1, w - rw - 2);
    const ry = rng.int(1, h - rh - 2);
    const room = { x: rx, y: ry, w: rw, h: rh };
    const clashes = rooms.some(
      (o) => rx < o.x + o.w + 1 && o.x < rx + rw + 1 && ry < o.y + o.h + 1 && o.y < ry + rh + 1,
    );
    if (clashes) continue;
    rooms.push(room);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) cells[idx(x, y)] = 1;
    }
  }

  // Corridors: each room joins the nearest already-connected room, so the
  // whole floor is one component by construction; a couple of extra cuts
  // loop it so there is more than one way around.
  const carveCorridor = (a: Vec, b: Vec) => {
    for (let off = 0; off < band.corridor; off++) {
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
        const y = Math.min(h - 2, a.y + off);
        cells[idx(x, y)] = 1;
      }
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
        const x = Math.min(w - 2, b.x + off);
        cells[idx(x, y)] = 1;
      }
    }
  };
  for (let i = 1; i < rooms.length; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const a = center(rooms[i]!);
      const b = center(rooms[j]!);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    carveCorridor(center(rooms[i]!), center(rooms[best]!));
  }
  const loops = rng.int(1, 2);
  for (let i = 0; i < loops && rooms.length > 2; i++) {
    const a = rng.int(0, rooms.length - 1);
    const b = rng.int(0, rooms.length - 1);
    if (a !== b) carveCorridor(center(rooms[a]!), center(rooms[b]!));
  }

  // The spawn room is where you arrive; the farthest room hides the way down.
  const spawnRoom = rooms[0]!;
  const spawnCell = center(spawnRoom);
  const spawn = { x: spawnCell.x + 0.5, y: spawnCell.y + 0.5 };
  let farRoom = rooms[rooms.length - 1]!;
  let farD = -1;
  for (const r of rooms.slice(1)) {
    const c = center(r);
    const d = Math.hypot(c.x - spawnCell.x, c.y - spawnCell.y);
    if (d > farD) {
      farD = d;
      farRoom = r;
    }
  }

  const markers: MapMarker[] = [];
  const taken = new Set<number>([idx(spawnCell.x, spawnCell.y)]);
  const mark = (ch: string, x: number, y: number) => {
    taken.add(idx(x, y));
    markers.push({ ch, x: x + 0.5, y: y + 0.5 });
  };

  const farCell = center(farRoom);
  mark(">", farCell.x, farCell.y);

  // The Barrow Lord guards his vault beside the deeper stairs.
  if (depth === BARROW_LORD_FLOOR) {
    const bx = Math.max(farRoom.x, farCell.x - 2);
    mark("B", bx, farCell.y);
  }

  placeUpNook(cells, w, h, spawnRoom, spawnCell, mark);

  // Monsters room by room; the arrival room stays clear.
  for (const room of rooms) {
    if (room === spawnRoom) continue;
    const packs = rng.int(band.packs.min, band.packs.max);
    for (let i = 0; i < packs; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = rng.int(room.x, room.x + room.w - 1);
        const y = rng.int(room.y, room.y + room.h - 1);
        if (taken.has(idx(x, y))) continue;
        mark(band.spawnTable[rng.int(0, band.spawnTable.length - 1)]!, x, y);
        break;
      }
    }
  }

  return { width: w, height: h, cells, spawn, markers, camps: [] };
}

/** Carve a one-cell dead-end nook off the spawn room and put the stairs up in
 * it — ordinary pathing never routes through a dead end it has no goal in. */
function placeUpNook(
  cells: Uint8Array,
  w: number,
  h: number,
  room: Room,
  spawnCell: Vec,
  mark: (ch: string, x: number, y: number) => void,
): void {
  const idx = (x: number, y: number) => y * w + x;
  const spots: { x: number; y: number }[] = [
    { x: room.x - 1, y: spawnCell.y },
    { x: room.x + room.w, y: spawnCell.y },
    { x: spawnCell.x, y: room.y - 1 },
    { x: spawnCell.x, y: room.y + room.h },
  ];
  for (const s of spots) {
    if (s.x < 1 || s.y < 1 || s.x >= w - 1 || s.y >= h - 1) continue;
    if (cells[idx(s.x, s.y)] === 1) continue;
    // Only carve where exactly one neighbor is floor — that keeps it a dead end.
    let openings = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (cells[idx(s.x + dx, s.y + dy)] === 1) openings++;
    }
    if (openings !== 1) continue;
    cells[idx(s.x, s.y)] = 1;
    mark("<", s.x, s.y);
    return;
  }
  // Cramped spawn room with no clean nook: settle for the spawn-adjacent cell.
  mark("<", spawnCell.x + 1, spawnCell.y);
}

function cavernFloor(rng: Rng, depth: number, band: CryptBand): ZoneMap {
  void depth; // the undercroft has no scripted features below the lord
  const w = band.width;
  const h = band.height;
  const cells = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (rng.next() < 0.58) cells[idx(x, y)] = 1;
    }
  }
  for (let it = 0; it < 4; it++) {
    const next = new Uint8Array(cells);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let floors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && cells[idx(x + dx, y + dy)] === 1) floors++;
          }
        }
        next[idx(x, y)] = floors >= 5 ? 1 : 0;
      }
    }
    cells.set(next);
  }

  // Keep only the largest cave — everything else fills back in.
  const comp = new Int32Array(cells.length).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  let labels = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 1 || comp[i] !== -1) continue;
    const label = labels++;
    let size = 0;
    const stack = [i];
    comp[i] = label;
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const cx = c % w;
      const cy = Math.floor(c / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (cells[n] === 1 && comp[n] === -1) {
          comp[n] = label;
          stack.push(n);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 1 && comp[i] !== bestLabel) cells[i] = 0;
  }

  // Spawn near the cave's north-west reach; stairs down at its far end (BFS).
  let spawnCell: Vec = { x: 2, y: 2 };
  let bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 1) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const d = Math.hypot(x - 3, y - 3);
    if (d < bestD) {
      bestD = d;
      spawnCell = { x, y };
    }
  }
  const dist = new Int32Array(cells.length).fill(-1);
  dist[idx(spawnCell.x, spawnCell.y)] = 0;
  const queue = [spawnCell];
  let far = spawnCell;
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = idx(nx, ny);
      if (cells[n] !== 1 || dist[n] !== -1) continue;
      dist[n] = dist[idx(x, y)]! + 1;
      queue.push({ x: nx, y: ny });
      if (dist[n]! > dist[idx(far.x, far.y)]!) far = { x: nx, y: ny };
    }
  }

  const markers: MapMarker[] = [];
  const taken = new Set<number>([idx(spawnCell.x, spawnCell.y)]);
  const mark = (ch: string, x: number, y: number) => {
    taken.add(idx(x, y));
    markers.push({ ch, x: x + 0.5, y: y + 0.5 });
  };
  mark(">", far.x, far.y);

  // Dead-end nook for the way up, dug out of the wall beside the spawn.
  let nooked = false;
  for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
    const nx = spawnCell.x + dx;
    const ny = spawnCell.y + dy;
    if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
    if (cells[idx(nx, ny)] === 1) continue;
    let openings = 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (cells[idx(nx + ox, ny + oy)] === 1) openings++;
    }
    if (openings !== 1) continue;
    cells[idx(nx, ny)] = 1;
    mark("<", nx, ny);
    nooked = true;
    break;
  }
  if (!nooked) mark("<", spawnCell.x + 1, spawnCell.y);

  const budget = rng.int(band.packs.min, band.packs.max);
  let placed = 0;
  for (let tries = 0; placed < budget && tries < 2000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    if (cells[idx(x, y)] !== 1 || taken.has(idx(x, y))) continue;
    if (Math.hypot(x - spawnCell.x, y - spawnCell.y) < 8) continue;
    mark(band.spawnTable[rng.int(0, band.spawnTable.length - 1)]!, x, y);
    placed++;
  }

  return {
    width: w,
    height: h,
    cells,
    spawn: { x: spawnCell.x + 0.5, y: spawnCell.y + 0.5 },
    markers,
    camps: [],
  };
}
