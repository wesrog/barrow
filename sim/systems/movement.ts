import { isWalkable, nearestWalkable, type Vec, type ZoneMap } from "../map";
import { findPath, furthestWalkable, smoothPath } from "../path";
import { zoneOf, type GameState, type Player, type PlayerInput } from "../state";

/**
 * A path from `from` toward `target`, walking up to the nearest open cell when
 * the target itself sits in blocked ground (a click on a tree, loot thrown into
 * one). Ends on the exact target point when its cell is open, so approaches
 * don't quantize to cell centers. Null when no ground opens near the target.
 */
export function approachPath(map: ZoneMap, from: Vec, target: Vec): Vec[] | null {
  const goal = nearestWalkable(map, target);
  if (!goal) return null;
  const cells = findPath(map, { x: Math.floor(from.x), y: Math.floor(from.y) }, goal);
  if (cells === null) return null;
  const path = smoothPath(map, from, cells);
  if (isWalkable(map, Math.floor(target.x), Math.floor(target.y))) {
    // Land on the click, not the cell center under it.
    path.pop();
    path.push({ ...target });
  }
  return path;
}

// A move click whose route around a barrier costs more than this factor of the
// straight-line distance (plus slack for short hops) is treated as blocked:
// the player walks toward the click and stops at the barrier instead of being
// committed to a long detour they can't see the cost of.
const DETOUR_FACTOR = 2;
const DETOUR_SLACK = 3;

function pathLength(from: Vec, path: Vec[]): number {
  let len = 0;
  let prev = from;
  for (const wp of path) {
    len += Math.hypot(wp.x - prev.x, wp.y - prev.y);
    prev = wp;
  }
  return len;
}

export function applyMoveInput(state: GameState, p: Player, input: PlayerInput): void {
  const dest = input.moveTo;
  if (!dest) return;
  if (p.leap) return; // committed to the air until landing
  const map = zoneOf(state, p).map;
  let path = approachPath(map, p.pos, dest);
  if (path === null) return;
  const direct = Math.hypot(dest.x - p.pos.x, dest.y - p.pos.y);
  if (pathLength(p.pos, path) > direct * DETOUR_FACTOR + DETOUR_SLACK) {
    const stop = furthestWalkable(map, p.pos, dest);
    path = Math.hypot(stop.x - p.pos.x, stop.y - p.pos.y) > 1e-3 ? [stop] : [];
  }
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.npcTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.castTarget = null;
  p.path = path;
}

/** Advance a position along waypoints by `budget` distance. Mutates `path`. */
export function moveAlongPath(pos: Vec, path: Vec[], budget: number): void {
  while (budget > 0 && path.length > 0) {
    const wp = path[0]!;
    const dx = wp.x - pos.x;
    const dy = wp.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      pos.x = wp.x;
      pos.y = wp.y;
      path.shift();
      budget -= dist;
    } else {
      pos.x += (dx / dist) * budget;
      pos.y += (dy / dist) * budget;
      budget = 0;
    }
  }
}

export function movementSystem(players: Player[]): void {
  for (const p of players) moveAlongPath(p.pos, p.path, p.speed);
}
