import { isWalkable, type ZoneMap } from "./map";

export interface Cell {
  x: number;
  y: number;
}

/**
 * A* over the walk grid, 8-directional, no corner cutting.
 * Returns the sequence of cells from the first step to the goal (start excluded),
 * or null if unreachable. Deterministic: ties break by insertion order.
 */
export function findPath(map: ZoneMap, start: Cell, goal: Cell): Cell[] | null {
  if (!isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const key = (x: number, y: number) => y * map.width + x;
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  // Simple binary-less open list; maps are small enough in v0.1.
  const open: { k: number; x: number; y: number; f: number }[] = [
    { k: startKey, x: start.x, y: start.y, f: 0 },
  ];
  const closed = new Set<number>();

  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0]!;
    if (current.k === goalKey) {
      const path: Cell[] = [];
      let k: number | undefined = goalKey;
      while (k !== undefined && k !== startKey) {
        path.push({ x: k % map.width, y: Math.floor(k / map.width) });
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }
    if (closed.has(current.k)) continue;
    closed.add(current.k);

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
