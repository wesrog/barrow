import { applyCharacter, serializeCharacter } from "../sim/save";
import type { GameState, PlayerId } from "../sim/state";

export { applyCharacter, serializeCharacter };
export type { CharacterSave } from "../sim/save";

const KEY = "barrow-character";

export function saveToStorage(state: GameState, playerId: PlayerId): void {
  try {
    localStorage.setItem(KEY, serializeCharacter(state, playerId));
  } catch {
    // Storage full or unavailable: the run just isn't saved.
  }
}

/** The raw saved character, if any — handed to the sim as a join payload. */
export function loadRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadFromStorage(state: GameState, playerId: PlayerId): boolean {
  const raw = loadRaw();
  return raw !== null && applyCharacter(state, playerId, raw);
}

export function wipeStorage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to wipe.
  }
}
