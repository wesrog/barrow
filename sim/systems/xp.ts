import { xpForLevel } from "../character";
import { allPlayers, type GameState, type ZoneId } from "../state";
import { recomputePlayerStats } from "./inventory";

/**
 * Collect xp from this tick's kills and process level-ups. Runs after deathSystem.
 * Interim rule: everyone standing in the kill's zone banks the full amount —
 * A6 replaces this with the party split.
 */
export function xpSystem(state: GameState): void {
  const perZone = new Map<ZoneId, number>();
  for (const e of state.events) {
    if (e.type === "monster_died") perZone.set(e.zone, (perZone.get(e.zone) ?? 0) + e.xp);
  }
  if (perZone.size === 0) return;
  for (const p of allPlayers(state)) {
    const gained = perZone.get(p.zoneId) ?? 0;
    if (gained === 0) continue;
    p.xp += gained;
    while (p.xp >= xpForLevel(p.level + 1)) {
      p.level++;
      p.skillPoints++;
      state.events.push({ type: "level_up", playerId: p.id, level: p.level });
    }
    recomputePlayerStats(state, p);
  }
}
