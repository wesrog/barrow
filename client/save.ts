import type { Equipment, Inventory } from "../sim/character";
import { recomputePlayerStats } from "../sim/systems/inventory";
import type { SkillId } from "../sim/skills";
import { zoneOf, type GameState } from "../sim/state";

const VERSION = 1;

interface CharacterSave {
  v: number;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  belt: number;
  gold?: number;
  inventory: Inventory;
  equipment: Equipment;
}

export function serializeCharacter(state: GameState): string {
  const p = state.player;
  const save: CharacterSave = {
    v: VERSION,
    level: p.level,
    xp: p.xp,
    skillPoints: p.skillPoints,
    skills: { ...p.skills },
    belt: p.belt,
    gold: p.gold,
    inventory: p.inventory,
    equipment: p.equipment,
  };
  return JSON.stringify(save);
}

/** Restore a saved character onto a fresh game. Returns false on bad data. */
export function applyCharacter(state: GameState, raw: string): boolean {
  let save: CharacterSave;
  try {
    save = JSON.parse(raw);
  } catch {
    return false;
  }
  if (save?.v !== VERSION || typeof save.level !== "number" || !save.equipment || !save.inventory) {
    return false;
  }
  const p = state.player;
  p.level = save.level;
  p.xp = save.xp;
  p.skillPoints = save.skillPoints;
  p.skills = { ...save.skills };
  p.belt = save.belt;
  p.gold = save.gold ?? 0;
  p.inventory = save.inventory;
  p.equipment = save.equipment;
  // Keep item ids clear of the fresh state's counter.
  for (const e of p.inventory.entries) {
    if (e.id >= state.nextId) state.nextId = e.id + 1;
  }
  recomputePlayerStats(state);
  p.life = p.maxLife;
  p.mana = p.maxMana;
  p.pos = { ...zoneOf(state, p).map.spawn };
  return true;
}

const KEY = "barrow-character";

export function saveToStorage(state: GameState): void {
  try {
    localStorage.setItem(KEY, serializeCharacter(state));
  } catch {
    // Storage full or unavailable: the run just isn't saved.
  }
}

export function loadFromStorage(state: GameState): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw !== null && applyCharacter(state, raw);
  } catch {
    return false;
  }
}

export function wipeStorage(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to wipe.
  }
}
