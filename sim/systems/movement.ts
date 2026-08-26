import { isWalkable, type Vec } from "../map";
import { findPath, smoothPath } from "../path";
import type { GameState, PlayerInput } from "../state";

export function applyMoveInput(state: GameState, input: PlayerInput): void {
  const dest = input.moveTo;
  if (!dest) return;
  const goal = { x: Math.floor(dest.x), y: Math.floor(dest.y) };
  if (!isWalkable(state.map, goal.x, goal.y)) return;
  const start = {
    x: Math.floor(state.player.pos.x),
    y: Math.floor(state.player.pos.y),
  };
  const cells = findPath(state.map, start, goal);
  if (cells === null) return;
  state.player.attackTarget = null;
  state.player.pickupTarget = null;
  state.player.path = smoothPath(state.map, state.player.pos, cells);
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

export function movementSystem(state: GameState): void {
  moveAlongPath(state.player.pos, state.player.path, state.player.speed);
}
