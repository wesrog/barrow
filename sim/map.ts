export interface Vec {
  x: number;
  y: number;
}

export interface MapMarker {
  ch: string;
  x: number;
  y: number;
}

export interface ZoneMap {
  width: number;
  height: number;
  /** 1 = walkable floor, 0 = wall. Row-major, y * width + x. */
  cells: Uint8Array;
  spawn: Vec;
  /** Non-floor marker characters (monster spawns etc.), at cell centers. */
  markers: MapMarker[];
  /** Safe-ground rectangles (half-open, in cells). Empty below ground. */
  camps: { x0: number; y0: number; x1: number; y1: number }[];
}

/** Is this position on any of the map's safe camp grounds? */
export function inCamp(map: ZoneMap, pos: Vec): boolean {
  return map.camps.some(
    (c) => pos.x >= c.x0 && pos.x < c.x1 && pos.y >= c.y0 && pos.y < c.y1,
  );
}

/**
 * Author a map as strings: '#' wall, '.' floor, '@' player spawn (floor).
 * Other marker characters are treated as floor; callers interpret them.
 */
export function mapFromStrings(rows: string[]): ZoneMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const cells = new Uint8Array(width * height);
  let spawn: Vec = { x: 0.5, y: 0.5 };
  const markers: MapMarker[] = [];
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? "#";
      cells[y * width + x] = ch === "#" ? 0 : 1;
      if (ch === "@") spawn = { x: x + 0.5, y: y + 0.5 };
      else if (ch !== "#" && ch !== ".") markers.push({ ch, x: x + 0.5, y: y + 0.5 });
    }
  }
  return { width, height, cells, spawn, markers, camps: [] };
}

/** Grid line-of-sight: sample the segment; blocked if any sample lands in a wall. */
export function hasLineOfSight(map: ZoneMap, a: Vec, b: Vec): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist * 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t);
    const y = Math.floor(a.y + (b.y - a.y) * t);
    if (!isWalkable(map, x, y)) return false;
  }
  return true;
}

export function isWalkable(map: ZoneMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.cells[y * map.width + x] === 1;
}

/** Find the nearest walkable cell to the target position, or null if none exists nearby. */
export function nearestWalkable(map: ZoneMap, target: Vec): Vec | null {
  const cx = Math.floor(target.x);
  const cy = Math.floor(target.y);

  // Check center first
  if (isWalkable(map, cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };

  // Expanding square search up to distance 3
  for (let dist = 1; dist <= 3; dist++) {
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dy = -dist; dy <= dist; dy++) {
        // Only check cells on the perimeter of this square
        if (Math.abs(dx) !== dist && Math.abs(dy) !== dist) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (isWalkable(map, x, y)) return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return null;
}
