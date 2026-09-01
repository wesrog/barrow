import { xpForLevel } from "../character";
import type { Vec } from "../map";
import { playerIds, type GameState, type Player, type PlayerId, type ZoneId } from "../state";
import { recomputePlayerStats } from "./inventory";

/** Players within this many cells of a kill (besides the killer) share in its xp. */
export const XP_SHARE_RADIUS = 10;

/** Each additional eligible player beyond the first adds this fraction to the pot. */
export const PARTY_BONUS = 0.35;

/**
 * Split a kill's xp among eligible players: living, in the kill's zone, and
 * either the killer or within XP_SHARE_RADIUS of the kill position. The
 * killer is always eligible when alive and in the zone, regardless of
 * distance. A null killer (e.g. an explosion chain) means only proximity
 * counts. Each eligible player's share includes a bonus for grouping up.
 */
export function xpShares(
  state: GameState,
  zone: ZoneId,
  pos: Vec,
  killer: PlayerId | null,
  xp: number,
): Map<PlayerId, number> {
  const shares = new Map<PlayerId, number>();
  const eligible = playerIds(state).filter((id) => {
    const p = state.players.get(id)!;
    if (p.dead || p.zoneId !== zone) return false;
    if (id === killer) return true;
    return Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= XP_SHARE_RADIUS;
  });
  const n = eligible.length;
  if (n === 0) return shares;
  const share = Math.floor((xp / n) * (1 + PARTY_BONUS * (n - 1)));
  for (const id of eligible) shares.set(id, share);
  return shares;
}

/**
 * Kills far below a player's level fade out as a source of xp: full value
 * within 5 levels, then -15% per level of gap, floored at 5%. Per recipient —
 * party members above and below the monster's level are penalized separately.
 */
export function xpPenalty(playerLevel: number, mlvl: number): number {
  const gap = playerLevel - mlvl;
  if (gap <= 5) return 1;
  return Math.max(0.05, 1 - (gap - 5) * 0.15);
}

/** Add xp and process level-ups; a new level refills life and mana. */
export function grantXp(state: GameState, p: Player, gained: number): void {
  if (gained <= 0) return;
  p.xp += gained;
  let leveled = false;
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level++;
    p.skillPoints++;
    leveled = true;
    state.events.push({ type: "level_up", playerId: p.id, level: p.level });
  }
  recomputePlayerStats(state, p);
  if (leveled) { p.life = p.maxLife; p.mana = p.maxMana; }
}

/**
 * Collect xp from this tick's kills and process level-ups. Runs after deathSystem.
 * Each kill's xp splits among the killer and nearby party members via xpShares,
 * then each share fades by that player's xpPenalty against the monster's level.
 */
export function xpSystem(state: GameState): void {
  const gains = new Map<PlayerId, number>();
  for (const e of state.events) {
    if (e.type !== "monster_died") continue;
    const shares = xpShares(state, e.zone, e.pos, e.killer, e.xp);
    for (const [id, amount] of shares) {
      const p = state.players.get(id)!;
      const faded = Math.floor(amount * xpPenalty(p.level, e.mlvl));
      gains.set(id, (gains.get(id) ?? 0) + faded);
    }
  }
  if (gains.size === 0) return;
  for (const [id, gained] of gains) {
    const p = state.players.get(id);
    if (p) grantXp(state, p, gained);
  }
}
