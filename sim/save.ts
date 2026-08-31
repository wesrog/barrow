import { isAreaId, type AreaId } from "./areas";
import { createEquipment, createInventory, type Equipment, type Inventory } from "./character";
import { recomputePlayerStats } from "./systems/inventory";
import { rollDurability } from "./items/generate";
import { SKILL_IDS, type Klass, type SkillId } from "./skills";
import { type GameState, type PlayerId } from "./state";
import { worldWaypointPos } from "./surface";
import { ensureSurface } from "./world";

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
  /** Mana potions on the belt's second row. Missing on older saves. */
  manaBelt?: number;
  gold?: number;
  inventory: Inventory;
  equipment: Equipment;
  /** Seed of the world this character last played; the lobby reuses it. */
  worldSeed?: number;
  /** Area to resume at. Unknown or undiscovered values fall back to camp. */
  checkpoint?: string;
  /** Discovered waypoint area ids; filtered to areas this build knows. */
  waypoints?: string[];
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
    manaBelt: p.manaBelt,
    gold: p.gold,
    inventory: p.inventory,
    equipment: p.equipment,
    worldSeed: state.seed,
    checkpoint: p.checkpoint,
    waypoints: p.waypoints,
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
  p.manaBelt = Number.isFinite(save.manaBelt) ? save.manaBelt! : 0;
  p.gold = Number.isFinite(save.gold) ? save.gold! : 0;
  p.inventory = save.inventory;
  p.equipment = save.equipment;
  // Checkpoint fields are lenient where the rest is strict: a garbled area name
  // shouldn't brick the hero. Normalization is a pure function of the payload,
  // so every peer replaying this join computes the identical result.
  const waypoints = Array.isArray(save.waypoints)
    ? [...new Set(save.waypoints.filter((w): w is AreaId => typeof w === "string" && isAreaId(w)))]
    : [];
  if (!waypoints.includes("overworld")) waypoints.push("overworld");
  p.waypoints = waypoints.sort();
  // Any registry area is a valid checkpoint — outposts stamp it on arrival,
  // before their waypoint is ever touched — and every area's safe spot is
  // fixed, so restoring there is layout-safe in any world.
  p.checkpoint =
    typeof save.checkpoint === "string" && isAreaId(save.checkpoint)
      ? save.checkpoint
      : "overworld";
  p.region = p.checkpoint;
  // Keep item ids clear of the fresh state's counter.
  for (const e of p.inventory.entries) {
    if (e.id >= state.nextId) state.nextId = e.id + 1;
  }
  recomputePlayerStats(state, p);
  p.life = p.maxLife;
  p.mana = p.maxMana;
  // Wake at the checkpoint's waypoint — generating the surface if this world
  // hasn't grown it yet. Runs inside the join frame, so it lands identically
  // on every peer, and the fixed outpost rects make the spot layout-safe.
  ensureSurface(state);
  p.zoneId = "surface";
  p.pos = { ...worldWaypointPos(p.checkpoint) };
  return true;
}
