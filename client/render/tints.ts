import type { ChampionId } from "../../sim/champions";

/**
 * One colour per seat (0..3). The same four run through the 3D heroes, their
 * nameplates, the minimap dots and the party strip, so a player reads as the
 * same colour everywhere on screen.
 */
export const PLAYER_TINTS = [0xd8cfa8, 0x9ad1f5, 0xa8d8a8, 0xd8a8c8] as const;

export function playerTint(id: number): number {
  return PLAYER_TINTS[id % PLAYER_TINTS.length]!;
}

/** The same tint as a CSS hex, for DOM overlays and the HUD. */
export function playerCss(id: number): string {
  return `#${playerTint(id).toString(16).padStart(6, "0")}`;
}

/** One colour per champion kind: the ground ring and the overhead nameplate. */
export const CHAMPION_TINTS: Record<ChampionId, number> = {
  swift: 0x7fd4e8, // pale rushing blue
  brutal: 0xe8704c, // raw ember orange
  bulwark: 0xc9a84c, // shieldwall gold
  volatile: 0xa8e04c, // sick bile green
  dread: 0xb06ae8, // royal grave violet
};

export function championCss(id: ChampionId): string {
  return `#${CHAMPION_TINTS[id].toString(16).padStart(6, "0")}`;
}
