import { DUNGEON_STYLES, type DungeonDef } from "./dungeons";
import type { MapMarker, ZoneMap } from "./map";
import type { Rng } from "./rng";

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/**
 * One dungeon floor: scattered rooms joined by L-corridors, optionally eroded
 * into cave-like warrens. Connectivity is by construction — corridors join
 * every room to the previous one, and erosion only ever turns wall into floor
 * beside existing floor — so no seal pass is needed.
 */
export function generateDungeonFloor(rng: Rng, def: DungeonDef, floor: number): ZoneMap {
  const style = DUNGEON_STYLES[def.style];
  const { width: w, height: h } = style;
  const cells = new Uint8Array(w * h); // all wall
  const idx = (x: number, y: number) => y * w + x;

  // --- Rooms: rejection-scatter non-overlapping rects inside a 2-cell rim ---
  const rooms: Room[] = [];
  for (let tries = 0; rooms.length < style.rooms.count && tries < 400; tries++) {
    const rw = rng.int(style.rooms.wMin, style.rooms.wMax);
    const rh = rng.int(style.rooms.hMin, style.rooms.hMax);
    const rx = rng.int(2, w - rw - 3);
    const ry = rng.int(2, h - rh - 3);
    const r = { x: rx, y: ry, w: rw, h: rh };
    // 1-cell gap between rooms so walls stay readable.
    const clash = rooms.some(
      (o) => rx < o.x + o.w + 1 && o.x < rx + rw + 1 && ry < o.y + o.h + 1 && o.y < ry + rh + 1,
    );
    if (clash) continue;
    rooms.push(r);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) cells[idx(x, y)] = 1;
    }
  }

  // --- Corridors: each room L-joins the previous; the chain connects all ---
  const carve = (x: number, y: number): void => {
    for (let o = 0; o < style.corridor; o++) {
      const yy = Math.min(h - 3, y + o);
      const xx = Math.min(w - 3, x + o);
      cells[idx(x, yy)] = 1;
      cells[idx(xx, y)] = 1;
    }
  };
  for (let i = 1; i < rooms.length; i++) {
    const a = center(rooms[i - 1]!);
    const b = center(rooms[i]!);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(b.x, y);
  }

  // --- Erosion: wall beside 3+ floor cells may crumble. Only adds floor
  // touching existing floor, so connectivity is preserved by construction. ---
  if (style.erode > 0) {
    const before = new Uint8Array(cells);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        if (before[idx(x, y)] === 1) continue;
        let floors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && before[idx(x + dx, y + dy)] === 1) floors++;
          }
        }
        if (floors >= 3 && rng.next() < style.erode) cells[idx(x, y)] = 1;
      }
    }
  }

  // --- Fixed features. Up-stairs in the first room; spawn beside them.
  // Down-stairs (or the boss vault) in the room farthest from the first. ---
  const first = center(rooms[0]!);
  const markers: MapMarker[] = [{ ch: "<", x: first.x + 0.5, y: first.y + 0.5 }];
  const spawn = { x: first.x + 1.5, y: first.y + 0.5 }; // rooms are ≥4 wide, in-bounds
  let far = rooms[rooms.length - 1]!;
  let farDist = -1;
  for (const r of rooms.slice(1)) {
    const c = center(r);
    const d = Math.hypot(c.x - first.x, c.y - first.y);
    if (d > farDist) {
      farDist = d;
      far = r;
    }
  }
  const vault = center(far);
  if (floor < def.floors) {
    markers.push({ ch: ">", x: vault.x + 0.5, y: vault.y + 0.5 });
  } else {
    markers.push({ ch: "!", x: vault.x + 0.5, y: vault.y + 0.5 });
    markers.push({ ch: "$", x: vault.x + 1.5, y: vault.y + 0.5 });
  }

  // --- Monster packs on floor cells, clear of spawn and vault ---
  const taken = new Set<number>(markers.map((m) => idx(Math.floor(m.x), Math.floor(m.y))));
  taken.add(idx(Math.floor(spawn.x), Math.floor(spawn.y)));
  let placed = 0;
  for (let tries = 0; placed < style.packs && tries < 2000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const key = idx(x, y);
    if (cells[key] !== 1 || taken.has(key)) continue;
    if (Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 8) continue;
    if (Math.hypot(x + 0.5 - vault.x, y + 0.5 - vault.y) < 4) continue;
    taken.add(key);
    markers.push({ ch: def.spawnTable[rng.int(0, def.spawnTable.length - 1)]!, x: x + 0.5, y: y + 0.5 });
    placed++;
  }

  return { width: w, height: h, cells, spawn, markers, camps: [] };
}
