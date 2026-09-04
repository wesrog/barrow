export type Slot = "weapon" | "shield" | "helm" | "chest" | "boots" | "ring" | "amulet" | "potion" | "quest";

export type WeaponEdge = "sharp" | "blunt";

export interface ItemBase {
  id: string;
  name: string;
  slot: Slot;
  /** Inventory grid footprint. */
  w: number;
  h: number;
  levelReq: number;
  /** Only this class may equip it; anyone otherwise. */
  classReq?: "warrior" | "witch";
  /** Weapons only: what the strike sounds like — a cutting edge or a crushing mass. */
  edge?: WeaponEdge;
  /** Weapons only: needs both hands, so nothing rides in the shield slot alongside it. */
  twoHanded?: true;
  dmgMin?: number;
  dmgMax?: number;
  defense?: number;
  /** Life restored on drinking (potions). */
  heals?: number;
  /** Mana restored on drinking (potions). */
  restoresMana?: number;
}

const base = (b: ItemBase) => b;

export const BASES: Record<string, ItemBase> = {
  // --- weapons ---
  rusted_blade: base({ id: "rusted_blade", name: "Rusted Blade", slot: "weapon", edge: "sharp", w: 1, h: 3, levelReq: 1, dmgMin: 1, dmgMax: 6 }),
  gnarled_staff: base({ id: "gnarled_staff", name: "Gnarled Staff", slot: "weapon", edge: "blunt", w: 1, h: 3, levelReq: 1, classReq: "witch", dmgMin: 1, dmgMax: 4 }),
  hatchet: base({ id: "hatchet", name: "Hatchet", slot: "weapon", edge: "sharp", w: 1, h: 3, levelReq: 3, dmgMin: 2, dmgMax: 8 }),
  ashen_orb: base({ id: "ashen_orb", name: "Ashen Orb", slot: "shield", w: 1, h: 2, levelReq: 4, classReq: "witch", dmgMin: 1, dmgMax: 5 }),
  war_maul: base({ id: "war_maul", name: "War Maul", slot: "weapon", edge: "blunt", twoHanded: true, w: 2, h: 3, levelReq: 8, classReq: "warrior", dmgMin: 8, dmgMax: 18 }),
  ember_staff: base({ id: "ember_staff", name: "Ember Staff", slot: "weapon", edge: "blunt", w: 1, h: 3, levelReq: 11, classReq: "witch", dmgMin: 4, dmgMax: 10 }),
  twin_fang: base({ id: "twin_fang", name: "Twin Fang", slot: "weapon", edge: "sharp", w: 1, h: 2, levelReq: 12, dmgMin: 4, dmgMax: 10 }),
  fen_pearl: base({ id: "fen_pearl", name: "Fen Pearl", slot: "shield", w: 1, h: 2, levelReq: 14, classReq: "witch", dmgMin: 5, dmgMax: 12 }),
  grave_scythe: base({ id: "grave_scythe", name: "Grave Scythe", slot: "weapon", edge: "sharp", twoHanded: true, w: 2, h: 3, levelReq: 16, classReq: "warrior", dmgMin: 11, dmgMax: 25 }),
  dire_flail: base({ id: "dire_flail", name: "Dire Flail", slot: "weapon", edge: "blunt", twoHanded: true, w: 2, h: 3, levelReq: 19, classReq: "warrior", dmgMin: 15, dmgMax: 32 }),
  wyrmwood_staff: base({ id: "wyrmwood_staff", name: "Wyrmwood Staff", slot: "weapon", edge: "blunt", w: 1, h: 3, levelReq: 20, classReq: "witch", dmgMin: 8, dmgMax: 18 }),
  moon_glaive: base({ id: "moon_glaive", name: "Moon Glaive", slot: "weapon", edge: "sharp", twoHanded: true, w: 2, h: 3, levelReq: 23, classReq: "warrior", dmgMin: 19, dmgMax: 41 }),
  grave_star: base({ id: "grave_star", name: "Grave Star", slot: "shield", w: 1, h: 2, levelReq: 26, classReq: "witch", dmgMin: 12, dmgMax: 26 }),
  kingsbane: base({ id: "kingsbane", name: "Kingsbane", slot: "weapon", edge: "sharp", w: 1, h: 3, levelReq: 28, dmgMin: 18, dmgMax: 38 }),
  // --- shields ---
  plank_buckler: base({ id: "plank_buckler", name: "Plank Buckler", slot: "shield", w: 2, h: 2, levelReq: 1, defense: 4 }),
  bone_targe: base({ id: "bone_targe", name: "Bone Targe", slot: "shield", w: 2, h: 2, levelReq: 8, defense: 9 }),
  rimed_kite: base({ id: "rimed_kite", name: "Rimed Kite Shield", slot: "shield", w: 2, h: 3, levelReq: 17, defense: 15 }),
  barrow_bulwark: base({ id: "barrow_bulwark", name: "Barrow Bulwark", slot: "shield", w: 2, h: 3, levelReq: 25, defense: 22 }),
  // --- helms ---
  cracked_helm: base({ id: "cracked_helm", name: "Cracked Helm", slot: "helm", w: 2, h: 2, levelReq: 1, defense: 3 }),
  bone_visage: base({ id: "bone_visage", name: "Bone Visage", slot: "helm", w: 2, h: 2, levelReq: 10, defense: 8 }),
  iron_barbute: base({ id: "iron_barbute", name: "Iron Barbute", slot: "helm", w: 2, h: 2, levelReq: 18, defense: 12 }),
  wyrm_skull: base({ id: "wyrm_skull", name: "Wyrm Skull", slot: "helm", w: 2, h: 2, levelReq: 26, defense: 18 }),
  // --- chests ---
  rag_tunic: base({ id: "rag_tunic", name: "Rag Tunic", slot: "chest", w: 2, h: 3, levelReq: 1, defense: 4 }),
  studded_jerkin: base({ id: "studded_jerkin", name: "Studded Jerkin", slot: "chest", w: 2, h: 3, levelReq: 6, defense: 9 }),
  grave_plate: base({ id: "grave_plate", name: "Grave Plate", slot: "chest", w: 2, h: 3, levelReq: 14, defense: 16 }),
  lamellar_coat: base({ id: "lamellar_coat", name: "Lamellar Coat", slot: "chest", w: 2, h: 3, levelReq: 20, defense: 22 }),
  bogsteel_plate: base({ id: "bogsteel_plate", name: "Bogsteel Plate", slot: "chest", w: 2, h: 3, levelReq: 27, defense: 30 }),
  // --- boots ---
  worn_boots: base({ id: "worn_boots", name: "Worn Boots", slot: "boots", w: 2, h: 2, levelReq: 1, defense: 2 }),
  chain_greaves: base({ id: "chain_greaves", name: "Chain Greaves", slot: "boots", w: 2, h: 2, levelReq: 9, defense: 6 }),
  marsh_striders: base({ id: "marsh_striders", name: "Marsh Striders", slot: "boots", w: 2, h: 2, levelReq: 17, defense: 9 }),
  cragwalkers: base({ id: "cragwalkers", name: "Cragwalkers", slot: "boots", w: 2, h: 2, levelReq: 25, defense: 13 }),
  // --- jewelry ---
  bone_ring: base({ id: "bone_ring", name: "Bone Ring", slot: "ring", w: 1, h: 1, levelReq: 4 }),
  grave_amulet: base({ id: "grave_amulet", name: "Grave Amulet", slot: "amulet", w: 1, h: 1, levelReq: 5 }),
  wight_band: base({ id: "wight_band", name: "Wight Band", slot: "ring", w: 1, h: 1, levelReq: 20 }),
  howler_charm: base({ id: "howler_charm", name: "Howler Charm", slot: "amulet", w: 1, h: 1, levelReq: 24 }),
  // --- potions ---
  minor_potion: base({ id: "minor_potion", name: "Minor Healing Potion", slot: "potion", w: 1, h: 1, levelReq: 1, heals: 35 }),
  minor_mana_potion: base({ id: "minor_mana_potion", name: "Minor Mana Potion", slot: "potion", w: 1, h: 1, levelReq: 1, restoresMana: 25 }),
  // --- quest items ---
  grave_moss: base({ id: "grave_moss", name: "Grave-Moss", slot: "quest", w: 1, h: 1, levelReq: 1 }),
  fen_heart: base({ id: "fen_heart", name: "Fen Heart", slot: "quest", w: 1, h: 1, levelReq: 1 }),
};

/** Which belt row a potion base belongs to; null for anything undrinkable. */
export function potionKind(baseId: string): "health" | "mana" | null {
  const base = BASES[baseId];
  if (!base || base.slot !== "potion") return null;
  return base.restoresMana !== undefined ? "mana" : "health";
}
