// Town-dressing motion: NPCs stroll a little around their home spot so the
// camps feel lived-in. Pure ambience — no fighting, no leaving the area.

import { hasLineOfSight, isWalkable } from "../map";
import type { GameState, Player, ZoneState } from "../state";

/** How far (in cells, per axis) a stroll may take an NPC from home. */
export const NPC_WANDER_RADIUS = 2;

/** With a player this close, the NPC stops and gives them their attention. */
export const NPC_HOLD_RANGE = 3;

/** Stroll pace in cells per tick — a dawdle next to the player's run. */
const NPC_STEP = 1.0 / 25;

export function npcWanderSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const npc of zone.npcs.values()) {
    // Company trumps pacing: freeze mid-stride and pick it back up later.
    const attended = players.some(
      (p) => Math.hypot(p.pos.x - npc.pos.x, p.pos.y - npc.pos.y) <= NPC_HOLD_RANGE,
    );
    if (attended) continue;

    if (npc.waitTicks > 0) {
      npc.waitTicks--;
      continue;
    }

    if (npc.wanderTarget === null) {
      const cx = Math.floor(npc.home.x) + state.rng.int(-NPC_WANDER_RADIUS, NPC_WANDER_RADIUS);
      const cy = Math.floor(npc.home.y) + state.rng.int(-NPC_WANDER_RADIUS, NPC_WANDER_RADIUS);
      const target = { x: cx + 0.5, y: cy + 0.5 };
      // Only straight, unobstructed ambles — anything fancier waits a beat and re-rolls.
      if (!isWalkable(zone.map, cx, cy) || !hasLineOfSight(zone.map, npc.pos, target)) {
        npc.waitTicks = 25;
        continue;
      }
      npc.wanderTarget = target;
    }

    const dx = npc.wanderTarget.x - npc.pos.x;
    const dy = npc.wanderTarget.y - npc.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= NPC_STEP) {
      npc.pos.x = npc.wanderTarget.x;
      npc.pos.y = npc.wanderTarget.y;
      npc.wanderTarget = null;
      npc.waitTicks = state.rng.int(2 * 25, 8 * 25);
    } else {
      npc.pos.x += (dx / d) * NPC_STEP;
      npc.pos.y += (dy / d) * NPC_STEP;
    }
  }
}
