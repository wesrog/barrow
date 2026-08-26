export type Slot = "weapon" | "helm" | "chest" | "boots" | "ring" | "amulet" | "potion";

export interface ItemBase {
  id: string;
  name: string;
  slot: Slot;
  /** Inventory grid footprint. */
  w: number;
  h: number;
  levelReq: number;
  dmgMin?: number;
  dmgMax?: number;
  defense?: number;
  /** Life restored on drinking (potions). */
  heals?: number;
}

const base = (b: ItemBase) => b;

export const BASES: Record<string, ItemBase> = {
  // --- weapons ---
  rusted_blade: base({ id: "rusted_blade", name: "Rusted Blade", slot: "weapon", w: 1, h: 3, levelReq: 1, dmgMin: 1, dmgMax: 6 }),
  hatchet: base({ id: "hatchet", name: "Hatchet", slot: "weapon", w: 1, h: 3, levelReq: 3, dmgMin: 2, dmgMax: 8 }),
  war_maul: base({ id: "war_maul", name: "War Maul", slot: "weapon", w: 2, h: 3, levelReq: 8, dmgMin: 6, dmgMax: 14 }),
  twin_fang: base({ id: "twin_fang", name: "Twin Fang", slot: "weapon", w: 1, h: 2, levelReq: 12, dmgMin: 4, dmgMax: 10 }),
  grave_scythe: base({ id: "grave_scythe", name: "Grave Scythe", slot: "weapon", w: 2, h: 3, levelReq: 16, dmgMin: 8, dmgMax: 18 }),
  // --- helms ---
  cracked_helm: base({ id: "cracked_helm", name: "Cracked Helm", slot: "helm", w: 2, h: 2, levelReq: 1, defense: 3 }),
  bone_visage: base({ id: "bone_visage", name: "Bone Visage", slot: "helm", w: 2, h: 2, levelReq: 10, defense: 8 }),
  // --- chests ---
  rag_tunic: base({ id: "rag_tunic", name: "Rag Tunic", slot: "chest", w: 2, h: 3, levelReq: 1, defense: 4 }),
  studded_jerkin: base({ id: "studded_jerkin", name: "Studded Jerkin", slot: "chest", w: 2, h: 3, levelReq: 6, defense: 9 }),
  grave_plate: base({ id: "grave_plate", name: "Grave Plate", slot: "chest", w: 2, h: 3, levelReq: 14, defense: 16 }),
  // --- boots ---
  worn_boots: base({ id: "worn_boots", name: "Worn Boots", slot: "boots", w: 2, h: 2, levelReq: 1, defense: 2 }),
  chain_greaves: base({ id: "chain_greaves", name: "Chain Greaves", slot: "boots", w: 2, h: 2, levelReq: 9, defense: 6 }),
  // --- jewelry ---
  bone_ring: base({ id: "bone_ring", name: "Bone Ring", slot: "ring", w: 1, h: 1, levelReq: 4 }),
  grave_amulet: base({ id: "grave_amulet", name: "Grave Amulet", slot: "amulet", w: 1, h: 1, levelReq: 5 }),
  // --- potions ---
  minor_potion: base({ id: "minor_potion", name: "Minor Healing Potion", slot: "potion", w: 1, h: 1, levelReq: 1, heals: 35 }),
};
