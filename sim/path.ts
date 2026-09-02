import { isWalkable, type Vec, type ZoneMap } from "./map";

export interface Cell {
  x: number;
  y: number;
}

/** A corridor wide enough for a body: the line plus two offset rails must be clear. */
function walkableLine(map: ZoneMap, a: Vec, b: Vec): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1e-6) return true;
  const nx = (-(b.y - a.y) / dist) * 0.3;
  const ny = ((b.x - a.x) / dist) * 0.3;
  const steps = Math.max(1, Math.ceil(dist * 5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (
      !isWalkable(map, Math.floor(x), Math.floor(y)) ||
      !isWalkable(map, Math.floor(x + nx), Math.floor(y + ny)) ||
      !isWalkable(map, Math.floor(x - nx), Math.floor(y - ny))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The farthest point along the segment from `a` toward `b` that a body-wide
 * corridor reaches: the walk stops at the first blocked sample. Returns `b`
 * when the whole line is clear, and a point at (or just past) `a` when the
 * very first step is blocked.
 */
export function furthestWalkable(map: ZoneMap, a: Vec, b: Vec): Vec {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1e-6) return { ...b };
  const nx = (-(b.y - a.y) / dist) * 0.3;
  const ny = ((b.x - a.x) / dist) * 0.3;
  const steps = Math.max(1, Math.ceil(dist * 5));
  let last = { ...a };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (
      !isWalkable(map, Math.floor(x), Math.floor(y)) ||
      !isWalkable(map, Math.floor(x + nx), Math.floor(y + ny)) ||
      !isWalkable(map, Math.floor(x - nx), Math.floor(y - ny))
    ) {
      return last;
    }
    last = { x, y };
  }
  return last;
}

/**
 * String-pulling: drop every waypoint that can be skipped in a straight,
 * body-wide line. Turns A*'s staircase into a few clean legs.
 */
export function smoothPath(map: ZoneMap, start: Vec, cells: Cell[]): Vec[] {
  const pts = cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  const out: Vec[] = [];
  let cur = start;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    for (; j > i; j--) {
      if (walkableLine(map, cur, pts[j]!)) break;
    }
    out.push(pts[j]!);
    cur = pts[j]!;
    i = j + 1;
  }
  return out;
}

/**
 * A* over the walk grid, 8-directional, no corner cutting.
 * Returns the sequence of cells from the first step to the goal (start excluded),
 * or null if unreachable. Deterministic: ties break by insertion order.
 */
export function findPath(
  map: ZoneMap,
  start: Cell,
  goal: Cell,
  maxExpanded = 6000,
): Cell[] | null {
  if (!isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const key = (x: number, y: number) => y * map.width + x;
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);

  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  // Simple binary-less open list; maps are small enough in v0.1.
  const open: { k: number; x: number; y: number; f: number }[] = [
    { k: startKey, x: start.x, y: start.y, f: 0 },
  ];
  const closed = new Set<number>();

  // Best-effort fallback: the expanded node nearest the goal, so a capped
  // search still walks toward a far click instead of standing still.
  let bestKey = startKey;
  let bestH = heuristic(start.x, start.y);

  const reconstruct = (fromKey: number): Cell[] => {
    const path: Cell[] = [];
    let k: number | undefined = fromKey;
    while (k !== undefined && k !== startKey) {
      path.push({ x: k % map.width, y: Math.floor(k / map.width) });
      k = cameFrom.get(k);
    }
    path.reverse();
    return path;
  };

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0]!;
    if (current.k === goalKey) {
      return reconstruct(goalKey);
    }
    if (closed.has(current.k)) continue;
    closed.add(current.k);

    const h = heuristic(current.x, current.y);
    if (h < bestH) {
      bestH = h;
      bestKey = current.k;
    }
    if (closed.size > maxExpanded) {
      return bestKey === startKey ? null : reconstruct(bestKey);
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (!isWalkable(map, nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          // No corner cutting: both orthogonal neighbors must be open.
          if (!isWalkable(map, current.x + dx, current.y)) continue;
          if (!isWalkable(map, current.x, current.y + dy)) continue;
        }
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const stepCost = dx !== 0 && dy !== 0 ? 1.4142 : 1;
        const g = gScore.get(current.k)! + stepCost;
        const prior = gScore.get(nk);
        if (prior !== undefined && prior <= g) continue;
        gScore.set(nk, g);
        cameFrom.set(nk, current.k);
        open.push({ k: nk, x: nx, y: ny, f: g + heuristic(nx, ny) });
      }
    }
  }
  return null;
}
