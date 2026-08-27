import { createEquipment, createInventory, type Equipment, type Inventory } from "./character";
import { recomputePlayerStats } from "./systems/inventory";
import { rollDurability } from "./items/generate";
import type { Klass, SkillId } from "./skills";
import { zoneOf, type GameState, type PlayerId } from "./state";

const VERSION = 1;

export interface CharacterSave {
  v: number;
  /** Missing on saves from before characters had an identity. */
  name?: string;
  klass?: Klass;
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
    name: p.name,
    klass: p.klass,
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

/** Each class's starting weapon — bare fists are for corpses. */
const STARTING_WEAPON: Record<Klass, { baseId: string; name: string }> = {
  warrior: { baseId: "rusted_blade", name: "Rusted Blade" },
  witch: { baseId: "gnarled_staff", name: "Gnarled Staff" },
};

/** A brand-new level-1 character of the given class, as a save payload. */
export function newCharacterRaw(name: string, klass: Klass): string {
  const equipment = createEquipment();
  const weapon = STARTING_WEAPON[klass];
  equipment.weapon = {
    baseId: weapon.baseId,
    rarity: "normal",
    name: weapon.name,
    affixIds: [],
    mods: [],
    ilvl: 1,
    durability: rollDurability(weapon.baseId),
  };
  const save: CharacterSave = {
    v: VERSION,
    name,
    klass,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>,
    belt: 0,
    gold: 0,
    inventory: createInventory(),
    equipment,
  };
  return JSON.stringify(save);
}

const SKILL_IDS: SkillId[] = [
  "cleave",
  "crush",
  "warcry",
  "leap",
  "firebolt",
  "frostnova",
  "focus",
  "blink",
];

/** Every known skill rank as a finite number, or null if the saved shape is
 * unusable. Ranks a save omits (an older save, a newer skill) come back as 0 —
 * never undefined, which would turn every damage number downstream into NaN. */
function normalizeSkills(raw: unknown): Record<SkillId, number> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (value === undefined) {
      out[id] = 0;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    out[id] = n;
  }
  return out;
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
  if (save?.v !== VERSION || !save.equipment) return false;
  // Anything that reaches the sim is replayed identically on every client, so a
  // malformed save is a deterministic crash (or a NaN that spreads through the
  // damage chain) rather than one player's problem. Validate before applying.
  if (!Array.isArray(save.inventory?.entries)) return false;
  for (const field of ["level", "xp", "skillPoints", "belt"] as const) {
    if (!Number.isFinite(save[field])) return false;
  }
  const skills = normalizeSkills(save.skills);
  if (!skills) return false;

  p.name = typeof save.name === "string" && save.name.trim() ? save.name : "Wanderer";
  p.klass = save.klass === "witch" ? "witch" : "warrior";
  p.level = save.level;
  p.xp = save.xp;
  p.skillPoints = save.skillPoints;
  p.skills = skills;
  p.belt = save.belt;
  p.gold = Number.isFinite(save.gold) ? save.gold! : 0;
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
