import { isSecret, revealSecrets, secretRunAt } from "../map";
import type { GameState, Player, ZoneState } from "../state";

/**
 * Hidden passages open when a player brushes one: any secret cell in the
 * eight around a player's cell reveals the whole run it belongs to, and the
 * event tells the renderer which cells just became floor.
 */
export function secretSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  const map = zone.map;
  for (const p of players) {
    const cx = Math.floor(p.pos.x);
    const cy = Math.floor(p.pos.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!isSecret(map, cx + dx, cy + dy)) continue;
        const cells = secretRunAt(map, cx + dx, cy + dy);
        revealSecrets(map, cells);
        state.events.push({ type: "secret_found", playerId: p.id, cells, zone: zone.id });
      }
    }
  }
}
