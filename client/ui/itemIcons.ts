/**
 * Item icons from the Synty INTERFACE packs when scripts/ui-icons.ts has
 * copied them (licensed, so gitignored), else the game-icons.net SVGs in git.
 * Two kinds of pack icon: coloured renders of POLYGON weapons and items
 * (Fantasy Warrior HUD's ICON_SM_* sets), drawn as images with a rarity glow,
 * and white silhouettes (both packs' Inventory sets) masked and tinted like
 * the SVGs. A missing pack changes the look, not the layout.
 */

/**
 * Base id -> "set/piece" in the copied art manifest. Weapons, shields, orbs,
 * rings, amulets, potions, quest items and the heavier helms get a Fantasy
 * Warrior HUD render each; armour, boots and the plain helm, which the packs
 * have no renders for, use a white silhouette from either pack's Inventory
 * set (fw- names have no underscore before the number).
 */
export const SYNTY_ITEM_ICONS: Record<string, string> = {
  rusted_blade: "fw-weapons/Wep_Sword_01",
  kingsbane: "fw-weapons/Wep_Sword_15",
  hatchet: "fw-weapons/Wep_Axe_01",
  grave_scythe: "fw-weapons/Wep_Axe_10",
  dire_flail: "fw-weapons/Wep_Mace_03",
  war_maul: "fw-weapons/Wep_Hammer_02",
  moon_glaive: "fw-weapons/Wep_Spear_04",
  twin_fang: "fw-weapons/Wep_Dagger_02",
  gnarled_staff: "fw-weapons/Wep_Staff_04",
  ember_staff: "fw-weapons/Wep_Staff_01",
  wyrmwood_staff: "fw-weapons/Wep_Staff_09",
  bone_wand: "fw-weapons/Wep_Sceptre_08",
  willow_wand: "fw-weapons/Wep_Sceptre_03",
  hexwood_wand: "fw-weapons/Wep_Sceptre_01",
  ashen_orb: "fw-resources/Item_Gem_03",
  fen_pearl: "fw-resources/Item_Gem_01",
  grave_star: "fw-resources/Item_Crystal_05",
  plank_buckler: "fw-weapons/Wep_Shield_05",
  bone_targe: "fw-weapons/Wep_Shield_10",
  rimed_kite: "fw-weapons/Wep_Shield_04",
  barrow_bulwark: "fw-weapons/Wep_Shield_07",
  cracked_helm: "fw-inventory/Helmets01",
  bone_visage: "fw-resources/Item_Bird_Skull_01",
  iron_barbute: "fw-resources/Chr_Attach_Soldier_01",
  wyrm_skull: "fw-resources/Chr_Attach_King_Crown_01",
  rag_tunic: "fw-inventory/Armor01",
  studded_jerkin: "fw-inventory/Armor01",
  grave_plate: "fs-inventory/Armor_01",
  lamellar_coat: "fs-inventory/Armor_01",
  bogsteel_plate: "fs-inventory/Armor_01",
  worn_boots: "fs-inventory/Boots_01",
  chain_greaves: "fs-inventory/Boots_01",
  marsh_striders: "fs-inventory/Boots_01",
  cragwalkers: "fs-inventory/Boots_01",
  bone_ring: "fw-resources/Item_Ring_02",
  wight_band: "fw-resources/Item_Ring_03",
  grave_amulet: "fw-resources/Item_Necklace_Flat_03",
  howler_charm: "fw-resources/Item_Necklace_Flat_02",
  minor_potion: "fw-resources/Item_Bottle_09",
  minor_mana_potion: "fw-resources/Item_Bottle_10",
  grave_moss: "fw-resources/Item_Plant_01",
  fen_heart: "fw-resources/Item_Meat_01",
};

const BASE = ((import.meta.env.BASE_URL as string | undefined) ?? "/").replace(/\/$/, "");

export type ItemIconKind = "mask" | "image";

export interface ResolvedIcon {
  url: string;
  /** Masks are tinted by rarity; images carry their own colours and get a rarity glow. */
  kind: ItemIconKind;
}

/** "set/piece" -> the file to draw and how, from the copied pack's manifest. */
let available = new Map<string, ResolvedIcon>();

/** The manifest scripts/ui-icons.ts writes; only the fields used here. */
export interface IconManifest {
  version: number;
  pieces: { set: string; name: string; kind: "icon" | "render" | "sprite"; files: Record<string, string> }[];
}

/** Read the copied art's manifest once at startup; none means the SVGs. */
export async function loadItemIcons(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/icons/synty/manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as IconManifest;
    if (manifest.version !== 3) return;
    available = packIcons(manifest);
  } catch {
    // Offline or absent: the SVGs carry on.
  }
}

/** Every icon piece keyed "set/name": a render's coloured file as an image, else its white Clean file as a mask. */
export function packIcons(manifest: IconManifest): Map<string, ResolvedIcon> {
  const out = new Map<string, ResolvedIcon>();
  for (const p of manifest.pieces) {
    if (p.kind === "sprite") continue;
    const render = p.kind === "render" ? p.files.Render : undefined;
    const file = render ?? p.files.Clean;
    if (!file) continue;
    out.set(`${p.set}/${p.name}`, { url: `${BASE}/icons/synty/${file}`, kind: render ? "image" : "mask" });
  }
  return out;
}

/** Test seam: pretend these pack icons were copied. */
export function setAvailableItemIcons(icons: Map<string, ResolvedIcon>): void {
  available = icons;
}

/** The icon for a base: the pack's when present, else the SVG mask. */
export function itemIcon(baseId: string): ResolvedIcon {
  const key = SYNTY_ITEM_ICONS[baseId];
  const found = key && available.get(key);
  if (found) return found;
  return { url: `${BASE}/icons/items/${baseId}.svg`, kind: "mask" };
}
