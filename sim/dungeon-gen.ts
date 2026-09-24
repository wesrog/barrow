import { DUNGEON_STYLES, type DungeonDef } from "./dungeons";
import { SECRET, type MapMarker, type ZoneMap } from "./map";
import type { Rng } from "./rng";

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  /** An open hall: bigger than a room, crowded, ringed with a rune floor. */
  hall: boolean;
}

const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/**
 * Set-piece rooms, one marker each at the room's centre. The renderer dresses
 * them (throne, gaol, library, ritual circle); the sim treats them as floor.
 * Assigned to spare rooms in this order, so small floors get the first few.
 */
export const SET_PIECES = ["K", "G", "L", "P"] as const;
/** Every open hall carries this at its centre: the rune floor and its braziers. */
export const HALL_MARKER = "R";

/**
 * One dungeon floor: scattered rooms joined by L-corridors, a couple of open
 * halls each crowded with a pack, hidden passages that open when a player
 * brushes their wall, and set-piece rooms for the renderer to dress. Rooms
 * chain to the previous one, so the visible map is connected by construction;
 * secret runs only ever add floor; erosion only turns wall into floor beside
 * existing floor.
 */
export function generateDungeonFloor(rng: Rng, def: DungeonDef, floor: number): ZoneMap {
  const style = DUNGEON_STYLES[def.style];
  const { width: w, height: h } = style;
  const cells = new Uint8Array(w * h); // all wall
  const idx = (x: number, y: number) => y * w + x;

  // --- Halls and rooms: rejection-scatter non-overlapping rects inside a 2-cell rim ---
  const rooms: Room[] = [];
  const scatter = (count: number, wMin: number, wMax: number, hMin: number, hMax: number, hall: boolean) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < 400; tries++) {
      const rw = rng.int(wMin, wMax);
      const rh = rng.int(hMin, hMax);
      const rx = rng.int(2, w - rw - 3);
      const ry = rng.int(2, h - rh - 3);
      // 1-cell gap between rooms so walls stay readable.
      const clash = rooms.some(
        (o) => rx < o.x + o.w + 1 && o.x < rx + rw + 1 && ry < o.y + o.h + 1 && o.y < ry + rh + 1,
      );
      if (clash) continue;
      rooms.push({ x: rx, y: ry, w: rw, h: rh, hall });
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) cells[idx(x, y)] = 1;
      }
      placed++;
    }
  };
  // Halls go down first, since the big rects are the ones that fail to fit;
  // rooms then fill in around them. The array keeps rooms first so the entry
  // stairs and the corridor chain start in an ordinary room.
  scatter(style.halls.count, style.halls.wMin, style.halls.wMax, style.halls.hMin, style.halls.hMax, true);
  scatter(style.rooms.count, style.rooms.wMin, style.rooms.wMax, style.rooms.hMin, style.rooms.hMax, false);
  rooms.sort((a, b) => Number(a.hall) - Number(b.hall));

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

  // --- Hidden passages: a one-wide L between two rooms that are not chain
  // neighbours, laid only through solid wall (existing floor stays floor), a
  // chest at the middle of the run. Nothing walks it until a player brushes
  // one of its ends and the run opens. ---
  const markers: MapMarker[] = [];
  const roomsForSecrets = rooms.length;
  for (let n = 0; n < style.secrets && roomsForSecrets >= 4; n++) {
    let dug = false;
    for (let tries = 0; tries < 12 && !dug; tries++) {
      const i = rng.int(0, roomsForSecrets - 1);
      const j = rng.int(0, roomsForSecrets - 1);
      if (Math.abs(i - j) < 2) continue;
      const a = center(rooms[i]!);
      const b = center(rooms[j]!);
      // Walk the L one cell at a time so the run is contiguous.
      const path: { x: number; y: number }[] = [];
      for (let x = a.x; x !== b.x; x += Math.sign(b.x - a.x)) path.push({ x, y: a.y });
      for (let y = a.y; y !== b.y; y += Math.sign(b.y - a.y)) path.push({ x: b.x, y });
      const wallCells = path.filter((c) => cells[idx(c.x, c.y)] === 0 && c.x >= 1 && c.x < w - 1 && c.y >= 1 && c.y < h - 1);
      if (wallCells.length < 3) continue;
      for (const c of wallCells) cells[idx(c.x, c.y)] = SECRET;
      const mid = wallCells[Math.floor(wallCells.length / 2)]!;
      markers.push({ ch: "$", x: mid.x + 0.5, y: mid.y + 0.5 });
      dug = true;
    }
  }

  // --- Fixed features. Up-stairs in the first room; spawn beside them.
  // Down-stairs (or the boss vault) in the room farthest from the first;
  // halls keep their crowds and never host the vault. ---
  const first = center(rooms[0]!);
  markers.push({ ch: "<", x: first.x + 0.5, y: first.y + 0.5 });
  const spawn = { x: first.x + 1.5, y: first.y + 0.5 }; // rooms are ≥4 wide, in-bounds
  let far = rooms[rooms.length - 1]!;
  let farDist = -1;
  for (const r of rooms.slice(1)) {
    if (r.hall && rooms.some((o) => !o.hall && o !== rooms[0])) continue;
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

  // --- Halls: a rune floor at the centre and a crowd spread over the hall ---
  const taken = new Set<number>(markers.map((m) => idx(Math.floor(m.x), Math.floor(m.y))));
  taken.add(idx(Math.floor(spawn.x), Math.floor(spawn.y)));
  const pick = () => def.spawnTable[rng.int(0, def.spawnTable.length - 1)]!;
  for (const hall of rooms.filter((r) => r.hall)) {
    const c = center(hall);
    markers.push({ ch: HALL_MARKER, x: c.x + 0.5, y: c.y + 0.5 });
    taken.add(idx(c.x, c.y));
    let crowd = 0;
    for (let tries = 0; crowd < style.halls.pack && tries < 60; tries++) {
      const x = rng.int(hall.x, hall.x + hall.w - 1);
      const y = rng.int(hall.y, hall.y + hall.h - 1);
      const key = idx(x, y);
      if (taken.has(key) || Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 8) continue;
      taken.add(key);
      markers.push({ ch: pick(), x: x + 0.5, y: y + 0.5 });
      crowd++;
    }
  }

  // --- Set pieces in the spare rooms: throne, gaol, library, ritual circle
  // (the circle draws a small congregation) ---
  const spare = rooms.filter((r) => !r.hall && r !== rooms[0] && r !== far);
  for (let i = spare.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [spare[i], spare[j]] = [spare[j]!, spare[i]!];
  }
  SET_PIECES.forEach((ch, i) => {
    const room = spare[i];
    if (!room) return;
    const c = center(room);
    markers.push({ ch, x: c.x + 0.5, y: c.y + 0.5 });
    taken.add(idx(c.x, c.y));
    if (ch === "P") {
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2]] as const) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (cells[idx(x, y)] !== 1 || taken.has(idx(x, y))) continue;
        if (Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 8) continue;
        taken.add(idx(x, y));
        markers.push({ ch: pick(), x: x + 0.5, y: y + 0.5 });
      }
    }
  });

  // --- Monster packs on floor cells, clear of spawn and vault ---
  let placed = 0;
  for (let tries = 0; placed < style.packs && tries < 2000; tries++) {
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const key = idx(x, y);
    if (cells[key] !== 1 || taken.has(key)) continue;
    if (Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y) < 8) continue;
    if (Math.hypot(x + 0.5 - vault.x, y + 0.5 - vault.y) < 4) continue;
    taken.add(key);
    markers.push({ ch: pick(), x: x + 0.5, y: y + 0.5 });
    placed++;
  }

  return { width: w, height: h, cells, spawn, markers, camps: [] };
}
