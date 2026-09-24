/**
 * Item icons: Synty INTERFACE Fantasy Screens silhouettes when
 * scripts/ui-icons.ts has copied them (licensed, so gitignored), else the
 * game-icons.net SVGs in git. Both are white on transparency and render as
 * tinted CSS masks, so a missing pack changes the look, not the layout.
 */

/**
 * Base id -> Fantasy Screens inventory icon. The pack draws one silhouette
 * per kind of thing, so the tiers of a slot share one and rarity colour plus
 * the name tell them apart; the three caster orbs get the three magic icons.
 */
export const SYNTY_ITEM_ICONS: Record<string, string> = {
  rusted_blade: "Swords_01",
  kingsbane: "Swords_01",
  hatchet: "Axes_01",
  grave_scythe: "Axes_01",
  dire_flail: "Maces_01",
  war_maul: "Hammers_01",
  moon_glaive: "Spears_01",
  twin_fang: "Daggers_01",
  gnarled_staff: "Staves_01",
  ember_staff: "Staves_01",
  wyrmwood_staff: "Staves_01",
  bone_wand: "Scepters_01",
  willow_wand: "Scepters_01",
  hexwood_wand: "Scepters_01",
  ashen_orb: "Magic_01",
  fen_pearl: "Magic_02",
  grave_star: "Magic_03",
  plank_buckler: "Shields_01",
  bone_targe: "Shields_01",
  rimed_kite: "Shields_01",
  barrow_bulwark: "Shields_01",
  cracked_helm: "Helmets_01",
  bone_visage: "Helmets_01",
  iron_barbute: "Helmets_01",
  wyrm_skull: "Helmets_01",
  rag_tunic: "Armor_02",
  studded_jerkin: "Armor_02",
  grave_plate: "Armor_01",
  lamellar_coat: "Armor_01",
  bogsteel_plate: "Armor_01",
  worn_boots: "Boots_01",
  chain_greaves: "Boots_01",
  marsh_striders: "Boots_01",
  cragwalkers: "Boots_01",
  bone_ring: "Rings_01",
  wight_band: "Rings_02",
  grave_amulet: "Necklaces_01",
  howler_charm: "Necklaces_02",
  minor_potion: "Healing_01",
  minor_mana_potion: "Potions_01",
  grave_moss: "Plants_01",
  fen_heart: "Minerals_01",
};

const BASE = ((import.meta.env.BASE_URL as string | undefined) ?? "/").replace(/\/$/, "");

let available = new Set<string>();

/** Read the copied icons' manifest once at startup; none means the SVGs. */
export async function loadItemIcons(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/icons/synty/manifest.json`);
    if (!res.ok) return;
    const manifest = (await res.json()) as Record<string, string[]>;
    available = new Set(manifest.inventory ?? []);
  } catch {
    // Offline or absent: the SVGs carry on.
  }
}

/** Test seam: pretend these pack icons were copied. */
export function setAvailableItemIcons(names: Iterable<string>): void {
  available = new Set(names);
}

/** The mask image for a base's icon: the pack silhouette when present, else the SVG. */
export function itemIconUrl(baseId: string): string {
  const synty = SYNTY_ITEM_ICONS[baseId];
  if (synty && available.has(synty)) return `${BASE}/icons/synty/inventory/${synty}.png`;
  return `${BASE}/icons/items/${baseId}.svg`;
}
