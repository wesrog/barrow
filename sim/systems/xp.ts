import { xpForLevel } from "../character";
import type { GameState } from "../state";
import { recomputePlayerStats } from "./inventory";

/** Collect xp from this tick's kills and process level-ups. Runs after deathSystem. */
export function xpSystem(state: GameState): void {
  const p = state.player;
  let gained = 0;
  for (const e of state.events) {
    if (e.type === "monster_died") gained += e.xp;
  }
  if (gained === 0) return;
  p.xp += gained;
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level++;
    p.skillPoints++;
    state.events.push({ type: "level_up", level: p.level });
  }
  recomputePlayerStats(state);
}
