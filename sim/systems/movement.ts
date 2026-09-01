import { isWalkable, nearestWalkable, type Vec, type ZoneMap } from "../map";
import { findPath, smoothPath } from "../path";
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

export function applyMoveInput(state: GameState, p: Player, input: PlayerInput): void {
  const dest = input.moveTo;
  if (!dest) return;
  if (p.leap) return; // committed to the air until landing
  const map = zoneOf(state, p).map;
  const path = approachPath(map, p.pos, dest);
  if (path === null) return;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.npcTarget = null;
  p.portalTarget = null;
  p.reclaimTarget = null;
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
