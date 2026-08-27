import { isWalkable, type Vec } from "../map";
import { findPath, smoothPath } from "../path";
import { zoneOf, type GameState, type Player, type PlayerInput } from "../state";

export function applyMoveInput(state: GameState, p: Player, input: PlayerInput): void {
  const dest = input.moveTo;
  if (!dest) return;
  if (p.leap) return; // committed to the air until landing
  const map = zoneOf(state, p).map;
  const goal = { x: Math.floor(dest.x), y: Math.floor(dest.y) };
  if (!isWalkable(map, goal.x, goal.y)) return;
  const start = { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) };
  const cells = findPath(map, start, goal);
  if (cells === null) return;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.vendorTarget = false;
  p.healerTarget = false;
  p.portalTarget = null;
  p.reclaimTarget = null;
  p.path = smoothPath(map, p.pos, cells);
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
