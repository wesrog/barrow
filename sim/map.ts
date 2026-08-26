export interface Vec {
  x: number;
  y: number;
}

export interface ZoneMap {
  width: number;
  height: number;
  /** 1 = walkable floor, 0 = wall. Row-major, y * width + x. */
  cells: Uint8Array;
  spawn: Vec;
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
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? "#";
      cells[y * width + x] = ch === "#" ? 0 : 1;
      if (ch === "@") spawn = { x: x + 0.5, y: y + 0.5 };
    }
  }
  return { width, height, cells, spawn };
}

export function isWalkable(map: ZoneMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.cells[y * map.width + x] === 1;
}
