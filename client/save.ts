import { applyCharacter, serializeCharacter } from "../sim/save";
import type { GameState, PlayerId } from "../sim/state";
import { deleteCurrent, saveCurrent } from "./roster";

export { applyCharacter, serializeCharacter };
export type { CharacterSave } from "../sim/save";

/** Autosave the live character into its roster slot (picked in the lobby). */
export function saveToStorage(state: GameState, playerId: PlayerId): void {
  const raw = serializeCharacter(state, playerId);
  if (raw) saveCurrent(raw);
}

/** Bury the current character: the roster slot is gone for good. */
export function wipeStorage(): void {
  deleteCurrent();
}
