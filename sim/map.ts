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

/**
 * The closest walkable cell to `at` (cell coordinates; fractions are floored,
 * out-of-bounds points clamped in), or null when nothing opens within `maxR`
 * rings. Deterministic: rings scan in a fixed order, nearest by euclidean
 * distance wins.
 */
export function nearestWalkable(map: ZoneMap, at: Vec, maxR = 8): Vec | null {
  const cx = Math.min(map.width - 1, Math.max(0, Math.floor(at.x)));
  const cy = Math.min(map.height - 1, Math.max(0, Math.floor(at.y)));
  for (let r = 0; r <= maxR; r++) {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring edge only
        const x = cx + dx;
        const y = cy + dy;
        if (!isWalkable(map, x, y)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}
