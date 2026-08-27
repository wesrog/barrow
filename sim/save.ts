import type { Equipment, Inventory } from "./character";
import { recomputePlayerStats } from "./systems/inventory";
import type { SkillId } from "./skills";
import { zoneOf, type GameState, type PlayerId } from "./state";

const VERSION = 1;

export interface CharacterSave {
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

export function serializeCharacter(state: GameState, playerId: PlayerId): string {
  const p = state.players.get(playerId);
  if (!p) return "";
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

/** Restore a saved character onto a freshly joined player. Returns false on bad data. */
export function applyCharacter(state: GameState, playerId: PlayerId, raw: string): boolean {
  const p = state.players.get(playerId);
  if (!p) return false;
  let save: CharacterSave;
  try {
    save = JSON.parse(raw);
  } catch {
    return false;
  }
  if (save?.v !== VERSION || typeof save.level !== "number" || !save.equipment || !save.inventory) {
    return false;
  }
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
  recomputePlayerStats(state, p);
  p.life = p.maxLife;
  p.mana = p.maxMana;
  p.pos = { ...zoneOf(state, p).map.spawn };
  return true;
}
