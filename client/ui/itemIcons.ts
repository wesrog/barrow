/**
 * Item icons from the licensed art packs when scripts/ui-icons.ts has copied
 * them (gitignored), else the game-icons.net SVGs in git. Coloured icons
 * (the AssetSmithy set, the Synty Warrior HUD's rendered items) draw as
 * images with a rarity glow; white silhouettes mask and tint like the SVGs.
 * A missing pack changes the look, not the layout.
 */

/**
 * Base id -> "set/piece" in the copied art manifest. Gear (weapons, shields,
 * helms, armour, boots) comes from the AssetSmithy fantasy icons, sixteen per
 * kind ordered roughly plain to enchanted, so tiers climb through them.
 * Potions, rings, amulets, orbs and quest items, which that set lacks, stay
 * on the Warrior HUD's rendered bottles, rings, necklaces and gems.
 */
export const SYNTY_ITEM_ICONS: Record<string, string> = {
  rusted_blade: "as-weapons/one-handed_sword_01",
  short_bow: "as-weapons/bow_01",
  hunting_bow: "as-weapons/bow_05",
  yew_longbow: "as-weapons/bow_10",
  horn_bow: "as-weapons/bow_14",
  kingsbane: "as-weapons/one-handed_sword_14",
  hatchet: "as-weapons/one-handed_hand_axe_01",
  grave_scythe: "as-weapons/two-handed_battle_axe_11",
  dire_flail: "as-weapons/flail_09",
  war_maul: "as-weapons/war_hammer_07",
  moon_glaive: "as-weapons/halberd_13",
  twin_fang: "as-weapons/dagger_04",
  gnarled_staff: "as-weapons/wizard_staff_01",
  ember_staff: "as-weapons/wizard_staff_11",
  wyrmwood_staff: "as-weapons/wizard_staff_06",
  bone_wand: "as-weapons/magic_wand_01",
  willow_wand: "as-weapons/magic_wand_05",
  hexwood_wand: "as-weapons/magic_wand_14",
  ashen_orb: "fw-resources/Item_Gem_03",
  fen_pearl: "fw-resources/Item_Gem_01",
  grave_star: "fw-resources/Item_Crystal_05",
  plank_buckler: "as-armor/light_shield_10",
  bone_targe: "as-armor/heavy_shield_10",
  rimed_kite: "as-armor/heavy_shield_13",
  barrow_bulwark: "as-armor/heavy_shield_15",
  cracked_helm: "as-armor/medium_head_armor_01",
  bone_visage: "as-armor/heavy_head_armor_09",
  iron_barbute: "as-armor/heavy_head_armor_01",
  wyrm_skull: "as-armor/heavy_head_armor_12",
  rag_tunic: "as-armor/light_body_armor_09",
  studded_jerkin: "as-armor/medium_body_armor_01",
  grave_plate: "as-armor/heavy_body_armor_01",
  lamellar_coat: "as-armor/medium_body_armor_05",
  bogsteel_plate: "as-armor/heavy_body_armor_15",
  worn_boots: "as-armor/light_foot_armor_09",
  chain_greaves: "as-armor/heavy_foot_armor_09",
  marsh_striders: "as-armor/light_foot_armor_14",
  cragwalkers: "as-armor/heavy_foot_armor_07",
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
  /** A render's side view, lying along its width, for slots taller or wider than square. */
  side?: string;
}

/** "set/piece" -> the file to draw and how, from the copied pack's manifest. */
let available = new Map<string, ResolvedIcon>();
/** "set/piece" -> url of the coloured UI sprites (frames, bars) the HUD may dress itself with. */
let sprites = new Map<string, string>();

/** The manifest scripts/ui-icons.ts writes; only the fields used here. */
export interface IconManifest {
  version: number;
  pieces: { set: string; name: string; kind: "icon" | "render" | "sprite"; files: Record<string, string> }[];
}

/** Read the copied art's manifest once at startup; none means the SVGs. */
export async function loadItemIcons(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/icons/packs/manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as IconManifest;
    if (manifest.version !== 3) return;
    available = packIcons(manifest);
    sprites = packSprites(manifest);
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
    const icon: ResolvedIcon = { url: `${BASE}/icons/packs/${file}`, kind: render ? "image" : "mask" };
    if (render && p.files.Side) icon.side = `${BASE}/icons/packs/${p.files.Side}`;
    out.set(`${p.set}/${p.name}`, icon);
  }
  return out;
}

/** Every sprite piece's url keyed "set/name". */
export function packSprites(manifest: IconManifest): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of manifest.pieces) {
    const file = p.kind === "sprite" ? p.files[""] : undefined;
    if (file) out.set(`${p.set}/${p.name}`, `${BASE}/icons/packs/${file}`);
  }
  return out;
}

/** Test seam: pretend these pack icons and sprites were copied. */
export function setAvailableItemIcons(icons: Map<string, ResolvedIcon>, packSpriteUrls: Map<string, string> = new Map()): void {
  available = icons;
  sprites = packSpriteUrls;
}

/** A UI sprite's url by manifest key, or null when the art is not copied. */
export function uiSprite(key: string): string | null {
  return sprites.get(key) ?? null;
}

/** The icon for a base: the pack's when present, else the SVG mask. */
export function itemIcon(baseId: string): ResolvedIcon {
  const key = SYNTY_ITEM_ICONS[baseId];
  const found = key && available.get(key);
  if (found) return found;
  return { url: `${BASE}/icons/items/${baseId}.svg`, kind: "mask" };
}
