import { isWalkable, type Vec } from "../map";
import type { GameState } from "../state";
import type { Monster } from "../monsters";

/** The hero's body radius in cells. */
export const PLAYER_RADIUS = 0.35;

/** Body radius of solid map-marker NPCs (the vendor). */
export const NPC_RADIUS = 0.4;

/** Marker characters that are people, not floor decals — walking through is rude. */
const SOLID_MARKERS = new Set(["V"]);

/** Extra passes let packs settle instead of shivering against each other. */
const PASSES = 3;

/** Move `pos` by (dx, dy) only if the destination cell is walkable. */
function nudge(state: GameState, pos: Vec, dx: number, dy: number): boolean {
  const x = pos.x + dx;
  const y = pos.y + dy;
  if (!isWalkable(state.map, Math.floor(x), Math.floor(y))) return false;
  pos.x = x;
  pos.y = y;
  return true;
}

/**
 * Body-blocking: entities are solid circles. Overlaps are fully resolved each
 * tick — the player slides around monsters instead of walking through them,
 * and a pack can wall the player in.
 */
export function collisionSystem(state: GameState): void {
  const p = state.player;
  const monsters = [...state.monsters.values()];
  for (let pass = 0; pass < PASSES; pass++) {
    // Player vs monster: the player yields, so meat walls actually block.
    if (!p.dead) {
      // Static NPCs never budge; the player is always the one ejected.
      for (const marker of state.map.markers) {
        if (!SOLID_MARKERS.has(marker.ch)) continue;
        const dx = p.pos.x - marker.x;
        const dy = p.pos.y - marker.y;
        const d = Math.hypot(dx, dy);
        const overlap = PLAYER_RADIUS + NPC_RADIUS - d;
        if (overlap <= 0) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        nudge(state, p.pos, nx * overlap, ny * overlap);
      }
      for (const m of monsters) {
        const dx = p.pos.x - m.pos.x;
        const dy = p.pos.y - m.pos.y;
        const d = Math.hypot(dx, dy);
        const overlap = PLAYER_RADIUS + m.radius - d;
        if (overlap <= 0) continue;
        // Perfectly stacked: eject the player along +x deterministically.
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        if (!nudge(state, p.pos, nx * overlap, ny * overlap)) {
          // Cornered against a wall: the monster gives way instead.
          nudge(state, m.pos, -nx * overlap, -ny * overlap);
        }
      }
    }
    separatePair(state, monsters);
  }
}

/** Monster vs monster: split the overlap evenly so packs spread out. */
function separatePair(state: GameState, monsters: Monster[]): void {
  for (let i = 0; i < monsters.length; i++) {
    for (let j = i + 1; j < monsters.length; j++) {
      const a = monsters[i]!;
      const b = monsters[j]!;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      const overlap = a.radius + b.radius - d;
      if (overlap <= 0) continue;
      // Perfectly stacked pairs split along a deterministic axis.
      const nx = d > 1e-6 ? dx / d : (a.id < b.id ? 1 : -1);
      const ny = d > 1e-6 ? dy / d : 0;
      const half = overlap / 2;
      const aMoved = nudge(state, a.pos, -nx * half, -ny * half);
      const bMoved = nudge(state, b.pos, nx * half, ny * half);
      // One blocked by a wall: the free one absorbs the full correction.
      if (aMoved && !bMoved) nudge(state, a.pos, -nx * half, -ny * half);
      if (bMoved && !aMoved) nudge(state, b.pos, nx * half, ny * half);
    }
  }
}
