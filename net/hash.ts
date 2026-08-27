import { playerIds } from "../sim/state";
import type { GameState } from "../sim/state";

/** ~2 s of ticks at 25 Hz — how often a client rides a hash on its input message. */
export const HASH_EVERY_TICKS = 50;

/** FNV-1a 32-bit over a string. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cheap desync tripwire: FNV-1a over tick, each player's (id, zoneId, x, y,
 * life, gold), each zone's monster count. Positions via Math.round(v * 256)
 * so float jitter that shouldn't happen still hashes identically bit-for-bit
 * across peers running the same sim.
 */
export function stateHash(state: GameState): number {
  const parts: (string | number)[] = [state.tick];
  for (const id of playerIds(state)) {
    const p = state.players.get(id)!;
    parts.push(
      p.id,
      p.zoneId,
      Math.round(p.pos.x * 256),
      Math.round(p.pos.y * 256),
      p.life,
      p.gold,
    );
  }
  for (const zone of state.zones.values()) {
    parts.push(zone.monsters.size);
  }
  return fnv1a(parts.join(","));
}
