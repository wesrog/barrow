// The character roster: every hero this browser has created, kept in
// localStorage. The lobby picks (or creates) one before a game starts; the
// in-game autosave writes back into the picked slot. The pre-roster single
// save ("barrow-character") is migrated into a slot on first load.

import { newCharacterRaw, type CharacterSave } from "../sim/save";
import type { Klass } from "../sim/skills";

export interface RosterEntry {
  id: string;
  /** CharacterSave JSON — exactly what rides the join payload. */
  raw: string;
}

interface Roster {
  v: 1;
  /** The slot the last game was started with; autosaves land here. */
  current: string | null;
  chars: RosterEntry[];
}

/** What the lobby shows per slot, parsed out of the save payload. */
export interface CharacterSummary {
  id: string;
  name: string;
  klass: Klass;
  level: number;
}

const KEY = "barrow-roster";
const LEGACY_KEY = "barrow-character";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRoster(roster: Roster): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(roster));
  } catch {
    // Storage full or unavailable: the roster just isn't saved.
  }
}

function loadRoster(): Roster {
  const raw = readStorage(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Roster;
      if (parsed?.v === 1 && Array.isArray(parsed.chars)) return parsed;
    } catch {
      // Corrupt roster: fall through to a fresh one.
    }
  }
  const roster: Roster = { v: 1, current: null, chars: [] };
  // One-time migration: the old single-save key becomes the first slot.
  const legacy = readStorage(LEGACY_KEY);
  if (legacy) {
    const id = newId();
    roster.chars.push({ id, raw: legacy });
    roster.current = id;
    writeRoster(roster);
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // The copy in the roster is authoritative either way.
    }
  }
  return roster;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function summarize(entry: RosterEntry): CharacterSummary {
  let name = "Wanderer";
  let klass: Klass = "warrior";
  let level = 1;
  try {
    const save = JSON.parse(entry.raw) as CharacterSave;
    if (typeof save.name === "string" && save.name.trim()) name = save.name;
    if (save.klass === "witch") klass = "witch";
    if (Number.isFinite(save.level)) level = save.level;
  } catch {
    // Unreadable save: show the placeholder identity; the sim will reject it on join.
  }
  return { id: entry.id, name, klass, level };
}

export function listCharacters(): CharacterSummary[] {
  return loadRoster().chars.map(summarize);
}

export function createCharacter(name: string, klass: Klass): CharacterSummary {
  const roster = loadRoster();
  const entry: RosterEntry = { id: newId(), raw: newCharacterRaw(name, klass) };
  roster.chars.push(entry);
  roster.current = entry.id;
  writeRoster(roster);
  return summarize(entry);
}

export function deleteCharacter(id: string): void {
  const roster = loadRoster();
  roster.chars = roster.chars.filter((c) => c.id !== id);
  if (roster.current === id) roster.current = null;
  writeRoster(roster);
}

/** Mark the slot autosaves should land in and return its payload. */
export function selectCharacter(id: string): string | null {
  const roster = loadRoster();
  const entry = roster.chars.find((c) => c.id === id);
  if (!entry) return null;
  roster.current = id;
  writeRoster(roster);
  return entry.raw;
}

export function currentCharacterId(): string | null {
  return loadRoster().current;
}

/** The world seed a slot's hero last played in, if their save recorded one. */
export function worldSeedOf(id: string): number | null {
  const entry = loadRoster().chars.find((c) => c.id === id);
  if (!entry) return null;
  try {
    const save = JSON.parse(entry.raw) as CharacterSave;
    return Number.isFinite(save.worldSeed) ? save.worldSeed! : null;
  } catch {
    return null;
  }
}

/** Autosave: overwrite the current slot's payload. No current slot, no save. */
export function saveCurrent(raw: string): void {
  const roster = loadRoster();
  const entry = roster.chars.find((c) => c.id === roster.current);
  if (!entry) return;
  entry.raw = raw;
  writeRoster(roster);
}

/** Bury the current character: remove its slot entirely. */
export function deleteCurrent(): void {
  const roster = loadRoster();
  if (roster.current) deleteCharacter(roster.current);
}
